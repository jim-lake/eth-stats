const crypto = require('crypto');
const EthUtil = require('ethereumjs-util');
const Common = require('ethereumjs-common').default;
const mainnetGenesisState = require('ethereumjs-common/dist/genesisStates/mainnet');

const GENESIS_ADDR = Buffer.from('GENESIS').toString('hex');
const BLOCK_REWARD_ADDR = Buffer.from('BLOCK_REWARD').toString('hex');
const CONTRACT_ADDR = Buffer.from('CONTRACT_CREATE').toString('hex');
const BLOCK_REWARD_ORDER = 2 ** 30;
const UNCLE_REWARD_ORDER = BLOCK_REWARD_ORDER + 1;

const common = new Common('mainnet');

exports.getBlockSql = getBlockSql;
exports.getInt = _getInt;

function getBlockSql(b) {
  let sql = 'BEGIN;';

  const block_number = _getInt(b.header.number);
  const base_reward = parseInt(
    common.paramByBlock('pow', 'minerReward', block_number)
  );
  const miner_uncle_extra = Math.floor(base_reward / 32);
  const uncle_count = b.uncleHeaders ? b.uncleHeaders.length : 0;

  b.transactions.forEach(tx => _calcGasUsed(tx, block_number));
  const tx_reward = b.transactions.reduce((memo, tx) => memo + tx.fee_wei, 0);

  const miner_reward =
    base_reward + miner_uncle_extra * uncle_count + tx_reward;

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

      sql += `
INSERT INTO address_ledger (address,transaction_hash,transaction_order,amount_wei)
  VALUES ('\\x${addr}','\\x${transaction_hash}',0,${value_wei});
`;
    });
  }

  if (b.transactions.length) {
    b.transactions.forEach((tx, i) => {
      const is_contract_create = tx.to.length === 0;

      const transaction_hash = tx.hash().toString('hex');
      const from_addr = tx.from.toString('hex');
      const from_nonce = _getInt(tx.nonce);
      const to_addr = is_contract_create
        ? CONTRACT_ADDR
        : tx.to.toString('hex');
      const input_data =
        tx.data.length > 0 ? `'\\x${tx.data.toString('hex')}'` : 'NULL';
      const value_wei = _getInt(tx.value);
      const gas_limit = tx.gasLimit.readUIntBE(0, tx.gasLimit.length);
      const { gas_price, gas_used, fee_wei } = tx;

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
  VALUES (
    '\\x${transaction_hash}', ${block_number}, ${i},
    '\\x${from_addr}', ${from_nonce},
    '\\x${to_addr}',
    ${value_wei}, ${fee_wei},
    ${input_data},
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
      if (is_contract_create) {
        const data_hash = crypto
          .createHash('sha256')
          .update(tx.data)
          .digest('hex');
        const contract_address = EthUtil.generateAddress(
          tx.from,
          tx.nonce
        ).toString('hex');

        sql += `
INSERT INTO contract (
  contract_address, transaction_hash,
  contract_data, contract_data_hash
  )
  VALUES (
    '\\x${contract_address}', '\\x${transaction_hash}',
    ${input_data}, '\\x${data_hash}'
  );
`;
      }
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

  sql += `
INSERT INTO address_ledger (address,transaction_hash,transaction_order,amount_wei)
  VALUES ('\\x${coinbase}','\\x${block_reward_hash}',0,${miner_reward});
`;

  if (uncle_count > 0) {
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
  tx.gas_price = tx.gasPrice.readUIntBE(0, tx.gasPrice.length);
  tx.fee_wei = used * tx.gas_price;
}

function _getTime(buf) {
  return buf.length > 0 ? buf.readUInt32BE(0) : 0;
}

function _getInt(buf) {
  let ret = 0;
  if (buf.length > 0) {
    ret = buf.readUIntBE(0, buf.length);
  }
  return ret;
}
