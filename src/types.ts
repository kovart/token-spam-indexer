import SqlDatabaseSimplified from './utils/database-simple';
import { ethers } from 'ethers';

export type Config = {
  providerUrl: string;
  providerType: 'ipc' | 'rpc';
  stateFile: string;
  tokenFile: string;
  dbFile: string;
  concurrencyLimit: number;
  threads: number;
  observationBlocks: number;
};

export type DataContainer = {
  db: SqlDatabaseSimplified;
  provider: ethers.providers.Provider;
  tokenMap: Map<string, TokenContract>;
  startBlock: number;
  endBlock: number;
};

export enum TokenStandard {
  Erc20 = 20,
  Erc721 = 721,
  Erc1155 = 1155,
}

export type CreatedContract = {
  deployer: string;
  address: string;
  timestamp: number;
  blockNumber: number;
};

export type Token = {
  type: TokenStandard;
  deployer: string;
  address: string;
};

export type TokenContract = CreatedContract & Token;

export type SimplifiedTransaction = {
  from: string;
  to: string | null;
  sighash: string;
  timestamp: number;
  blockNumber: number;
  hash: string;
  index: number;
};

export type TokenEvent = {
  transaction: SimplifiedTransaction;
  contract: string;
  logIndex: number;
};

export type Erc20TransferEvent = {
  from: string;
  to: string;
  value: BigInt;
};

export type DetailedErc20TransferEvent = TokenEvent & Erc20TransferEvent;

export type Erc20ApprovalEvent = {
  owner: string;
  spender: string;
  value: BigInt;
};

export type DetailedErc20ApprovalEvent = TokenEvent & Erc20ApprovalEvent;

export type Erc721TransferEvent = {
  from: string;
  to: string;
  tokenId: string;
};

export type DetailedErc721TransferEvent = TokenEvent & Erc721TransferEvent;

export type Erc721ApprovalEvent = {
  owner: string;
  approved: string;
  tokenId: string;
};

export type DetailedErc721ApprovalEvent = TokenEvent & Erc721ApprovalEvent;

export type Erc721ApprovalForAllEvent = {
  owner: string;
  operator: string;
  approved: boolean;
};

export type DetailedErc721ApprovalForAllEvent = TokenEvent & Erc721ApprovalForAllEvent;

export type Erc1155TransferSingleEvent = {
  operator: string;
  from: string;
  to: string;
  tokenId: string;
  value: BigInt;
};

export type DetailedErc1155TransferSingleEvent = TokenEvent & Erc1155TransferSingleEvent;

export type Erc1155TransferBatchEvent = {
  operator: string;
  from: string;
  to: string;
  ids: string[];
  values: BigInt[];
};
export type DetailedErc1155TransferBatchEvent = TokenEvent & Erc1155TransferBatchEvent;

export type Erc1155ApprovalForAllEvent = {
  owner: string;
  operator: string;
  approved: boolean;
};

export type DetailedErc1155ApprovalForAllEvent = TokenEvent & Erc1155ApprovalForAllEvent;
