'use strict';

const async = require('async');
const db = require('../tools/pg_db.js');
const rlp = require('rlp');
const Common = require('ethereumjs-common').default;
const mainnetGenesisState = require('ethereumjs-common/dist/genesisStates/mainnet');
const Block = require('ethereumjs-block');
const fs = require('fs');
const config = require('../../config.json');
const argv = process.argv.slice(2);

const GENESIS_ADDR = Buffer.from('GENESIS').toString('hex');
const BLOCK_REWARD_ADDR = Buffer.from('BLOCK_REWARD').toString('hex');
const BLOCK_REWARD_ORDER = 2 ** 30;
const UNCLE_REWARD_ORDER = BLOCK_REWARD_ORDER + 1;

db.init(config.db);

const common = new Common('mainnet');
const data = fs.readFileSync(argv[0]);

let remainder = data;

async.whilst(
  done => done(null, remainder.length > 0),
  done => {
    const rlp_ret = rlp.decode(remainder, true);
    remainder = rlp_ret.remainder;
    const decoded = rlp_ret.data;

    const b = new Block(decoded);
    let block_number = 0;
    if (b.header.number.length > 0) {
      block_number = b.header.number.readUIntBE(0, b.header.number.length);
    }
    const sql = _getBlockSql(b);

    db.queryFromPool(sql, [], err => {
      if (err && err.code === '23505') {
        console.log('skip?:', block_number);
        console.log('err:', err);
        console.log('sql:', sql);
        console.log('');
        console.log('');
        console.log('');
        err = null;
      } else if (err) {
        console.log('insert err:', err);
        console.log('sql:', sql);
      } else {
        console.log('inserted block:', block_number);
      }
      done(err);
    });
  },
  err => {
    console.log('');
    if (err) {
      console.log('whilst err:', err);
    }
    db.end(err => {
      if (err) {
        console.log('pool end err:', err);
      }

      console.log('done done');
    });
  }
);

function _getBlockSql(b) {
  let sql = 'BEGIN;';

  let block_number = 0;
  if (b.header.number.length > 0) {
    block_number = b.header.number.readUIntBE(0, b.header.number.length);
  }
  const base_reward = parseInt(
    common.paramByBlock('pow', 'minerReward', block_number)
  );
  const miner_uncle_extra = Math.floor(base_reward / 32);
  const uncle_count = b.uncleHeaders ? b.uncleHeaders.length : 0;

  b.transactions.forEach(tx => _calcGasUsed(tx, block_number));
  const tx_reward = b.transactions.reduce((memo, tx) => memo + tx.fee_wei, 0);

  const miner_reward =
    base_reward + miner_uncle_extra * uncle_count + tx_reward;

  const block_time =
    b.header.timestamp.length > 0 ? b.header.timestamp.readUInt32BE(0) : 0;
  const block_hash = b.hash().toString('hex');
  const parent_hash = b.header.parentHash.toString('hex');
  const coinbase = b.header.coinbase.toString('hex');
  const nonce = b.header.nonce.toString('hex');
  const extra_data = b.header.extraData.toString('hex');

  sql += `
INSERT INTO block (
    block_number, block_hash, block_time,
    miner_address, block_reward_wei, parent_hash,
    block_nonce, block_extra_data
  )
  VALUES (
    ${block_number}, '\\x${block_hash}', TO_TIMESTAMP(${block_time}),
    '\\x${coinbase}', ${miner_reward}, '\\x${parent_hash}',
    '\\x${nonce}', '\\x${extra_data}'
  );
`;

  let block_order = 0;

  if (block_number === 0) {
    const state_keys = Object.keys(mainnetGenesisState);
    state_keys.forEach((key, i) => {
      const transaction_hash = Buffer.from(`GENESIS_${i}`).toString('hex');
      const addr = key.slice(2);
      const value_wei = parseInt(mainnetGenesisState[key].slice(2), 16);

      sql += `
INSERT INTO transaction (
    transaction_hash, block_number, block_order,
    from_address, from_nonce,
    to_address,
    value_wei, fee_wei,
    gas_limit, gas_used, gas_price,
    tx_success, is_genesis_tx
  )
  VALUES (
    '\\x${transaction_hash}', ${block_number}, ${i},
    '\\x${GENESIS_ADDR}', ${i},
    '\\x${addr}',
    ${value_wei}, 0,
    0, 0, 0,
    TRUE, TRUE
  );
`;
      block_order++;

      sql += `
INSERT INTO address_ledger (address,transaction_hash,transaction_order,amount_wei)
  VALUES ('\\x${addr}','\\x${transaction_hash}',0,${value_wei});
`;
    });
  }

  if (b.transactions.length) {
    b.transactions.forEach((tx, i) => {
      const transaction_hash = tx.hash().toString('hex');
      const from_addr = tx.from.toString('hex');
      const from_nonce = tx.nonce.readUIntBE(0, tx.nonce.length);
      const to_addr = tx.to.toString('hex');
      const value_wei = tx.value.readUIntBE(0, tx.value.length);
      const gas_limit = tx.gasLimit.readUIntBE(0, tx.gasLimit.length);
      const { gas_price, gas_used, fee_wei } = tx;

      sql += `
INSERT INTO transaction (
    transaction_hash, block_number, block_order,
    from_address, from_nonce,
    to_address,
    value_wei, fee_wei,
    gas_limit, gas_used, gas_price,
    tx_success
  )
  VALUES (
    '\\x${transaction_hash}', ${block_number}, ${i},
    '\\x${from_addr}', ${from_nonce},
    '\\x${to_addr}',
    ${value_wei}, ${fee_wei},
    ${gas_limit}, ${gas_used}, ${gas_price},
    TRUE
  );
`;

      if (value_wei > 0) {
        sql += `
INSERT INTO address_ledger (address,transaction_hash,transaction_order,amount_wei)
  VALUES ('\\x${from_addr}','\\x${transaction_hash}',0,${-value_wei - fee_wei});
`;
        sql += `
INSERT INTO address_ledger (address,transaction_hash,transaction_order,amount_wei)
  VALUES ('\\x${to_addr}','\\x${transaction_hash}',1,${value_wei});
`;
      }

      console.log('--------');
      console.log('');
    });
  }

  const block_reward_hash = Buffer.from(
    `BLOCK_REWARD_${block_number}`
  ).toString('hex');

  sql += `
INSERT INTO transaction (
    transaction_hash, block_number, block_order,
    from_address, from_nonce,
    to_address,
    value_wei, fee_wei,
    gas_limit, gas_used, gas_price,
    tx_success, is_block_reward
  )
  VALUES (
    '\\x${block_reward_hash}', ${block_number}, ${BLOCK_REWARD_ORDER},
    '\\x${BLOCK_REWARD_ADDR}', ${block_number},
    '\\x${coinbase}',
    ${miner_reward}, 0,
    0, 0, 0,
    TRUE, TRUE
  );
`;
  block_order++;

  sql += `
INSERT INTO address_ledger (address,transaction_hash,transaction_order,amount_wei)
  VALUES ('\\x${coinbase}','\\x${block_reward_hash}',0,${miner_reward});
`;

  if (uncle_count > 0) {
    b.uncleHeaders.forEach((header, i) => {
      const uncle_number = header.number.readUIntBE(0, header.number.length);
      const delta = block_number - uncle_number;
      const uncle_reward = Math.floor((base_reward * (8 - delta)) / 8);

      const uncle_hash = header.uncleHash.toString('hex');
      const uncle_time =
        header.timestamp.length > 0 ? header.timestamp.readUInt32BE(0) : 0;
      const uncle_addr = header.coinbase.toString('hex');
      const uncle_parent = header.parentHash.toString('hex');
      const uncle_nonce = header.nonce.toString('hex');
      const uncle_extra = header.extraData.toString('hex');

      sql += `
INSERT INTO uncle (
    uncle_hash,
    block_number, block_time,
    miner_address, block_reward_wei, parent_hash,
    block_nonce, block_extra_data
  )
  VALUES (
    '\\x${uncle_hash}',
    ${block_number}, TO_TIMESTAMP(${uncle_time}),
    '\\x${uncle_addr}', ${uncle_reward}, '\\x${uncle_parent}',
    '\\x${uncle_nonce}', '\\x${uncle_extra}'
  );
`;

      const uncle_reward_hash = Buffer.from(
        `UNCLE_REWARD_${block_number}_${i}`
      ).toString('hex');
      const uncle_reward_addr = Buffer.from(`UNCLE_REWARD_${i}`).toString(
        'hex'
      );

      sql += `
INSERT INTO transaction (
    transaction_hash, block_number, block_order,
    from_address, from_nonce,
    to_address,
    value_wei, fee_wei,
    gas_limit, gas_used, gas_price,
    tx_success, is_uncle_reward
  )
  VALUES (
    '\\x${uncle_reward_hash}', ${block_number}, ${UNCLE_REWARD_ORDER + i},
    '\\x${uncle_reward_addr}', ${block_number},
    '\\x${uncle_addr}',
    ${uncle_reward}, 0,
    0, 0, 0,
    TRUE, TRUE
  );
`;
      block_order++;

      sql += `
INSERT INTO address_ledger (address,transaction_hash,transaction_order,amount_wei)
  VALUES ('\\x${uncle_addr}','\\x${uncle_reward_hash}',0,${uncle_reward});
`;
    });
  }
  sql += 'COMMIT;';

  return sql;
}

function _calcGasUsed(tx, block_number) {
  let used = common.paramByBlock('gasPrices', 'tx', block_number);
  const data_len = tx.data.length;
  if (data_len > 0) {
    used +=
      data_len *
      common.paramByBlock('gasPrices', 'txDataNonZero', block_number);
  }
  tx.gas_used = used;
  tx.gas_price = tx.gasPrice.readUIntBE(0, tx.gasPrice.length);
  tx.fee_wei = used * tx.gas_price;
}
