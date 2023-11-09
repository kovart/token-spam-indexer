import * as fs from 'fs';
import * as path from 'path';
import { TokenContract } from '../types';
import { getTokenStorage } from '../utils/helpers';
import { DATA_FOLDER_PATH } from '../constants';

export async function mergeTokens(srcFolder: string, destFolder: string) {
  const files = fs.readdirSync(srcFolder, { withFileTypes: true });

  const items: TokenContract[] = [];

  for (const file of files) {
    if(!file.name.includes('dune')) continue

    console.log(`Reading ${file.name}`);
    const filePath = path.resolve(srcFolder, file.name);
    const content = fs.readFileSync(filePath, { encoding: 'utf-8' });

    const json = JSON.parse(content);
    const rows = json.data.get_execution.execution_succeeded.data;

    for (const row of rows) {
      row.timestamp = new Date(row.timestamp).valueOf();
      row.address = row.contract;
      delete row.contract;

      items.push(row);
    }
  }

  items.sort((t1, t2) => t1.blockNumber - t2.blockNumber);

  const tokenStorage = getTokenStorage(destFolder, 'tokens.csv');

  console.log('Saving...');

  await tokenStorage.write(items);

  console.log('Done');
}

mergeTokens(path.resolve(DATA_FOLDER_PATH, 'dune'), DATA_FOLDER_PATH).catch((e) => {
  console.error(e);
});
