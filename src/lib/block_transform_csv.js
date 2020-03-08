'use strict';
const crypto = require('crypto');
const timer = require('../tools/timer.js');

const EthUtil = require('ethereumjs-util');
const Common = require('ethereumjs-common').default;
const mainnetGenesisState = require('ethereumjs-common/dist/genesisStates/mainnet');
const { appendRow, escapeBinary, formatDate } = require('../tools/csv_db');

const common = new Common('mainnet');

exports.getBlockCsv = getBlockCsv;
exports.getInt = _getInt;

function getBlockCsv(buffer_map, b) {
  let contract_count = 0;

  const block_number = _getInt(b.header.number);
  const base_reward = BigInt(
    common.paramByBlock('pow', 'minerReward', block_number)
  );
  const uncle_count = b.uncleHeaders ? b.uncleHeaders.length : 0;

  const t = timer.start();
  let miner_reward = base_reward + (BigInt(uncle_count) * base_reward) / 32n;
  b.transactions.forEach(tx => _calcGasUsed(tx, block_number));
  b.transactions.forEach(tx => (miner_reward += tx.fee_wei));
  timer.end(t, 'tx-miner-reward');

  const block_time = _getTime(b.header.timestamp);
  const block_hash = b.hash();
  const parent_hash = b.header.parentHash;
  const coinbase = b.header.coinbase;
  const nonce = b.header.nonce;
  const extra_data = b.header.extraData;

  const block_data_list = [
    block_number,
    escapeBinary(block_hash),
    block_time,
    escapeBinary(coinbase),
    miner_reward,
    escapeBinary(parent_hash),
    escapeBinary(nonce),
    escapeBinary(extra_data),
  ];
  appendRow(buffer_map, 'block', block_data_list);

  if (block_number === 0) {
    const state_keys = Object.keys(mainnetGenesisState);
    state_keys.forEach((key, i) => {
      const transaction_hash = Buffer.from(`GENESIS_${i}`);
      const addr = key.slice(2);
      const value_wei = BigInt(mainnetGenesisState[key]);

      const tx_list = [
        escapeBinary(transaction_hash),
        block_number,
        i,
        'GENESIS', // from
        i, // from_nonce
        escapeBinary(addr), // to
        value_wei, // value
        0, // fee
        null, // input_data
        0, // gas_limit
        0, // gas_used
        0, // gas_price
        1, // tx_success
        1, // is_genesis
        0, // is_block
        0, // is_uncle
      ];
      appendRow(buffer_map, 'transaction', tx_list);
    });
  }

  if (b.transactions.length) {
    b.transactions.forEach((tx, i) => {
      const is_contract_create = tx.to.length === 0;

      const transaction_hash = tx.hash();

      const t = timer.start();
      const from_addr = tx.from;
      timer.end(t, 'tx-from');

      const from_nonce = _getInt(tx.nonce);
      const to_addr = is_contract_create ? 'CONTRACT_CREATE' : tx.to;
      const input_data_escaped =
        tx.data.length > 0 ? escapeBinary(tx.data) : null;
      const value_wei = _getInt(tx.value);
      const gas_limit = _getInt(tx.gasLimit);
      const { gas_price, gas_used, fee_wei } = tx;

      const tx_list = [
        escapeBinary(transaction_hash),
        block_number,
        i,
        escapeBinary(from_addr),
        from_nonce,
        escapeBinary(to_addr),
        value_wei,
        fee_wei,
        input_data_escaped,
        gas_limit,
        gas_used,
        gas_price,
        1, // tx_success
        0, // is_genesis
        0, // is_block
        0, // is_uncle
      ];
      appendRow(buffer_map, 'transaction', tx_list);

      if (is_contract_create) {
        const data_hash = crypto
          .createHash('sha256')
          .update(tx.data)
          .digest('hex');
        const contract_address = EthUtil.generateAddress(tx.from, tx.nonce);

        const c_list = [
          escapeBinary(contract_address),
          block_number,
          i,
          input_data_escaped,
          escapeBinary(data_hash),
        ];
        appendRow(buffer_map, 'contract', c_list);

        contract_count++;
      }
    });
  }

  if (uncle_count > 0) {
    b.uncleHeaders.forEach((header, i) => {
      const uncle_number = header.number.readUIntBE(0, header.number.length);
      const delta = BigInt(block_number - uncle_number);
      const uncle_reward = (base_reward * (8n - delta)) / 8n;

      const uncle_hash = header.hash();
      const uncle_time = _getTime(header.timestamp);
      const uncle_addr = header.coinbase;
      const uncle_parent = header.parentHash;
      const uncle_nonce = header.nonce;
      const uncle_extra = header.extraData;

      const uncle_list = [
        escapeBinary(uncle_hash),
        block_number,
        i,
        uncle_time,
        escapeBinary(uncle_addr),
        uncle_reward,
        escapeBinary(uncle_parent),
        escapeBinary(uncle_nonce),
        escapeBinary(uncle_extra),
      ];
      appendRow(buffer_map, 'uncle', uncle_list);
    });
  }
  return {
    uncle_count,
    transaction_count: b.transactions.length,
    contract_count,
  };
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
  tx.fee_wei = BigInt(tx.gas_price) * BigInt(used);
}

function _getTime(buf) {
  const d = new Date(buf.length > 0 ? buf.readUInt32BE(0) * 1000 : 0);
  return formatDate(d);
}

function _getInt(buf) {
  let ret = 0;
  if (buf.length > 6) {
    ret = BigInt('0x' + buf.toString('hex'));
  } else if (buf.length > 0) {
    ret = buf.readUIntBE(0, buf.length);
  }
  return ret;
}
