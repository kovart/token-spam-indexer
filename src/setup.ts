import { ethers } from 'ethers';
import SqlDatabaseSimplified from './utils/database-simple';
import path from 'path';
import { DATA_FOLDER_PATH } from './constants';
import { readTokens } from './utils/helpers';
import { Config, DataContainer, TokenContract } from './types';

export function setupProvider(config: Config) {
  let provider: ethers.providers.Provider;

  if (config.providerType === 'ipc') {
    provider = new ethers.providers.IpcProvider(config.providerUrl);
  } else {
    provider = new ethers.providers.JsonRpcProvider(config.providerUrl);
  }

  return provider;
}

export async function setup(config: Config): Promise<DataContainer> {
  let tokenMap: Map<string, TokenContract>;
  let startBlock: number = -1;
  let endBlock: number = -1;

  const db = await setupDatabase(path.resolve(DATA_FOLDER_PATH, config.dbFile))

  const provider = setupProvider(config);
  const tokens = await readTokens(DATA_FOLDER_PATH);

  if (!tokens.length) throw new Error('No tokens');

  tokenMap = new Map();
  for (const token of tokens) {
    tokenMap.set(token.address.toLowerCase(), token);

    if (startBlock < 0 || startBlock > token.blockNumber) {
      startBlock = token.blockNumber;
    }

    if (endBlock < 0 || endBlock < token.blockNumber) {
      endBlock = token.blockNumber;
    }
  }

  const latestBlock = await provider.getBlockNumber();
  endBlock = Math.min(latestBlock, endBlock! + config.observationBlocks);

  return {
    db,
    provider,
    tokenMap,
    startBlock,
    endBlock,
  };
}

export async function addTokens(dataContainer: DataContainer) {
  const { db, tokenMap } = dataContainer;

  console.debug('Add tokens to DB');

  const tokens = [...tokenMap.values()];
  for (let i = 0; i < tokens.length; i++) {
    console.log(`Add token #${i}`);

    const token = tokens[i];

    db.addToken(token);

    if (i % 500 === 0) {
      await db.wait();
      console.debug(`Added ${i} tokens`);
    }
  }

  await db.wait();

  console.debug('Tokens have been added');
}

export async function setupDatabase(filePath: string) {
  const db = new SqlDatabaseSimplified(filePath);
  await db.initialize();
  return db;
}