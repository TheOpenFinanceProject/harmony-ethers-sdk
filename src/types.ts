import { BigNumber, BigNumberish } from "@ethersproject/bignumber";
import { TransactionRequest as EthTransactionRequest, TransactionReceipt as EthTransactionReceipt } from "@ethersproject/abstract-provider";
import { UnsignedTransaction as EthUnsignedTransaction, Transaction as EthTransaction } from "@ethersproject/transactions";

interface BlockBase {
  hash: string;
  parentHash: string;
  number: number;

  timestamp: number;
  nonce: string;
  difficulty: number;

  gasLimit: BigNumber;
  gasUsed: BigNumber;

  miner: string;
  extraData: string;

  // Harmony

  epoch: BigNumberish;
  shardID: BigNumberish;
  viewID: string;

  transactions: Array<string | TransactionResponse>;
  stakingTransactions: Array<string | TransactionResponse>;
}

export interface Block extends BlockBase {
  transactions: Array<string>;
  stakingTransactions: Array<string>;
  _difficulty: BigNumber;
}

export interface BlockWithTransactions extends BlockBase {
  transactions: Array<TransactionResponse>;
  stakingTransactions: Array<TransactionResponse>;
  _difficulty: BigNumber;
}

export enum Directive {
  CreateValidator,
  EditValidator,
  Delegate,
  Undelegate,
  CollectRewards,
}

export interface Description {
  name: string;
  identity: string;
  website: string;
  securityContact: string;
  details: string;
}

export interface CommissionRate {
  rate: string;
  maxRate: string;
  maxChangeRate: string;
}

export interface CreateValidatorMsg {
  validatorAddress: string;
  description: Description;
  commissionRates: CommissionRate;
  minSelfDelegation: BigNumberish;
  maxTotalDelegation: BigNumberish;
  slotPubKeys: string[];
  slotKeySigs?: string[];
  amount: BigNumberish;
}

export interface EditValidatorMsg {
  validatorAddress: string;
  description?: Partial<Description>;
  commissionRate?: string;
  minSelfDelegation?: BigNumberish;
  maxTotalDelegation?: BigNumberish;
  slotKeyToRemove?: string;
  slotKeyToAdd?: string;
  slotKeySig?: string;
  active?: boolean;
}

export interface DelegateMsg {
  delegatorAddress: string;
  validatorAddress: string;
  amount: BigNumberish;
}

export interface UndelegateMsg {
  delegatorAddress: string;
  validatorAddress: string;
  amount: BigNumberish;
}

export interface CollectRewardsMsg {
  delegatorAddress: string;
}

export type Msg = CommissionRate | CreateValidatorMsg | EditValidatorMsg | DelegateMsg | UndelegateMsg | CollectRewardsMsg;

export interface UnsignedTransaction extends Omit<EthUnsignedTransaction, "accessList" | "type"> {
  shardID?: number;
  toShardID?: number;
}

export interface UnsignedStakingTransaction extends Omit<EthUnsignedTransaction, "accessList" | "type"> {
  type: Directive;
  msg: Msg;
}

export interface Transaction extends Omit<EthTransaction, "accessList" | "type"> {
  shardID: BigNumberish;
  toShardID: BigNumberish;
}

export interface StakingTransaction extends Omit<EthTransaction, "accessList" | "type" | "data" | "value" | "to"> {
  type: Directive;
  msg: Msg | null;
}

interface Response {
  blockNumber?: number;
  blockHash?: string;
  timestamp?: number;

  confirmations: number;
}

export interface TransactionResponse extends Transaction, Response {
  hash: string;

  // Not optional (as it is in Transaction)
  from: string;

  // The raw transaction
  raw?: string;

  shardID: number;
  toShardID: number;

  // This function waits until the transaction has been mined
  wait: (confirmations?: number) => Promise<TransactionReceipt>;
}

export interface StakingTransactionResponse extends Transaction, Response {
  hash: string;

  type: Directive;
  msg: Msg;

  // Not optional (as it is in Transaction)
  from: string;

  // // The raw transaction
  // raw?: string;

  // wait: (confirmations?: number) => Promise<StakingTransactionReceipt>;
}

export interface TransactionRequest extends Omit<EthTransactionRequest, "accessList" | "type"> {
  shardID?: number;
  toShardID?: number;
}

export interface StakingTransactionRequest {
  type: Directive;
  msg: Msg;

  nonce?: number;
  gasLimit?: BigNumberish;
  gasPrice?: BigNumberish;
  chainId?: number;
}

export interface TransactionReceipt extends EthTransactionReceipt {}

export interface CXTransactionReceipt {
  blockHash: string;
  blockNumber: number;
  transactionHash: string;
  to: string;
  from: string;
  shardID: number;
  toShardID: number;
  value: BigNumberish;
}
