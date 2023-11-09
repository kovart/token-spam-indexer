import { ethers } from 'ethers';
import { TokenContract } from '../types';
import Erc20Abi from '../abi/erc20.json';
import Erc721Abi from '../abi/erc721.json';
import Erc1155Abi from '../abi/erc1155.json';
import { CsvStorage } from './storage';
import Logger from "./logger";

export const erc20Iface = new ethers.utils.Interface(Erc20Abi);
export const erc721Iface = new ethers.utils.Interface(Erc721Abi);
export const erc1155Iface = new ethers.utils.Interface(Erc1155Abi);

export function getTokenStorage(folder: string, file: string) {
  return new CsvStorage<TokenContract>(
    folder,
    file,
    (v) => ({
      ...v,
      type: Number(v.type),
      blockNumber: Number(v.blockNumber),
      timestamp: Number(v.timestamp),
    }),
    (v) => v,
  );
}

export async function readTokens(folderPath: string): Promise<TokenContract[]> {
  const storage = getTokenStorage(folderPath, 'tokens.csv');

  const tokens = await storage.read() || []

  return tokens;
}

export const delay = (ms: number): Promise<unknown> => new Promise((res) => setTimeout(res, ms));

export async function retry<T>(
  fn: () => Promise<T>,
  opts?: { attempts?: number; wait?: number },
): Promise<T> {
  const { attempts = 2, wait = 3 * 1000 } = opts || {};
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      if(attempt > 0) {
        console.warn(`Retrying (x${attempt})...`)
      }
      const res = await fn();
      if(attempt > 0) {
        console.warn('Successfully retried')
      }
      return res;
    } catch (e: any) {
      // eslint-disable-next-line no-console
      Logger.trace(e, `Attempt (${attempt}/${attempts})`);
      if (attempt >= attempts) {
        throw e;
      }
      attempt++;
      await delay(wait);
    }
  }
}