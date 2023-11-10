import { Worker } from 'worker_threads';
import { program } from 'commander';
import Estimator from './utils/estimator';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { DATA_FOLDER_PATH, RPC_URL } from './constants';
import { addTokens, setup } from './setup';
import { MasterMessage, Range, WorkerMessage } from './worker-types';
import { Config } from './types';

// ARGS
// -----------------------------

const options = program
  .option('--ipc')
  .option('-c, --concurrency <number>')
  .option('-t --threads <number>')
  .parse()
  .opts();

if (!options.ipc && !RPC_URL) {
  throw new Error('No RPC_URL provided');
}

// Constants
// -----------------------------

const OBSERVATION_PERIOD = 4 * 30 * 24 * 60 * 60; // secs
const AVG_BLOCK_TIME = 2.1; // secs
const WORKER_BLOCK_RANGE = 10_000; // blocks

// Configuration
// -----------------------------

const config: Config = {
  providerUrl: options.ipc ? '/root/.bor/bor.ipc' : RPC_URL!,
  providerType: options.ipc ? 'ipc' : 'rpc',
  stateFile: 'state.json',
  tokenFile: 'tokens.csv',
  dbFile: 'storage.db',
  threads: Number(options.threads) || 6,
  observationBlocks: Math.ceil(OBSERVATION_PERIOD / AVG_BLOCK_TIME),
  concurrencyLimit: options.concurrency ? Number(options.concurrency) : 50,
};

export interface State {
  isTokensAdded: boolean;
  lastProcessedBlock: number;
}

const defaultState: State = { lastProcessedBlock: 0, isTokensAdded: false };
let state: State = defaultState;

// Load state
if (existsSync(path.resolve(DATA_FOLDER_PATH, config.stateFile))) {
  state = JSON.parse(readFileSync(path.resolve(DATA_FOLDER_PATH, config.stateFile), 'utf8'));
}

// Save state
function saveState() {
  writeFileSync(path.resolve(DATA_FOLDER_PATH, config.stateFile), JSON.stringify(state));
}

function shutdown() {
  console.warn('Graceful shutdown...');
  saveState();
  process.exit();
}

async function main() {
  console.debug(`Start initializing`);

  const dataContainer = await setup(config);

  if (!state.isTokensAdded) {
    await addTokens(dataContainer);

    state.isTokensAdded = true;
    saveState();
  }

  console.info(`Data URL: ${config.providerUrl}`);
  console.info(`Concurrency: ${config.concurrencyLimit}`);
  console.debug(`Tokens: ${dataContainer.tokenMap.size}`);
  console.debug(`Start block: ${dataContainer.startBlock!}. End block: ${dataContainer.endBlock}`);

  const threads = config.threads;
  const workers: Worker[] = new Array(threads);
  const estimators: Estimator[] = [];

  let availableRange = {
    startBlock:
      state.lastProcessedBlock > 0
        ? Math.max(state.lastProcessedBlock, dataContainer.startBlock)
        : dataContainer.startBlock,
    endBlock: dataContainer.endBlock,
  };

  let prevSaveAt = -1;
  let prevLogAt = -1;
  let intervalLogs = 0;
  let intervalTxs = 0;

  for (let i = 0; i < threads; i++) {
    const workerPath = path.resolve(__dirname, './worker.ts');
    const worker = new Worker(workerPath, {
      execArgv: /\.ts$/.test(workerPath) ? ['--require', 'ts-node/register'] : undefined,
      workerData: {
        config: config,
        tokenMap: dataContainer.tokenMap,
      },
    });
    const estimator = new Estimator();

    estimators[i] = estimator;
    workers[i] = worker;

    worker.on('message', (message: WorkerMessage) => {
      if (message.type === 'idle') {
        console.debug(`Worker #${worker.threadId - 1} is idle`);

        if (availableRange.endBlock - availableRange.startBlock <= 0) {
          console.warn(`No more data to process`);
          console.warn(`Unref worker #${worker.threadId - 1}}`);
          worker.unref();
        }

        const nextRange: Range = {
          startBlock: availableRange.startBlock,
          endBlock: Math.min(availableRange.startBlock + WORKER_BLOCK_RANGE, availableRange.endBlock),
        };

        availableRange.startBlock = nextRange.endBlock + 1;

        const masterMessage: MasterMessage = {
          type: 'job',
          payload: nextRange,
        };

        console.debug(
          `Push block range to worker #${worker.threadId - 1}: [${nextRange.startBlock}-${
            nextRange.endBlock
          }]`,
        );
        worker.postMessage(masterMessage);
      } else if (message.type == 'done') {
        estimator.addBlock(message.payload.blockNumber);
        state.lastProcessedBlock =
          estimator.getLowestBlock(config.concurrencyLimit) || state.lastProcessedBlock;

        if (
          message.payload.blockNumber === dataContainer.endBlock ||
          Date.now() - prevSaveAt >= 5e3
        ) {
          prevSaveAt = Date.now();

          saveState();
        }

        intervalLogs += message.payload.logs
        intervalTxs += message.payload.transactions

        if(Date.now() - prevLogAt >= 1e3) {
          prevLogAt = Date.now();

          let totalEta = 0;
          for (const estimator of estimators) {
            totalEta += estimator.getEtaInMs(dataContainer.endBlock - state.lastProcessedBlock);
          }

          let totalAvgBlockTime = 0;
          for (const estimator of estimators) {
            totalAvgBlockTime += estimator.avgBlockTime();
          }

          const averageEta = totalEta / estimators.length / threads;
          const averageBlockTime = totalAvgBlockTime / estimators.length / threads;

          const eta = estimator.formatEta(averageEta);
          const blocksPerSecond = Math.floor(1 / (averageBlockTime / 1000));
          const range = `${state.lastProcessedBlock}/${dataContainer.endBlock}`;
          console.log(
            `[${eta}] [${blocksPerSecond}B/s] [${range}] ` +
            `Current block: #${message.payload.blockNumber}. ` +
            `Logs: ${intervalLogs}. ` +
            `Txs: ${intervalTxs}`,
          );

          intervalLogs = 0
          intervalTxs = 0
        }
      }
    });

    worker.on('error', (err: any) => {
      console.error('Worker error', err);
      process.exit(1);
    });

    worker.on('exit', (code: number) => {
      if (code !== 0) {
        console.error(`Worker #${worker.threadId - 1} stopped with exit code ${code}`);
      }
    });
  }

  process.on('SIGINT', () => {
    console.log('Main thread received SIGINT. Shutting down workers.');

    // Notify each worker to shut down
    const shutdownMessage: MasterMessage = {
      type: 'shutdown',
    };
    workers.forEach((worker) => worker.postMessage(shutdownMessage));

    // Wait for workers to shut down
    Promise.all(
      workers.map((worker, i) => {
        return new Promise((resolve) => {
          worker.on('exit', () => {
            console.log(`Worker ${i + 1} has stopped.`);
            resolve(true);
          });
        });
      }),
    ).then(() => {
      console.log('All workers have stopped. Exiting main thread.');
      shutdown();
    });
  });
}

main().catch((e) => {
  console.error(e);
});
