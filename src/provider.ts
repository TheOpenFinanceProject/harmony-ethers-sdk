import { BlockTag, BaseProvider, JsonRpcProvider } from "@ethersproject/providers";
import { getStatic } from "@ethersproject/properties";
import { BigNumber } from "@ethersproject/bignumber";
import { hexlify } from "@ethersproject/bytes";
import { randomBytes } from "crypto";
import { Deferrable } from "@ethersproject/properties";
import { Network } from "@ethersproject/networks";
import { Logger } from "@ethersproject/logger";
import { parseEther } from "@ethersproject/units";
import { ConnectionInfo, poll } from "@ethersproject/web";
import {
  TransactionRequest,
  Transaction,
  TransactionResponse,
  TransactionReceipt,
  CXTransactionReceipt,
  StakingTransactionResponse,
  StakingTransaction,
  Block,
  BlockWithTransactions,
} from "./types";
import HarmonyFormatter, { Delegation } from "./formatter";
const logger = new Logger("hmy_provider/0.0.1");

function timer(timeout: number): Promise<any> {
  return new Promise(function (resolve) {
    setTimeout(resolve, timeout);
  });
}

export interface HarmonyProvider extends BaseProvider {
  network: HarmonyNetwork;

  // Execution
  sendTransaction(signedTransaction: string | Promise<string>): Promise<TransactionResponse>;
  sendStakingTransaction(signedTransaction: string | Promise<string>): Promise<StakingTransactionResponse>;

  call(transaction: Deferrable<TransactionRequest>, blockTag?: BlockTag | Promise<BlockTag>): Promise<string>;
  estimateGas(transaction: Deferrable<TransactionRequest>): Promise<BigNumber>;

  // Queries
  getBlock(blockHashOrBlockTag: BlockTag | string | Promise<BlockTag | string>): Promise<Block>;
  getBlockWithTransactions(blockHashOrBlockTag: BlockTag | string | Promise<BlockTag | string>): Promise<BlockWithTransactions>;

  getTransaction(transactionHash: string): Promise<TransactionResponse>;
  getTransactionReceipt(transactionHash: string): Promise<TransactionReceipt>;
  getCXTransactionReceipt(transactionHash: string): Promise<CXTransactionReceipt>;

  getStakingTransaction(transactionHash: string): Promise<StakingTransactionResponse>;

  getCirculatingSupply(): Promise<BigNumber>;
  getTotalSupply(): Promise<BigNumber>;

  getEpoch(): Promise<number>;
  getEpochLastBlock(epoch: number): Promise<number>;

  getLeader(): Promise<string>;

  getValidatorsAddresses(): Promise<Array<string>>;
  getActiveValidatorsAddresses(): Promise<Array<string>>;

  getDelegationsByValidator(validatorAddress: string): Promise<Array<Delegation>>;
  getDelegationsByDelegator(delegatorAddress: string): Promise<Array<Delegation>>;
}

interface ShardStructure {
  current: boolean;
  http: string;
  shardID: number;
  ws: string;
}

interface HarmonyNetwork extends Network {
  shardID: number;
  shardingStructure?: ShardStructure[];
}

export type Networkish = HarmonyNetwork | number;

const networks = [
  {
    name: "mainnet",
    chainId: 1,
  },
  {
    name: "testnet",
    chainId: 2,
  },
  {
    name: "localnet",
    chainId: 3,
  },
];

export class ApiHarmonyProvider extends JsonRpcProvider implements HarmonyProvider {
  static getNetwork(network: Networkish, shardingStructure?: ShardStructure[]): HarmonyNetwork {
    if (typeof network === "number") {
      let shardID = shardingStructure?.find((shard) => shard.current)?.shardID ?? 0;

      const { name } = networks.find(({ chainId }) => chainId === network) ?? { name: "unknown" };
      return {
        shardID,
        name,
        chainId: network,
      };
    }

    return network;
  }

  static getFormatter(): HarmonyFormatter {
    return new HarmonyFormatter();
  }

  formatter!: HarmonyFormatter;

  _networkPromise!: Promise<HarmonyNetwork>;
  _network!: HarmonyNetwork;

  _shardingStructure?: ShardStructure[]; // cache

  constructor(url?: ConnectionInfo | string) {
    super(url);
    this._nextId = randomBytes(1).readUInt8();
  }

  get network(): HarmonyNetwork {
    return this._network;
  }

  async detectNetwork(): Promise<HarmonyNetwork> {
    await timer(0);

    let chainId = null;
    try {
      chainId = await this.send("hmy_chainId", []);
    } catch (error) {
      try {
        chainId = await this.send("net_version", []);
      } catch (error) {}
    }

    // this is used to dectec the current shard
    // maybe this could be inferred from network Id last digit
    let shardingStructure = this._shardingStructure;
    if (!shardingStructure) {
      try {
        shardingStructure = await this.send("hmy_getShardingStructure", []);
      } catch (error) {}
    }

    if (chainId != null) {
      const getNetwork = getStatic<(network: Networkish, shardingStructure?: ShardStructure[]) => HarmonyNetwork>(
        this.constructor,
        "getNetwork"
      );
      try {
        return getNetwork(BigNumber.from(chainId).toNumber(), shardingStructure);
      } catch (error) {
        return logger.throwError("could not detect network", Logger.errors.NETWORK_ERROR, {
          chainId: chainId,
          event: "invalidNetwork",
          serverError: error,
        });
      }
    }

    return logger.throwError("could not detect network", Logger.errors.NETWORK_ERROR, {
      event: "noNetwork",
    });
  }

  async getCirculatingSupply(): Promise<BigNumber> {
    return parseEther(await this.send("hmy_getCirculatingSupply", []));
  }

  async getTotalSupply(): Promise<BigNumber> {
    return parseEther(await this.send("hmy_getTotalSupply", []));
  }

  async getEpoch(): Promise<number> {
    return this.formatter.number(await this.send("hmy_getEpoch", []));
  }

  async getEpochLastBlock(epoch: number): Promise<number> {
    return this.formatter.number(await this.send("hmy_epochLastBlock", [epoch]));
  }

  async getLeader(): Promise<string> {
    return this.formatter.address(await this.send("hmy_getLeader", []));
  }

  async getValidatorsAddresses(): Promise<Array<string>> {
    const validators = await this.send("hmy_getAllValidatorAddresses", []);
    return validators.map((address: string) => this.formatter.address(address));
  }

  async getActiveValidatorsAddresses(): Promise<Array<string>> {
    const validators = await this.send("hmy_getActiveValidatorAddresses", []);
    return validators.map((address: string) => this.formatter.address(address));
  }

  async getDelegationsByValidator(validatorAddress: string): Promise<Array<Delegation>> {
    const result = await this.send("hmy_getDelegationsByValidator", [validatorAddress]);
    return result.map((delegation: string) => this.formatter.delegation(delegation));
  }

  async getDelegationsByDelegator(delegatorAddress: string): Promise<Array<Delegation>> {
    const result = await this.send("hmy_getDelegationsByDelegator", [delegatorAddress]);
    return result.map((delegation: string) => this.formatter.delegation(delegation));
  }

  _wrapTransaction(tx: Transaction, hash?: string): TransactionResponse {
    return <TransactionResponse>super._wrapTransaction(tx, hash);
  }

  _wrapStakingTransaction(tx: StakingTransaction, hash?: string): StakingTransactionResponse {
    const response = <StakingTransactionResponse>tx;
    response.hash = hash || '';
    return response;
  }

  async sendTransaction(signedTransaction: string | Promise<string>): Promise<TransactionResponse> {
    await this.getNetwork();

    const hexTx = hexlify(await Promise.resolve(signedTransaction));
    const tx = this.formatter.transaction(signedTransaction);

    try {
      const hash = await this.perform("sendTransaction", {
        signedTransaction: hexTx,
      });

      return this._wrapTransaction(tx, hash);
    } catch (error) {
      (<any>error).transaction = tx;
      (<any>error).transactionHash = tx.hash;
      throw error;
    }
  }

  async sendStakingTransaction(signedTransaction: string | Promise<string>): Promise<StakingTransactionResponse> {
    await this.getNetwork();

    const hexTx = hexlify(await Promise.resolve(signedTransaction));
    const tx = this.formatter.stakingTransaction(signedTransaction);

    try {
      const hash = await this.perform("sendStackingTransaction", {
        signedTransaction: hexTx,
      });

      return this._wrapStakingTransaction(tx, hash);
    } catch (error) {
      (<any>error).transaction = tx;
      (<any>error).transactionHash = tx.hash;
      throw error;
    }
  }

  prepareRequest(method: string, params: any): [string, Array<any>] {
    switch (method) {
      case "sendStackingTransaction":
        return ["hmy_sendRawStakingTransaction", [params.signedTransaction]];
      case "getStakingTransaction":
        return ["hmy_getStakingTransactionByHash", [params.transactionHash]];
      case "getCXTransactionReceipt":
        return ["hmy_getCXReceiptByHash", [params.transactionHash]];
      default:
        let [rpcMethod, rpcParams] = super.prepareRequest(method, params);

        if (rpcMethod.startsWith("eth")) {
          rpcMethod = rpcMethod.replace("eth", "hmy");
        }

        return [rpcMethod, rpcParams];
    }
  }

  async _getBlock(
    blockHashOrBlockTag: BlockTag | string | Promise<BlockTag | string>,
    includeTransactions?: boolean
  ): Promise<Block | BlockWithTransactions> {
    const block = (await super._getBlock(blockHashOrBlockTag, includeTransactions)) as Block | BlockWithTransactions;

    block.shardID = this.network.shardID;

    if (includeTransactions) {
      let blockNumber: number | null = null;
      for (let i = 0; i < (<BlockWithTransactions>block).stakingTransactions.length; i++) {
        const tx = (<BlockWithTransactions>block).stakingTransactions[i];
        if (tx.blockNumber == null) {
          tx.confirmations = 0;
        } else if (tx.confirmations == null) {
          if (blockNumber == null) {
            blockNumber = await this._getInternalBlockNumber(100 + 2 * this.pollingInterval);
          }

          // Add the confirmations using the fast block number (pessimistic)
          let confirmations = blockNumber - tx.blockNumber + 1;
          if (confirmations <= 0) {
            confirmations = 1;
          }
          tx.confirmations = confirmations;
        }
      }
    }

    return block;
  }

  getBlock(blockHashOrBlockTag: BlockTag | string | Promise<BlockTag | string>): Promise<Block> {
    return <Promise<Block>>this._getBlock(blockHashOrBlockTag, false);
  }

  getBlockWithTransactions(blockHashOrBlockTag: BlockTag | string | Promise<BlockTag | string>): Promise<BlockWithTransactions> {
    return <Promise<BlockWithTransactions>>this._getBlock(blockHashOrBlockTag, true);
  }

  getTransaction(transactionHash: string): Promise<TransactionResponse> {
    return <Promise<TransactionResponse>>super.getTransaction(transactionHash);
  }

  async getStakingTransaction(transactionHash: string): Promise<StakingTransactionResponse> {
    await this.getNetwork();
    transactionHash = await transactionHash;

    const params = { transactionHash: this.formatter.hash(transactionHash, true) };

    return poll(
      async () => {
        const result = await this.perform("getStakingTransaction", params);

        const tx = this.formatter.stakingTransactionResponse(result);

        if (tx.blockNumber == null) {
          tx.confirmations = 0;
        } else if (tx.confirmations == null) {
          const blockNumber = await this._getInternalBlockNumber(100 + 2 * this.pollingInterval);

          // Add the confirmations using the fast block number (pessimistic)
          let confirmations = blockNumber - tx.blockNumber + 1;
          if (confirmations <= 0) {
            confirmations = 1;
          }
          tx.confirmations = confirmations;
        }

        return this._wrapStakingTransaction(tx);
      },
      { oncePoll: this }
    );
  }

  async getCXTransactionReceipt(transactionHash: string): Promise<CXTransactionReceipt> {
    await this.getNetwork();
    const params = { transactionHash: this.formatter.hash(transactionHash, true) };
    return poll(
      async () => {
        const result = await this.perform("getCXTransactionReceipt", params);
        return this.formatter.cXReceipt(result);
      },
      { oncePoll: this }
    );
  }
}
