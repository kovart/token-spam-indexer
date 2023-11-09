class Estimator {
  buffer: { block: number; timestamp: number }[] = [];

  addBlock(block: number) {
    if (this.buffer.length > 10000) {
      this.buffer = this.buffer.slice(-10000);
    }

    this.buffer.push({ block, timestamp: Date.now() });
  }

  getEtaInMs(remainingBlocks: number): number {
    if (this.buffer.length < 30) {
      // Not enough data to calculate the ETA
      return -1;
    }

    const sortedByTimestamp = [...this.buffer].sort((a, b) => a.timestamp - b.timestamp);
    const sortedByBlocks = [...this.buffer].sort((a, b) => a.block - b.block);

    const timeDiff =
      sortedByTimestamp[sortedByTimestamp.length - 1].timestamp - sortedByTimestamp[0].timestamp;
    const blockDiff = sortedByBlocks[sortedByBlocks.length - 1].block - sortedByBlocks[0].block;
    const averageTimePerBlock = timeDiff / blockDiff;

    return averageTimePerBlock * remainingBlocks;
  }

  formatEta(etaMs: number) {
    // Convert milliseconds to the appropriate format "DD hh mm ss"
    const seconds = Math.floor((etaMs / 1000) % 60);
    const minutes = Math.floor((etaMs / (1000 * 60)) % 60);
    const hours = Math.floor((etaMs / (1000 * 60 * 60)) % 24);
    const days = Math.floor(etaMs / (1000 * 60 * 60 * 24));

    return `${days.toString().padStart(2, '0')}d ${hours.toString().padStart(2, '0')}h ${minutes
      .toString()
      .padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
  }

  getFormattedEta(remainingBlocks: number): string {
    const etaMs = this.getEtaInMs(remainingBlocks);

    if (etaMs < 0) return 'Estimating';

    return this.formatEta(etaMs);
  }

  avgBlockTime() {
    if (this.buffer.length < 2) return 0;

    const sortedByTimestamp = [...this.buffer].sort((a, b) => a.timestamp - b.timestamp);
    const sortedByBlocks = [...this.buffer].sort((a, b) => a.block - b.block);

    const timeDiff = sortedByTimestamp[sortedByTimestamp.length - 1].timestamp - sortedByTimestamp[0].timestamp;
    const blockDiff = sortedByBlocks[sortedByBlocks.length - 1].block - sortedByBlocks[0].block;
    return timeDiff / blockDiff;
  }

  getLowestBlock(lastBlocks: number) {
    const copy = this.buffer.slice();
    copy.sort((b1, b2) => b1.block - b2.block);

    return copy.slice(-lastBlocks)[0]?.block;
  }
}

export default Estimator;
