/* eslint-disable no-console */
import sqlite3 from 'sqlite3';
import {
  DetailedErc1155ApprovalForAllEvent,
  DetailedErc1155TransferBatchEvent,
  DetailedErc1155TransferSingleEvent,
  DetailedErc20ApprovalEvent,
  DetailedErc20TransferEvent,
  DetailedErc721ApprovalEvent,
  DetailedErc721ApprovalForAllEvent,
  DetailedErc721TransferEvent,
  SimplifiedTransaction,
  TokenContract,
  TokenEvent,
} from '../types';

export type EventWithTransactionHash = { transactionHash: string };

export type TokenInsertEvent<T extends TokenEvent> = Omit<T, 'transaction'> &
  EventWithTransactionHash;

// In order to make the database more performance, it was decided to avoid using NULL as the address value (tx.to).
// Using non-null values allows us to use the `=` operator, instead of `IS` which is slower.
const wrapNull = (v: any) => (v == null ? 'NULL' : v);
const unwrapNull = (v: any) => (v === 'NULL' ? null : v);

class SqlDatabaseSimplified {
  public db: sqlite3.Database;

  constructor(filename = ':memory:') {
    this.db = new sqlite3.Database(filename, (err) => {
      if (err) return console.error(err.message);
      console.info('Connected to the SQlite database.');
    });

    this.db.on('error', (err) => console.error(err));
  }

  async initialize(): Promise<void> {
    this.db.serialize();

    this.db.run(`PRAGMA foreign_keys = ON`);
    this.db.run(`PRAGMA journal_mode=WAL`);
    this.db.run(`PRAGMA busy_timeout = 15000`); // 15s
    this.db.run(`PRAGMA cache_size = 10000`); // 40 mb

    this.db.run(`CREATE TABLE IF NOT EXISTS contracts (
      contract_id INTEGER PRIMARY KEY,
      address VARCHAR(42) NOT NULL UNIQUE,
      deployer_address VARCHAR(42) NOT NULL,
      block_number INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      type SMALLINT NOT NULL
    )`);

    this.db.run(`CREATE TABLE IF NOT EXISTS transactions (
      transaction_hash VARCHAR(66) PRIMARY KEY NOT NULL,
      from_address VARCHAR(42) NOT NULL,
      to_address VARCHAR(42),
      sighash VARCHAR(10) NOT NULL,
      block_number INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      tx_index INTEGER NOT NULL
    )`);

    this.db.run(`CREATE TABLE IF NOT EXISTS erc_20_transfer_events (
      from_address VARCHAR(42) NOT NULL,
      to_address VARCHAR(42) NOT NULL,
      value TEXT NOT NULL,
      transaction_hash VARCHAR(66) NOT NULL,
      contract_id INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      PRIMARY KEY (transaction_hash, log_index)
    )`);

    this.db.run(`CREATE TABLE IF NOT EXISTS erc_20_approval_events (
      owner_address VARCHAR(42) NOT NULL,
      spender_address VARCHAR(42) NOT NULL,
      value TEXT NOT NULL,
      transaction_hash VARCHAR(66) NOT NULL,
      contract_id INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      PRIMARY KEY (transaction_hash, log_index)
    )`);

    this.db.run(`CREATE TABLE IF NOT EXISTS erc_721_transfer_events (
      from_address VARCHAR(42) NOT NULL,
      to_address VARCHAR(42) NOT NULL,
      token_id TEXT NOT NULL,
      transaction_hash VARCHAR(66) NOT NULL,
      contract_id INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      PRIMARY KEY (transaction_hash, log_index)
    )`);

    this.db.run(`CREATE TABLE IF NOT EXISTS erc_721_approval_events (
      owner_address VARCHAR(42) NOT NULL,
      approved_address VARCHAR(42) NOT NULL,
      token_id TEXT NOT NULL,
      transaction_hash VARCHAR(66) NOT NULL,
      contract_id INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      PRIMARY KEY (transaction_hash, log_index)
    )`);

    this.db.run(`CREATE TABLE IF NOT EXISTS erc_721_approval_for_all_events (
      transaction_hash VARCHAR(66) NOT NULL,
      contract_id INTEGER NOT NULL,
      owner_address VARCHAR(42) NOT NULL,
      operator_address VARCHAR(42) NOT NULL,
      approved BOOLEAN NOT NULL,
      log_index INTEGER NOT NULL,
      PRIMARY KEY (transaction_hash, log_index)
    )`);

    this.db.run(`CREATE TABLE IF NOT EXISTS erc_1155_transfer_single_events (
      operator_address VARCHAR(42) NOT NULL,
      from_address VARCHAR(42) NOT NULL,
      to_address VARCHAR(42) NOT NULL,
      token_id TEXT NOT NULL,
      value TEXT NOT NULL,
      transaction_hash VARCHAR(66) NOT NULL,
      contract_id INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      PRIMARY KEY (transaction_hash, log_index)
    )`);

    this.db.run(`CREATE TABLE IF NOT EXISTS erc_1155_transfer_batch_events (
      operator_address VARCHAR(42) NOT NULL,
      from_address VARCHAR(42) NOT NULL,
      to_address VARCHAR(42) NOT NULL,
      token_ids TEXT NOT NULL,
      token_values TEXT NOT NULL,
      transaction_hash VARCHAR(66) NOT NULL,
      contract_id INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      PRIMARY KEY (transaction_hash, log_index)
    )`);

    this.db.run(`CREATE TABLE IF NOT EXISTS erc_1155_approval_for_all_events (
      owner_address VARCHAR(42) NOT NULL,
      operator_address VARCHAR(42) NOT NULL,
      approved BOOLEAN NOT NULL,
      transaction_hash VARCHAR(66) NOT NULL,
      contract_id INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      PRIMARY KEY (transaction_hash, log_index)
    )`);
  }

  async getTokens(): Promise<TokenContract[]> {
    return await this.all<TokenContract[]>(
      `SELECT a.address AS address, d.address AS deployer, c.block_number as "blockNumber", c.timestamp, c.type   
      FROM contracts c
      JOIN addresses a ON c.address_id = a.address_id
      JOIN addresses d ON c.deployer_id = d.address_id`,
    );
  }

  async getTransactions(params: { to: string | null }): Promise<SimplifiedTransaction[]> {
    return (
      await this.all<(Omit<SimplifiedTransaction, 'index'> & { txIndex: number })[]>(
        `SELECT t.transaction_hash as hash, t.tx_index AS "txIndex", t.sighash, t.timestamp, t.block_number AS "blockNumber", from_a.address AS "from", "${wrapNull(
          params.to,
        )}" AS "to"
      FROM (
        SELECT *
        FROM transactions t
        WHERE t.to_id = (
            SELECT address_id
            FROM addresses a
            WHERE a.address = $to_address
        )
      ) t
      JOIN addresses from_a ON t.from_id = from_a.address_id
      ORDER BY blockNumber, txIndex
      `,
        { $to_address: wrapNull(params.to) },
      )
    ).map((v) => ({
      hash: v.hash,
      sighash: v.sighash,
      to: unwrapNull(v.to),
      from: v.from,
      blockNumber: v.blockNumber,
      timestamp: v.timestamp,
      index: v.txIndex,
    }));
  }

  private async getEvents<P extends string>(table: string, contract: string, fields: P[] = []) {
    type DBRow = {
      [key in P]: any;
    } & {
      contract: string;
      tx_hash: string;
      tx_from: string;
      tx_to: string;
      tx_sighash: string;
      tx_block_number: number;
      tx_timestamp: number;
      tx_index: number;
      log_index: number;
    };

    const rows = await this.all<DBRow[]>(
      `SELECT 
          e.log_index AS "log_index",
          ${fields.map((f) => `e."${f}" AS "${f}"`).join(',')},
          t.transaction_hash AS "tx_hash", 
          t.from_address AS "tx_from", 
          t.to_address AS "tx_to", 
          t.sighash AS "tx_sighash", 
          t.block_number AS "tx_block_number",
          t.timestamp AS "tx_timestamp",
          t.tx_index AS "tx_index"
      FROM (
        SELECT *
        FROM ${table} e
        WHERE e.contract_id = (
            SELECT contract_id
            FROM contracts a
            WHERE a.address = $contract_address
        )
      ) e
      JOIN transactions t ON e.transaction_hash = t.transaction_hash
      ORDER BY tx_block_number, tx_index, log_index
      `,
      { $contract_address: wrapNull(contract) },
    );

    type ResultEventType = {
      [key in P]: any;
    } & { contract: string; transaction: SimplifiedTransaction; logIndex: number };

    return rows.map((e) => {
      const obj = {
        contract: contract,
        transaction: {
          from: e.tx_from,
          to: unwrapNull(e.tx_to),
          hash: e.tx_hash,
          blockNumber: e.tx_block_number,
          timestamp: e.tx_timestamp,
          sighash: e.tx_sighash,
          index: e.tx_index,
        },
        logIndex: e.log_index,
      } as ResultEventType;

      for (const field of fields) {
        // TODO Fix strange TS issue
        // @ts-ignore
        obj[field] = e[field];
      }

      return obj;
    });
  }

  async getErc20ApprovalEvents(params: {
    contract: string;
  }): Promise<DetailedErc20ApprovalEvent[]> {
    return (
      await this.getEvents('erc_20_approval_events', params.contract, [
        'owner_address',
        'spender_address',
        'value',
      ])
    ).map((v) => ({
      owner: v.owner_address,
      spender: v.spender_address,
      value: BigInt(v.value),
      contract: v.contract,
      transaction: v.transaction,
      logIndex: v.logIndex,
    }));
  }

  async getErc20TransferEvents(params: {
    contract: string;
  }): Promise<DetailedErc20TransferEvent[]> {
    return (
      await this.getEvents('erc_20_transfer_events', params.contract, [
        'from_address',
        'to_address',
        'value',
      ])
    ).map((v) => ({
      from: v.from_address,
      to: v.to_address,
      value: BigInt(v.value),
      contract: v.contract,
      transaction: v.transaction,
      logIndex: v.logIndex,
    }));
  }

  async getErc721ApprovalEvents(params: {
    contract: string;
  }): Promise<DetailedErc721ApprovalEvent[]> {
    return (
      await this.getEvents('erc_721_approval_events', params.contract, [
        'owner_address',
        'approved_address',
        'token_id',
      ])
    ).map((v) => ({
      owner: v.owner_address,
      approved: v.approved_address,
      tokenId: v.token_id,
      contract: v.contract,
      transaction: v.transaction,
      logIndex: v.logIndex,
    }));
  }

  async getErc721TransferEvents(params: {
    contract: string;
  }): Promise<DetailedErc721TransferEvent[]> {
    return (
      await this.getEvents('erc_721_transfer_events', params.contract, [
        'from_address',
        'to_address',
        'token_id',
      ])
    ).map((v) => ({
      from: v.from_address,
      to: v.to_address,
      tokenId: v.token_id,
      contract: v.contract,
      transaction: v.transaction,
      logIndex: v.logIndex,
    }));
  }

  async getErc721ApprovalForAllEvents(params: {
    contract: string;
  }): Promise<DetailedErc721ApprovalForAllEvent[]> {
    return (
      await this.getEvents('erc_721_approval_for_all_events', params.contract, [
        'owner_address',
        'operator_address',
        'approved',
      ])
    ).map((v) => ({ ...v, owner: v.owner_address, operator: v.operator_address }));
  }

  async getErc1155ApprovalForAllEvents(params: {
    contract: string;
  }): Promise<DetailedErc1155ApprovalForAllEvent[]> {
    return (
      await this.getEvents('erc_1155_approval_for_all_events', params.contract, [
        'owner_address',
        'operator_address',
        'approved',
      ])
    ).map((v) => ({ ...v, operator: v.operator_address, owner: v.owner_address }));
  }

  async getErc1155TransferSingleEvents(params: {
    contract: string;
  }): Promise<DetailedErc1155TransferSingleEvent[]> {
    return (
      await this.getEvents('erc_1155_transfer_single_events', params.contract, [
        'operator_address',
        'from_address',
        'to_address',
        'token_id',
        'value',
      ])
    ).map((v) => ({
      operator: v.operator_address,
      from: v.from_address,
      to: v.to_address,
      tokenId: v.token_id,
      value: BigInt(v.value),
      contract: v.contract,
      transaction: v.transaction,
      logIndex: v.logIndex,
    }));
  }
  async getErc1155TransferBatchEvents(params: {
    contract: string;
  }): Promise<DetailedErc1155TransferBatchEvent[]> {
    return (
      await this.getEvents('erc_1155_transfer_batch_events', params.contract, [
        'operator_address',
        'from_address',
        'to_address',
        'token_ids',
        'token_values',
      ])
    ).map((v) => ({
      operator: v.operator_address,
      from: v.from_address,
      to: v.to_address,
      ids: v.token_ids.split(',').map((v: string) => BigInt(v)),
      values: v.token_values.split(',').map((v: string) => BigInt(v)),
      contract: v.contract,
      transaction: v.transaction,
      logIndex: v.logIndex,
    }));
  }

  addToken(token: TokenContract) {
    // `contract_id` has the same value as `address_id`
    this.db.run(
      `INSERT OR IGNORE INTO contracts(contract_id, address, deployer_address, block_number, timestamp, type)
      VALUES (
        (SELECT contract_id FROM contracts WHERE address = $address), 
        $address, 
        $deployer, 
        $block_number,
        $timestamp,
        $type
      )`,
      {
        $address: token.address,
        $deployer: token.deployer,
        $block_number: token.blockNumber,
        $timestamp: token.timestamp,
        $type: token.type,
      },
    );
  }

  async addTransaction(tx: SimplifiedTransaction): Promise<number> {
    return new Promise((res, rej) => {
      this.db.run(
        `INSERT INTO transactions(transaction_hash, sighash, from_address, to_address, block_number, tx_index, timestamp) 
            SELECT 
              $hash, 
              $sighash, 
              $from, 
              $to, 
              $block_number, 
              $tx_index,
              $timestamp
            WHERE NOT EXISTS (
                SELECT 1 FROM transactions WHERE transaction_hash = $hash
            )
            `,
        {
          $hash: tx.hash,
          $sighash: tx.sighash,
          $from: tx.from,
          $to: wrapNull(tx.to),
          $block_number: tx.blockNumber,
          $tx_index: tx.index,
          $timestamp: tx.timestamp,
        },
        function (err) {
          if (err) {
            rej(err);
          } else {
            res(this.lastID);
          }
        },
      );
    });
  }

  addErc20ApprovalEvent(event: TokenInsertEvent<DetailedErc20ApprovalEvent>) {
    return this.run(
      `
        INSERT OR IGNORE INTO erc_20_approval_events(transaction_hash, log_index, contract_id, owner_address, spender_address, value)
        VALUES ( 
            $transaction_hash, 
            $log_index,
            (SELECT contract_id FROM contracts WHERE address = $contract), 
            $owner, 
            $spender, 
            $value
        )
    `,
      {
        $transaction_hash: (event as EventWithTransactionHash).transactionHash,
        $log_index: event.logIndex,
        $contract: event.contract,
        $owner: event.owner,
        $spender: event.spender,
        $value: event.value.toString(),
      },
    );
  }

  addErc20TransferEvent(event: TokenInsertEvent<DetailedErc20TransferEvent>) {
    return this.run(
      `
        INSERT OR IGNORE INTO erc_20_transfer_events(transaction_hash, log_index, contract_id, from_address, to_address, value)
        VALUES ( 
            $transaction_hash, 
            $log_index,
            (SELECT contract_id FROM contracts WHERE address = $contract), 
            $from, 
            $to, 
            $value
        )
    `,
      {
        $transaction_hash: (event as EventWithTransactionHash).transactionHash,
        $log_index: event.logIndex,
        $contract: event.contract,
        $from: event.from,
        $to: event.to,
        $value: event.value.toString(),
      },
    );
  }

  addErc721ApprovalEvent(event: TokenInsertEvent<DetailedErc721ApprovalEvent>) {
    return this.run(
      `
        INSERT OR IGNORE INTO erc_721_approval_events(transaction_hash, log_index, contract_id, owner_address, approved_address, token_id)
        VALUES ( 
            $transaction_hash, 
            $log_index,
            (SELECT contract_id FROM contracts WHERE address = $contract), 
            $owner, 
            $approved, 
            $token_id
        )
    `,
      {
        $transaction_hash: event.transactionHash,
        $contract: event.contract,
        $owner: event.owner,
        $approved: event.approved,
        $token_id: event.tokenId.toString(),
        $log_index: event.logIndex,
      },
    );
  }

  addErc721TransferEvent(event: TokenInsertEvent<DetailedErc721TransferEvent>) {
    return this.run(
      `
        INSERT OR IGNORE INTO erc_721_transfer_events(transaction_hash, log_index, contract_id, from_address, to_address, token_id)
        VALUES ( 
            $transaction_hash,
            $log_index,
            (SELECT contract_id FROM contracts WHERE address = $contract), 
            $from, 
            $to, 
            $token_id
        )
    `,
      {
        $transaction_hash: (event as EventWithTransactionHash).transactionHash,
        $log_index: event.logIndex,
        $contract: event.contract,
        $from: event.from,
        $to: event.to,
        $token_id: event.tokenId.toString(),
      },
    );
  }

  addErc721ApprovalForAllEvent(event: TokenInsertEvent<DetailedErc721ApprovalForAllEvent>) {
    return this.run(
      `
        INSERT OR IGNORE INTO erc_721_approval_for_all_events(transaction_hash, log_index, contract_id, owner_address, operator_address, approved)
        VALUES ( 
            $transaction_hash,
            $log_index,
            (SELECT contract_id FROM contracts WHERE address = $contract), 
            $owner, 
            $operator, 
            $approved
        )
    `,
      {
        $transaction_hash: (event as EventWithTransactionHash).transactionHash,
        $log_index: event.logIndex,
        $contract: event.contract,
        $owner: event.owner,
        $operator: event.operator,
        $approved: event.approved,
      },
    );
  }

  addErc1155ApprovalForAllEvent(event: TokenInsertEvent<DetailedErc1155ApprovalForAllEvent>) {
    return this.run(
      `
        INSERT OR IGNORE INTO erc_1155_approval_for_all_events(transaction_hash, log_index, contract_id, owner_address, operator_address, approved)
        VALUES ( 
            $transaction_hash,
            $log_index,
            (SELECT contract_id FROM contracts WHERE address = $contract), 
            $owner, 
            $operator, 
            $approved
        )
    `,
      {
        $transaction_hash: (event as EventWithTransactionHash).transactionHash,
        $log_index: event.logIndex,
        $contract: event.contract,
        $owner: event.owner,
        $operator: event.operator,
        $approved: event.approved,
      },
    );
  }

  addErc1155TransferSingleEvent(event: TokenInsertEvent<DetailedErc1155TransferSingleEvent>) {
    return this.run(
      `
        INSERT OR IGNORE INTO erc_1155_transfer_single_events(transaction_hash, log_index, contract_id, operator_address, from_address, to_address, token_id, value)
        VALUES ( 
            $transaction_hash,
            $log_index,
            (SELECT contract_id FROM contracts WHERE address = $contract), 
            $operator, 
            $from, 
            $to, 
            $token_id,
            $value
        )
    `,
      {
        $transaction_hash: (event as EventWithTransactionHash).transactionHash,
        $log_index: event.logIndex,
        $contract: event.contract,
        $operator: event.operator,
        $from: event.from,
        $to: event.to,
        $token_id: event.tokenId.toString(),
        $value: event.value.toString(),
      },
    );
  }

  addErc1155TransferBatchEvent(event: TokenInsertEvent<DetailedErc1155TransferBatchEvent>) {
    return this.run(
      `
        INSERT OR IGNORE INTO erc_1155_transfer_batch_events(transaction_hash, log_index, contract_id, operator_id, from_id, to_id, token_ids, token_values)
        VALUES ( 
            $transaction_hash,
            $log_index,
            (SELECT contract_id FROM contracts WHERE address = $contract), 
            $operator, 
            $from, 
            $to, 
            $token_ids,
            $token_values
        )
    `,
      {
        $transaction_hash: (event as EventWithTransactionHash).transactionHash,
        $contract: event.contract,
        $operator: event.operator,
        $from: event.from,
        $to: event.to,
        $token_ids: event.ids.join(','),
        $token_values: event.values.join(','),
        $log_index: event.logIndex,
      },
    );
  }

  clearToken(address: string) {
    // remove contract and related events
    this.db.run(
      `DELETE FROM contracts WHERE contracts.address_id = (SELECT address_id FROM addresses a WHERE a.address = ?)`,
      address,
    );

    const eventTables = [
      'erc_20_transfer_events',
      'erc_20_approval_events',
      'erc_721_transfer_events',
      'erc_721_approval_events',
      'erc_721_approval_for_all_events',
      'erc_1155_transfer_single_events',
      'erc_1155_transfer_batch_events',
      'erc_1155_approval_for_all_events',
    ];

    // clear transactions
    this.db.run(
      `DELETE FROM transactions
        WHERE NOT EXISTS ${eventTables
          .map(
            (table) =>
              `(
                SELECT 1
                FROM ${table} e
                WHERE e.transaction_hash = transactions.transaction_hash
              )`,
          )
          .join(' AND NOT EXISTS ')}`,
    );

    const tablesWithAddresses = [
      { name: 'transactions', columns: ['from_id', 'to_id'] },
      { name: 'contracts', columns: ['address_id', 'deployer_id'] },
      { name: 'erc_20_transfer_events', columns: ['from_id', 'to_id'] },
      { name: 'erc_20_approval_events', columns: ['owner_id', 'spender_id'] },
      { name: 'erc_721_transfer_events', columns: ['from_id', 'to_id'] },
      { name: 'erc_721_approval_events', columns: ['owner_id', 'approved_id'] },
      { name: 'erc_721_approval_for_all_events', columns: ['owner_id', 'operator_id'] },
      { name: 'erc_1155_transfer_single_events', columns: ['operator_id', 'from_id', 'to_id'] },
      { name: 'erc_1155_transfer_batch_events', columns: ['operator_id', 'from_id', 'to_id'] },
    ];

    // clear addresses
    this.db.run(
      `DELETE FROM addresses
        WHERE NOT EXISTS ${tablesWithAddresses
          .map(
            (table) =>
              `(
                SELECT 1
                FROM ${table.name} e
                WHERE addresses.address_id IN (${table.columns.map((v) => `e.${v}`).join(',')})
              )`,
          )
          .join(' AND NOT EXISTS ')}`,
    );
  }

  close() {
    return new Promise((res, rej) =>
      this.db.close((err) => {
        if (err) return rej(err);
        res(true);
      }),
    );
  }

  async wait() {
    return new Promise((res) => {
      this.db.wait(res);
    });
  }

  public async run(query: string, ...params: any[]): Promise<void> {
    return new Promise((res, rej) => {
      this.db.run(query, ...params, (err: Error) => {
        if (err) return rej(err);
        return res();
      });
    });
  }

  public async exec(query: string, ...params: any[]): Promise<void> {
    return new Promise((res, rej) => {
      this.db.exec(query, ...params, (err: Error) => {
        if (err) return rej(err);
        return res();
      });
    });
  }

  private async get<P>(query: string, params: object = {}): Promise<P> {
    return new Promise((res, rej) => {
      this.db.get(query, params, (err: Error, result: P) => {
        if (err) return rej(err);
        return res(result);
      });
    });
  }

  private async all<P>(query: string, params: object = {}): Promise<P> {
    return new Promise((res, rej) => {
      this.db.all(query, params, (err: Error, result: P) => {
        if (err) return rej(err);
        return res(result);
      });
    });
  }
}

export default SqlDatabaseSimplified;
