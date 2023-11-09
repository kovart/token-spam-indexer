import { parentPort, workerData, threadId } from 'worker_threads';

import { erc1155Iface, erc20Iface, erc721Iface, retry } from './utils/helpers';
import SqlDatabaseSimplified, { TokenInsertEvent } from './utils/database-simple';
import {
  Config,
  DetailedErc1155ApprovalForAllEvent,
  DetailedErc1155TransferBatchEvent,
  DetailedErc1155TransferSingleEvent,
  DetailedErc20ApprovalEvent,
  DetailedErc20TransferEvent,
  DetailedErc721ApprovalEvent,
  DetailedErc721ApprovalForAllEvent,
  DetailedErc721TransferEvent,
  TokenContract,
  TokenStandard,
} from './types';
import {
  DATA_FOLDER_PATH,
  ERC1155_SET_APPROVAL_FOR_ALL_TOPIC,
  ERC1155_TRANSFER_BATCH_TOPIC,
  ERC1155_TRANSFER_SINGLE_TOPIC,
  ERC20_APPROVAL_TOPIC,
  ERC20_TRANSFER_TOPIC,
  ERC721_APPROVAL_FOR_ALL_TOPIC,
  ERC721_APPROVAL_TOPIC,
  ERC721_TRANSFER_TOPIC,
} from './constants';
import { MasterMessage, Range, WorkerMessage } from './worker-types';
import PromisePool from 'es6-promise-pool';
import { ethers } from 'ethers';
import path from 'path';
import { sum } from 'lodash';
import { setupDatabase, setupProvider } from './setup';

const config: Config = workerData.config;
const tokenMap: Map<string, TokenContract> = workerData.tokenMap;
const MAX_TOKEN_LOGS_PER_BLOCK = 100;

let isShutdown = false;

async function processBlock(
  blockNumber: number,
  db: SqlDatabaseSimplified,
  provider: ethers.providers.Provider,
  tokenMap: Map<string, TokenContract>,
) {
  const transactionHashSet = new Set<string>();

  const [logs, block] = await Promise.all([
    retry(() =>
      provider.getLogs({
        fromBlock: blockNumber,
        toBlock: blockNumber,
        topics: [],
      }),
    ),
    retry(() => provider.getBlockWithTransactions(blockNumber)),
  ]);

  if (!block) {
    throw new Error(`Cannot get block: ${blockNumber}`);
  }

  const erc20TransferEvents = new Set<TokenInsertEvent<DetailedErc20TransferEvent>>();
  const erc20ApprovalEvents = new Set<TokenInsertEvent<DetailedErc20ApprovalEvent>>();
  const erc721TransferEvents = new Set<TokenInsertEvent<DetailedErc721TransferEvent>>();
  const erc721ApprovalEvents = new Set<TokenInsertEvent<DetailedErc721ApprovalEvent>>();
  const erc721SetApprovalForAllEvents = new Set<
    TokenInsertEvent<DetailedErc721ApprovalForAllEvent>
  >();
  const erc1155TransferSingleEvents = new Set<
    TokenInsertEvent<DetailedErc1155TransferSingleEvent>
  >();
  const erc1155TransferBatchEvents = new Set<TokenInsertEvent<DetailedErc1155TransferBatchEvent>>();
  const erc1155SetApprovalForAllEvents = new Set<
    TokenInsertEvent<DetailedErc1155ApprovalForAllEvent>
  >();

  // token + topic -> count
  const logCountByToken = new Map<string, number>();

  for (const log of logs) {
    const token = tokenMap.get(log.address.toLowerCase());

    if (!token) continue;
    if (blockNumber > token.blockNumber + config.observationBlocks) continue;

    const key = token.address + log.topics[0];
    const logCount = logCountByToken.get(key) || 0;
    logCountByToken.set(key, logCount + 1);

    if (logCount >= MAX_TOKEN_LOGS_PER_BLOCK) {
      continue;
    }

    if (token.type === TokenStandard.Erc20) {
      if (log.topics[0] === ERC20_TRANSFER_TOPIC) {
        try {
          const parsedLog = erc20Iface.parseLog(log as any);
          if (!parsedLog) continue;

          erc20TransferEvents.add({
            from: parsedLog.args['from'].toLowerCase(),
            to: parsedLog.args['to'].toLowerCase(),
            value: BigInt(parsedLog.args['value'].toString()),
            contract: log.address.toLowerCase(),
            logIndex: log.logIndex,
            transactionHash: log.transactionHash,
          });

          transactionHashSet.add(log.transactionHash);
        } catch (e) {
          console.error(e);
        }
      } else if (log.topics[0] === ERC20_APPROVAL_TOPIC) {
        try {
          const parsedLog = erc20Iface.parseLog(log as any);
          if (!parsedLog) continue;

          erc20ApprovalEvents.add({
            spender: parsedLog.args['spender'].toLowerCase(),
            owner: parsedLog.args['owner'].toLowerCase(),
            value: BigInt(parsedLog.args['value'].toString()),
            contract: log.address.toLowerCase(),
            logIndex: log.logIndex,
            transactionHash: log.transactionHash,
          });

          transactionHashSet.add(log.transactionHash);
        } catch (e) {
          console.error(e);
        }
      }
    } else if (token.type === TokenStandard.Erc721) {
      if (log.topics[0] === ERC721_TRANSFER_TOPIC) {
        try {
          const parsedLog = erc721Iface.parseLog(log as any);
          if (!parsedLog) continue;

          erc721TransferEvents.add({
            from: parsedLog.args['from'].toLowerCase(),
            to: parsedLog.args['to'].toLowerCase(),
            tokenId: parsedLog.args['tokenId'].toString(),
            contract: log.address.toLowerCase(),
            logIndex: log.logIndex,
            transactionHash: log.transactionHash,
          });

          transactionHashSet.add(log.transactionHash);
        } catch (e) {
          console.error(e);
        }
      } else if (log.topics[0] === ERC721_APPROVAL_TOPIC) {
        try {
          const parsedLog = erc721Iface.parseLog(log as any);
          if (!parsedLog) continue;

          erc721ApprovalEvents.add({
            owner: parsedLog.args['owner'].toLowerCase(),
            approved: parsedLog.args['approved'].toLowerCase(),
            tokenId: parsedLog.args['tokenId'].toString(),
            contract: log.address.toLowerCase(),
            logIndex: log.logIndex,
            transactionHash: log.transactionHash,
          });

          transactionHashSet.add(log.transactionHash);
        } catch (e) {
          console.error(e);
        }
      } else if (log.topics[0] === ERC721_APPROVAL_FOR_ALL_TOPIC) {
        try {
          const parsedLog = erc721Iface.parseLog(log as any);
          if (!parsedLog) continue;

          erc721SetApprovalForAllEvents.add({
            owner: parsedLog.args['owner'].toLowerCase(),
            operator: parsedLog.args['operator'].toLowerCase(),
            approved: parsedLog.args['approved'],
            contract: log.address.toLowerCase(),
            logIndex: log.logIndex,
            transactionHash: log.transactionHash,
          });

          transactionHashSet.add(log.transactionHash);
        } catch (e) {
          console.error(e);
        }
      }
    } else if (token.type === TokenStandard.Erc1155) {
      if (log.topics[0] === ERC1155_TRANSFER_SINGLE_TOPIC) {
        try {
          const parsedLog = erc1155Iface.parseLog(log as any);
          if (!parsedLog) continue;

          erc1155TransferSingleEvents.add({
            from: parsedLog.args['from'].toLowerCase(),
            to: parsedLog.args['to'].toLowerCase(),
            operator: parsedLog.args['operator'].toLowerCase(),
            tokenId: parsedLog.args['id'].toString(),
            value: BigInt(parsedLog.args['value'].toString()),
            contract: log.address.toLowerCase(),
            logIndex: log.logIndex,
            transactionHash: log.transactionHash,
          });

          transactionHashSet.add(log.transactionHash);
        } catch (e) {
          console.error(e);
        }
      } else if (log.topics[0] === ERC1155_TRANSFER_BATCH_TOPIC) {
        try {
          const parsedLog = erc1155Iface.parseLog(log as any);
          if (!parsedLog) continue;

          erc1155TransferBatchEvents.add({
            from: parsedLog.args['from'].toLowerCase(),
            to: parsedLog.args['to'].toLowerCase(),
            operator: parsedLog.args['operator'].toLowerCase(),
            ids: parsedLog.args['ids'].map((id: any) => id.toString()),
            values: parsedLog.args[4].map((v: any) => BigInt(v.toString())),
            contract: log.address.toLowerCase(),
            logIndex: log.logIndex,
            transactionHash: log.transactionHash,
          });

          transactionHashSet.add(log.transactionHash);
        } catch (e) {
          console.error(e);
        }
      } else if (log.topics[0] === ERC1155_SET_APPROVAL_FOR_ALL_TOPIC) {
        try {
          const parsedLog = erc1155Iface.parseLog(log as any);
          if (!parsedLog) continue;

          erc1155SetApprovalForAllEvents.add({
            owner: parsedLog.args['account'].toLowerCase(),
            operator: parsedLog.args['operator'].toLowerCase(),
            approved: parsedLog.args['approved'],
            contract: log.address.toLowerCase(),
            logIndex: log.logIndex,
            transactionHash: log.transactionHash,
          });

          transactionHashSet.add(log.transactionHash);
        } catch (e) {
          console.error(e);
        }
      }
    }
  }

  let promises: Promise<any>[] = [];

  let txCount = 0;

  for (const tx of block.transactions) {
    const token = tokenMap.get(tx.to || '');

    if ((!tx.to || !token) && !transactionHashSet.has(tx.hash)) continue;

    if (token && blockNumber > token.blockNumber + config.observationBlocks) continue;

    txCount++;

    promises.push(
      db.addTransaction({
        hash: tx.hash,
        from: tx.from.toLowerCase(),
        to: tx.to ? tx.to.toLowerCase() : null,
        // @ts-ignore
        index: tx.transactionIndex,
        timestamp: block.timestamp,
        blockNumber: block.number,
        sighash: tx.data.slice(0, 10),
      }),
    );
  }

  await promises[promises.length - 1];

  for (const log of erc20TransferEvents) {
    promises.push(db.addErc20TransferEvent(log));
  }
  for (const log of erc20ApprovalEvents) {
    promises.push(db.addErc20ApprovalEvent(log));
  }
  for (const log of erc721TransferEvents) {
    promises.push(db.addErc721TransferEvent(log));
  }
  for (const log of erc721ApprovalEvents) {
    promises.push(db.addErc721ApprovalEvent(log));
  }
  for (const log of erc721SetApprovalForAllEvents) {
    promises.push(db.addErc721ApprovalForAllEvent(log));
  }
  for (const log of erc1155TransferSingleEvents) {
    promises.push(db.addErc1155TransferSingleEvent(log));
  }
  for (const log of erc1155TransferBatchEvents) {
    promises.push(db.addErc1155TransferBatchEvent(log));
  }
  for (const log of erc1155SetApprovalForAllEvents) {
    promises.push(db.addErc1155ApprovalForAllEvent(log));
  }

  await promises[promises.length - 1];

  const logCount = sum(
    [
      erc20TransferEvents,
      erc20ApprovalEvents,
      erc721TransferEvents,
      erc721ApprovalEvents,
      erc721SetApprovalForAllEvents,
      erc1155TransferSingleEvents,
      erc1155TransferBatchEvents,
      erc1155SetApprovalForAllEvents,
    ].map((v) => v.size),
  );

  const message: WorkerMessage = {
    type: 'done',
    payload: {
      blockNumber: blockNumber,
      transactions: txCount,
      logs: logCount,
    },
  };

  parentPort!.postMessage(message);
}

async function runJob(
  range: Range,
  db: SqlDatabaseSimplified,
  provider: ethers.providers.Provider,
) {
  function* generatePromises() {
    for (let i = range!.startBlock; i < range!.endBlock; i++) {
      if (isShutdown) return;
      yield processBlock(i, db, provider, tokenMap);
    }
  }

  // @ts-ignore
  const pool = new PromisePool(generatePromises(), config.concurrencyLimit);

  await pool.start();
}

function postIdle() {
  const idleMessage: WorkerMessage = {
    type: 'idle',
    payload: null,
  };
  parentPort!.postMessage(idleMessage);
}

async function worker() {
  const db = await setupDatabase(path.resolve(DATA_FOLDER_PATH, config.dbFile));
  const provider = setupProvider(config);

  let workerRange: Range | null = null;

  parentPort!.on('message', async (message: MasterMessage) => {
    if (message.type === 'job') {
      console.debug(
        `Worker #${threadId - 1} received job: [${message.payload.startBlock}-${
          message.payload.endBlock
        }]`,
      );

      if (workerRange) {
        throw new Error(
          `Worker is already in use with range: [${workerRange.startBlock}-${workerRange.endBlock}]`,
        );
      }

      workerRange = message.payload;

      await runJob(workerRange, db, provider);
      workerRange = null;

      postIdle();
    } else if (message.type === 'shutdown') {
      console.debug('Worker received shutdown instruction');
      isShutdown = true;
      db.close()
        .catch((err) => {
          console.error(err.message);
        })
        .finally(() => {
          console.log('Closed the database connection.');
          // Exit the worker
          parentPort!.close();
          process.exit(0);
        });
    }
  });

  postIdle();
}

worker();
