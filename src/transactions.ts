import {
  arrayify,
  BytesLike,
  SignatureLike,
  splitSignature,
  stripZeros,
  hexlify,
  hexZeroPad,
  isBytesLike,
  DataOptions,
} from "@ethersproject/bytes";
import { parseUnits } from "@ethersproject/units";
import { keccak256 } from "@ethersproject/keccak256";
import { BigNumber, BigNumberish } from "@ethersproject/bignumber";
import { recoverAddress } from "@ethersproject/transactions";
import { Logger } from "@ethersproject/logger";
import * as RLP from "@ethersproject/rlp";
import { Zero, One, Two } from "@ethersproject/constants";
import { checkProperties } from "@ethersproject/properties";
import { getAddress } from "./address";
import {
  CollectRewardsMsg,
  CommissionRate,
  CreateValidatorMsg,
  DelegateMsg,
  Description,
  Directive,
  EditValidatorMsg,
  Msg,
  UndelegateMsg,
  Transaction,
  StakingTransaction,
  UnsignedTransaction,
  UnsignedStakingTransaction,
} from "./types";
const logger = new Logger("hmy_transaction/0.0.1");
const {TextEncoder, TextDecoder} = require("fastestsmallesttextencoderdecoder");
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8");

const transactionFields = [
  { name: "nonce", maxLength: 32, numeric: true },
  { name: "gasPrice", maxLength: 32, numeric: true },
  { name: "gasLimit", maxLength: 32, numeric: true },
  { name: "shardID", maxLength: 16, numeric: true },
  { name: "toShardID", maxLength: 16, numeric: true },
  { name: "to", length: 20 },
  { name: "value", maxLength: 32, numeric: true },
  { name: "data" },
];

const allowedTransactionKeys: { [key: string]: boolean } = {
  nonce: true,
  gasLimit: true,
  gasPrice: true,
  shardID: true,
  toShardID: true,
  to: true,
  value: true,
  data: true,
  chainId: true,
};

function formatNumber(value: BigNumberish, name: string): Uint8Array {
  const result = stripZeros(BigNumber.from(value).toHexString());
  if (result.length > 32) {
    logger.throwArgumentError("invalid length for " + name, "transaction:" + name, value);
  }
  return result;
}

function formatDecimal(value: BigNumberish | string): Array<string> {
  if (typeof value === "string") {
    return [parseUnits(<string>value, 18).toHexString()];
  }

  return [BigNumber.from(value).toHexString()];
}

function formatDescription(value: Partial<Description>): Array<Uint8Array> {
  return [
    textEncoder.encode(value.name ?? ""),
    textEncoder.encode(value.identity ?? ""),
    textEncoder.encode(value.website ?? ""),
    textEncoder.encode(value.securityContact ?? ""),
    textEncoder.encode(value.details ?? ""),
  ];
}

function formatComissionRates(value: CommissionRate): Array<Array<string>> {
  return [formatDecimal(value.rate), formatDecimal(value.maxRate), formatDecimal(value.maxChangeRate)];
}

function formatMsg(type: Directive, value: Msg): any {
  switch (type) {
    case Directive.CreateValidator: {
      const msg = value as CreateValidatorMsg;
      return [
        getAddress(msg.validatorAddress).checksum,
        formatDescription(msg.description),
        formatComissionRates(msg.commissionRates),
        formatNumber(msg.minSelfDelegation, "minSelfDelegation"),
        formatNumber(msg.maxTotalDelegation, "maxTotalDelegation"),
        msg.slotPubKeys.map((key) => arrayify(key)),
        msg.slotKeySigs?.map((sig) => arrayify(sig)),
        formatNumber(msg.amount, "amount"),
      ];
    }
    case Directive.EditValidator: {
      const msg = value as EditValidatorMsg;
      return [
        getAddress(msg.validatorAddress).checksum,
        msg.description ? formatDescription(msg.description) : [],
        msg.commissionRate ? formatDecimal(msg.commissionRate) : "0x",
        msg.minSelfDelegation ? formatNumber(msg.minSelfDelegation, "minSelfDelegation") : "0x",
        msg.maxTotalDelegation ? formatNumber(msg.maxTotalDelegation, "maxTotalDelegation") : "0x",
        msg.slotKeyToRemove ? hexlify(msg.slotKeyToRemove) : "0x",
        msg.slotKeyToAdd ? hexlify(msg.slotKeyToAdd) : "0x",
        msg.slotKeySig ? hexlify(msg.slotKeySig) : "0x",
        msg.active != null ? (msg.active ? One.toHexString() : Two.toHexString()) : Zero.toHexString(),
      ];
    }
    case Directive.Delegate:
    case Directive.Undelegate: {
      const msg = value as DelegateMsg | UndelegateMsg;
      return [getAddress(msg.delegatorAddress).checksum, getAddress(msg.validatorAddress).checksum, formatNumber(msg.amount, "amount")];
    }
    case Directive.CollectRewards: {
      const msg = value as CollectRewardsMsg;
      return [getAddress(msg.delegatorAddress).checksum];
    }
    default:
      logger.throwArgumentError("invalid type", "type", hexlify(type));
  }
}

export function serialize(transaction: UnsignedStakingTransaction | UnsignedTransaction, signature?: SignatureLike): string {
  if ("type" in transaction) {
    return serializeStakingTransaction(transaction, signature);
  }

  return serializeTransaction(transaction, signature);
}

function serializeTransaction(transaction: UnsignedTransaction, signature?: SignatureLike): string {
  checkProperties(transaction, allowedTransactionKeys);

  const fields: Array<string | Uint8Array> = [];

  transactionFields.forEach(function (fieldInfo) {
    let value = (<any>transaction)?.[fieldInfo.name] ?? [];
    const options: DataOptions = {};

    if (fieldInfo.numeric) {
      options.hexPad = "left";
    }

    value = arrayify(hexlify(value, options));

    // Fixed-width field
    if (fieldInfo.length && value.length !== fieldInfo.length && value.length > 0) {
      logger.throwArgumentError("invalid length for " + fieldInfo.name, "transaction:" + fieldInfo.name, value);
    }

    // Variable-width (with a maximum)
    if (fieldInfo.maxLength) {
      value = stripZeros(value);
      if (value.length > fieldInfo.maxLength) {
        logger.throwArgumentError("invalid length for " + fieldInfo.name, "transaction:" + fieldInfo.name, value);
      }
    }

    fields.push(hexlify(value));
  });

  return encodeTransaction(transaction, fields, signature);
}

export function serializeStakingTransaction(transaction: UnsignedStakingTransaction, signature?: SignatureLike): string {
  const fields: any = [
    transaction.type === 0 ? "0x" : BigNumber.from(transaction.type).toHexString(),
    formatMsg(transaction.type, transaction.msg),
    formatNumber(transaction.nonce || 0, "nonce"),
    formatNumber(transaction.gasPrice || 0, "gasPrice"),
    formatNumber(transaction.gasLimit || 0, "gasLimit"),
  ];

  return encodeTransaction(transaction, fields, signature);
}

function encodeTransaction(transaction: UnsignedTransaction, fields: Array<string | Uint8Array>, signature?: SignatureLike): string {
  let chainId = 1;
  if (transaction.chainId != null) {
    // A chainId was provided; if non-zero we'll use EIP-155
    chainId = transaction.chainId;

    if (typeof chainId !== "number") {
      logger.throwArgumentError("invalid transaction.chainId", "transaction", transaction);
    }
  } else if (signature && !isBytesLike(signature) && signature.v && signature.v > 28 ) {
    // No chainId provided, but the signature is signing with EIP-155; derive chainId
    chainId = Math.floor((signature.v - 35) / 2);
  }

  fields.push(hexlify(chainId)); // @TODO: hexValue?
  fields.push("0x");
  fields.push("0x");

  // Requesting an unsigned transation
  if (!signature) {
    return RLP.encode(fields);
  }

  const sig = splitSignature(signature);
  let v = 27 + (sig.recoveryParam || 0);
  fields.pop();
  fields.pop();
  fields.pop();
  v += chainId * 2 + 8;

  fields.push(hexlify(v));
  fields.push(stripZeros(arrayify(sig.r) || []));
  fields.push(stripZeros(arrayify(sig.s) || []));

  return RLP.encode(fields);
}

function handleAddress(value: string): string {
  if (value === "0x") {
    return '';
  }
  return getAddress(value).checksum;
}

function handleNumber(value: string): BigNumber {
  if (value === "0x") {
    return Zero;
  }
  return BigNumber.from(value);
}

function handleDecimal(value: string): string {
  return value;
}

function handleText(value: string): string {
  return textDecoder.decode(arrayify(value));
}

function handleValidatorDescription(value: Array<string>): Description {
  return {
    name: handleText(value[0]),
    identity: handleText(value[1]),
    website: handleText(value[2]),
    securityContact: handleText(value[3]),
    details: handleText(value[4]),
  };
}

function handleValidatorCommissionRates(value: Array<string>): CommissionRate {
  return {
    rate: handleDecimal(value[0]),
    maxRate: handleDecimal(value[1]),
    maxChangeRate: handleDecimal(value[2]),
  };
}

function handleActive(value: string): boolean | null {
  const status = BigNumber.from(value);

  if (status.eq(Zero)) {
    return null;
  }

  if (status.eq(One)) {
    return true;
  }

  if (status.eq(Two)) {
    return false;
  }

  return null;
}

function handleMsg(type: Directive, value: Array<string | Array<string>>): Msg | null {
  switch (type) {
    case Directive.CreateValidator:
      return {
        validatorAddress: handleAddress(<string>value[0]),
        description: handleValidatorDescription(<Array<string>>value[1]),
        commissionRates: handleValidatorCommissionRates(<Array<string>>value[2]),
        minSelfDelegation: handleNumber(<string>value[3]),
        maxTotalDelegation: handleNumber(<string>value[4]),
        slotPubKeys: value[5],
        slotKeySigs: value[6],
        amount: handleNumber(<string>value[7]),
      } as CreateValidatorMsg;
    case Directive.EditValidator:
      return {
        validatorAddress: handleAddress(<string>value[0]),
        description: handleValidatorDescription(<Array<string>>value[1]),
        commissionRate: handleDecimal(<string>value[2]),
        minSelfDelegation: handleNumber(<string>value[3]),
        maxTotalDelegation: handleNumber(<string>value[4]),
        slotKeyToRemove: value[5],
        slotKeyToAdd: value[6],
        slotKeySig: value[7],
        active: handleActive(<string>value[8]),
      } as EditValidatorMsg;
    case Directive.Undelegate:
    case Directive.Delegate:
      return {
        delegatorAddress: handleAddress(<string>value[0]),
        validatorAddress: handleAddress(<string>value[1]),
        amount: handleNumber(<string>value[2]),
      } as DelegateMsg | UndelegateMsg;
    case Directive.CollectRewards:
      return {
        delegatorAddress: handleAddress(<string>value[0]),
      } as CollectRewardsMsg;
    default:
      logger.throwArgumentError("invalid type", "type", hexlify(type));
      return null;
  }
}

function handleStakingTransaction(transaction: any): StakingTransaction {
  if (transaction.length !== 5 && transaction.length !== 8) {
    logger.throwArgumentError("invalid component count for staking transaction", "payload", "");
  }

  const directive: Directive = transaction[0] === "0x" ? 0 : handleNumber(transaction[0]).toNumber();

  const tx: StakingTransaction = {
    type: directive,
    msg: handleMsg(directive, transaction[1]),
    nonce: handleNumber(transaction[2]).toNumber(),
    gasPrice: handleNumber(transaction[3]),
    gasLimit: handleNumber(transaction[4]),
    chainId: 1,
  };

  // Unsigned Transaction
  if (transaction.length === 5) {
    return tx;
  }

  try {
    tx.v = BigNumber.from(transaction[5]).toNumber();
  } catch (error) {
    return tx;
  }

  tx.r = hexZeroPad(transaction[6], 32);
  tx.s = hexZeroPad(transaction[7], 32);

  if (BigNumber.from(tx.r).isZero() && BigNumber.from(tx.s).isZero()) {
    // EIP-155 unsigned transaction
    tx.chainId = tx.v;
    tx.v = 0;
  } else {
    // Signed Tranasaction

    tx.chainId = Math.floor((tx.v - 35) / 2);

    let recoveryParam = tx.v - 27;

    const raw = transaction.slice(0, 5);

    raw.push(hexlify(tx.chainId));
    raw.push("0x");
    raw.push("0x");
    recoveryParam -= tx.chainId * 2 + 8;

    const digest = keccak256(RLP.encode(raw));
    try {
      tx.from = recoverAddress(digest, { r: hexlify(tx.r), s: hexlify(tx.s), recoveryParam: recoveryParam });
    } catch (error) {}

    tx.hash = keccak256(RLP.encode(transaction));
  }

  return tx;
}

function handleTransaction(transaction: any): Transaction {
  if (transaction.length !== 11 && transaction.length !== 8) {
    logger.throwArgumentError("invalid raw transaction", "transaction", "");
  }

  const tx: Transaction = {
    nonce: handleNumber(transaction[0]).toNumber(),
    gasPrice: handleNumber(transaction[1]),
    gasLimit: handleNumber(transaction[2]),
    shardID: handleNumber(transaction[3]),
    toShardID: handleNumber(transaction[4]),
    to: handleAddress(transaction[5]),
    value: handleNumber(transaction[6]),
    data: transaction[7],
    chainId: 1,
  };

  // Legacy unsigned transaction
  if (transaction.length === 8) {
    return tx;
  }

  try {
    tx.v = BigNumber.from(transaction[8]).toNumber();
  } catch (error) {
    return tx;
  }

  tx.r = hexZeroPad(transaction[9], 32);
  tx.s = hexZeroPad(transaction[10], 32);

  if (BigNumber.from(tx.r).isZero() && BigNumber.from(tx.s).isZero()) {
    // EIP-155 unsigned transaction
    tx.chainId = tx.v;
    tx.v = 0;
  } else {
    // Signed Tranasaction

    tx.chainId = Math.floor((tx.v - 35) / 2);

    let recoveryParam = tx.v - 27;

    const raw = transaction.slice(0, 8);

    raw.push(hexlify(tx.chainId));
    raw.push("0x");
    raw.push("0x");
    recoveryParam -= tx.chainId * 2 + 8;

    const digest = keccak256(RLP.encode(raw));
    try {
      tx.from = recoverAddress(digest, { r: hexlify(tx.r), s: hexlify(tx.s), recoveryParam: recoveryParam });
    } catch (error) {}

    tx.hash = keccak256(RLP.encode(transaction));
  }

  return tx;
}

export function parseTransaction(payload: BytesLike): Transaction {
  return handleTransaction(RLP.decode(arrayify(payload)));
}

export function parseStakingTransaction(payload: BytesLike): StakingTransaction {
  return handleStakingTransaction(RLP.decode(arrayify(payload)));
}

export function parse(rawTransaction: BytesLike): StakingTransaction | Transaction {
  const payload = arrayify(rawTransaction);
  const transaction = RLP.decode(payload);

  if (Array.isArray(transaction[1])) {
    return handleStakingTransaction(transaction);
  }

  return handleTransaction(transaction);
}
