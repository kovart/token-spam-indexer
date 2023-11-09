export type Range = {
  startBlock: number;
  endBlock: number;
};

export type WorkerMessage =
  | {
      type: 'idle';
      payload: null;
    }
  | {
      type: 'done';
      payload: {
        blockNumber: number;
        logs: number;
        transactions: number;
      };
    };

export type MasterMessage =
  | {
      type: 'job';
      payload: Range;
    }
  | {
      type: 'shutdown';
    };
