'use strict';
const crypto = require('crypto');
const timer = require('../tools/timer.js');

const BN = require('bn.js');
const EthUtil = require('ethereumjs-util');
const Common = require('ethereumjs-common').default;
const mainnetGenesisState = require('ethereumjs-common/dist/genesisStates/mainnet');

const GENESIS_ADDR = Buffer.from('GENESIS').toString('hex');
//const BLOCK_REWARD_ADDR = Buffer.from('BLOCK_REWARD').toString('hex');
const CONTRACT_ADDR = Buffer.from('CONTRACT_CREATE').toString('hex');
//const BLOCK_REWARD_ORDER = 2 ** 30;
//const UNCLE_REWARD_ORDER = BLOCK_REWARD_ORDER + 1;

const common = new Common('mainnet');

exports.getBlockSql = getBlockSql;
exports.getInt = _getInt;

function getBlockSql(b) {
  let sql = 'BEGIN;';
  sql += 'SET CONSTRAINTS ALL DEFERRED;';

  const block_number = _getInt(b.header.number);
  const base_reward = new BN(
    common.paramByBlock('pow', 'minerReward', block_number)
  );
  const uncle_count = b.uncleHeaders ? b.uncleHeaders.length : 0;

  const t = timer.start();
  const miner_reward = base_reward.clone();
  if (uncle_count > 0) {
    const miner_uncle_extra = new BN(uncle_count);
    miner_uncle_extra.imul(base_reward);
    miner_uncle_extra.idivn(32);

    miner_reward.iadd(miner_uncle_extra);
  }
  b.transactions.forEach(tx => _calcGasUsed(tx, block_number));
  b.transactions.forEach(tx => miner_reward.iadd(tx.fee_wei));
  timer.end(t, 'tx-miner-reward');

  const block_time = _getTime(b.header.timestamp);
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

  if (block_number === 0) {
    const state_keys = Object.keys(mainnetGenesisState);
    sql += `
INSERT INTO transaction (
  transaction_hash, block_number, block_order,
  from_address, from_nonce,
  to_address,
  value_wei, fee_wei,
  gas_limit, gas_used, gas_price,
  tx_success, is_genesis_tx
)
VALUES
`;
    state_keys.forEach((key, i) => {
      const transaction_hash = Buffer.from(`GENESIS_${i}`).toString('hex');
      const addr = key.slice(2);
      const value_wei = BigInt(mainnetGenesisState[key]);

      if (i > 0) {
        sql += ',';
      }
      sql += `
(
  '\\x${transaction_hash}', ${block_number}, ${i},
  '\\x${GENESIS_ADDR}', ${i},
  '\\x${addr}',
  ${value_wei}, 0,
  0, 0, 0,
  TRUE, TRUE
)
`;
    });
    sql += ';';
  }

  const contract_list = [];
  if (b.transactions.length) {
    sql += `
INSERT INTO transaction (
  transaction_hash, block_number, block_order,
  from_address, from_nonce,
  to_address,
  value_wei, fee_wei,
  input_data,
  gas_limit, gas_used, gas_price,
  tx_success
)
VALUES
`;
    b.transactions.forEach((tx, i) => {
      const is_contract_create = tx.to.length === 0;

      const transaction_hash = tx.hash().toString('hex');

      const t = timer.start();
      const from_addr = tx.from.toString('hex');
      timer.end(t, 'tx-from');

      const from_nonce = _getInt(tx.nonce);
      const to_addr = is_contract_create
        ? CONTRACT_ADDR
        : tx.to.toString('hex');
      const input_data =
        tx.data.length > 0 ? `'\\x${tx.data.toString('hex')}'` : 'NULL';
      const value_wei = new BN(tx.value);
      const gas_limit = _getInt(tx.gasLimit);
      const { gas_price, gas_used, fee_wei } = tx;

      if (i > 0) {
        sql += ',';
      }

      sql += `
(
  '\\x${transaction_hash}', ${block_number}, ${i},
  '\\x${from_addr}', ${from_nonce},
  '\\x${to_addr}',
  ${value_wei}, ${fee_wei},
  ${input_data},
  ${gas_limit}, ${gas_used}, ${gas_price},
  TRUE
)
`;
      if (is_contract_create) {
        const data_hash = crypto
          .createHash('sha256')
          .update(tx.data)
          .digest('hex');
        const contract_address = EthUtil.generateAddress(
          tx.from,
          tx.nonce
        ).toString('hex');
        contract_list.push({
          contract_address,
          transaction_hash,
          input_data,
          data_hash,
        });
      }
    });
    sql += ';';
  }

  if (contract_list.length > 0) {
    sql += `
INSERT INTO contract (
  contract_address, transaction_hash,
  contract_data, contract_data_hash
  )
  VALUES
`;

    contract_list.forEach((c, i) => {
      if (i > 0) {
        sql += ',';
      }
      sql += `(
  '\\x${c.contract_address}', '\\x${c.transaction_hash}',
  ${c.input_data}, '\\x${c.data_hash}'
)
`;
    });
    sql += ';';
  }

  if (uncle_count > 0) {
    sql += `
INSERT INTO uncle (
  uncle_hash,
  block_number, block_time,
  miner_address, block_reward_wei, parent_hash,
  block_nonce, block_extra_data
)
VALUES
`;
    b.uncleHeaders.forEach((header, i) => {
      const uncle_number = header.number.readUIntBE(0, header.number.length);
      const delta = block_number - uncle_number;
      const uncle_reward = Math.floor((base_reward * (8 - delta)) / 8);

      const uncle_hash = header.hash().toString('hex');
      const uncle_time = _getTime(header.timestamp);
      const uncle_addr = header.coinbase.toString('hex');
      const uncle_parent = header.parentHash.toString('hex');
      const uncle_nonce = header.nonce.toString('hex');
      const uncle_extra = header.extraData.toString('hex');

      if (i > 0) {
        sql += ',';
      }

      sql += `
(
  '\\x${uncle_hash}',
  ${block_number}, TO_TIMESTAMP(${uncle_time}),
  '\\x${uncle_addr}', ${uncle_reward}, '\\x${uncle_parent}',
  '\\x${uncle_nonce}', '\\x${uncle_extra}'
)
`;
    });
    sql += ';';
  }
  sql += 'COMMIT;';

  sql = sql.replace(/\s+/g, ' ');
  // eslint-disable-next-line no-useless-escape
  sql = sql.replace(/\s*([,;\(\)])\s+/g, '$1');
  sql += '\n';
  return sql;
}

function _calcGasUsed(tx, block_number) {
  let used = common.paramByBlock('gasPrices', 'tx', block_number);
  const data_len = tx.data.length;
  if (data_len > 0) {
    const zero_cost = common.paramByBlock(
      'gasPrices',
      'txDataZero',
      block_number
    );
    const one_cost = common.paramByBlock(
      'gasPrices',
      'txDataNonZero',
      block_number
    );
    for (let i = 0; i < data_len; i++) {
      used += tx.data[i] === 0 ? zero_cost : one_cost;
    }
  }
  tx.gas_used = used;
  tx.gas_price = _getInt(tx.gasPrice);
  tx.fee_wei = new BN(tx.gas_price).imuln(used);
}

function _getTime(buf) {
  return buf.length > 0 ? buf.readUInt32BE(0) : 0;
}

function _getInt(buf) {
  let ret = 0;
  if (buf.length > 6) {
    ret = new BN(buf);
  } else if (buf.length > 0) {
    ret = buf.readUIntBE(0, buf.length);
  }
  return ret;
}
