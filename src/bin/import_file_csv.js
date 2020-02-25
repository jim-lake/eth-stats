'use strict';

const async = require('async');
const real_db = require('../tools/pg_db');
const fake_db = require('../tools/fake_db');
const Common = require('ethereumjs-common').default;
const rlp = require('rlp');
const Block = require('ethereumjs-block');
const fs = require('fs');
const config = require('../../config.json');
const BlockTransformCSV = require('../lib/block_transform_csv');
const csvDB = require('../tools/csv_db');
const util = require('../tools/util');
const timer = require('../tools/timer');
const argv = require('yargs').argv;

const BUFFER_MIN = 10000000;
const READ_LEN = BUFFER_MIN * 2;
const PERIODIC_PRINT = 60 * 1000;
const BUCKET = 'rds-load-data';
const REGION = 'us-west-2';
const PREFIX = `eth_${new Date().toISOString().replace(/[:-T]|\.\d\d\d/g,'')}`;
console.log("s3 prefix:",PREFIX);

const only_block = argv['only-block'];
const skip_until = argv['skip-until'] || 0;
const run_silent = argv['silent'] || false;
const run_quiet = argv['quiet'] || run_silent;
const csv_block_count = argv['csv-block-count'] || 1000;
const input_file = argv._[0];
const fake_db_file = argv['fake-db'];

const common = new Common('mainnet');

console.log('input file:', input_file);
if (only_block !== undefined) {
  console.log('only block number:', only_block);
}
if (skip_until) {
  console.log('skip blocks until block number:', skip_until);
}
if (run_silent) {
  console.log('running silent');
} else if (run_quiet) {
  console.log('running quiet');
}
console.log('csv block count:', csv_block_count);

let db;
if (fake_db_file) {
  console.log('fake db file:', fake_db_file);
  db = fake_db;
  fake_db.init({ file: fake_db_file });
} else {
  db = real_db;
  const db_opts = Object.assign(
    {
      idleTimeoutMillis: 120000,
      connectionTimeoutMillis: 30000,
    },
    config.db
  );
  db.init(db_opts);
}
console.log('');

let buffer_map = {};
let buffer_count = 0;

const write_list = [];
let write_running = false;
let write_inflight_count = 0;

const import_list = [];
let import_running = false;

let min_block = 2 ** 32;
let max_block = 0;
let block_count = 0;
let tx_count = 0;
let contract_count = 0;
let skip_count = 0;
let flush_count = 0;
let error_count = 0;
let import_count = 0;
let csv_bytes = 0;
let uncle_count = 0;

const read_buffer = Buffer.allocUnsafe(READ_LEN);
const fd = fs.openSync(input_file, 'r');
if (!fd) {
  console.error('failed to open file:', input_file);
  process.exit(-1);
}
const t = timer.start();
const bytes_read = fs.readSync(fd, read_buffer, 0, READ_LEN, null);
timer.end(t, 'fs-read');

let remainder;
if (bytes_read === 0) {
  console.error('no bytes read form file.');
  process.exit(-2);
} else {
  // omg i fucking hate node
  remainder = Buffer.concat([read_buffer], bytes_read);
}

function _updateRemainder() {
  let ret;
  if (remainder.length > 0) {
    try {
      const t = timer.start();
      const rlp_ret = rlp.decode(remainder, true);
      timer.end(t, 'rlp-decode');
      if (rlp_ret.data.length > 0) {
        remainder = rlp_ret.remainder;
        ret = rlp_ret.data;
      }
    } catch (e) {
      console.error('rlp.decode threw:', e);
    }
  }

  return ret;
}
let really_done = false;
let file_done = false;
const generateRlpBlock = {
  // LOL
  [Symbol.toStringTag]: 'AsyncGenerator',
  next: () =>
    new Promise((resolve, reject) => {
      if (really_done) {
        resolve({ done: true });
      } else if (remainder.length === 0 && file_done) {
        resolve({ done: true });
      } else if (remainder.length > BUFFER_MIN || file_done) {
        const data = _updateRemainder();
        if (data) {
          resolve({ value: data });
        } else {
          resolve({ done: true });
        }
      } else {
        const t = timer.start();
        fs.read(fd, read_buffer, 0, READ_LEN, null, (err, bytes_read) => {
          timer.end(t, 'fs-read');
          if (err) {
            console.error('file read error:', err);
            reject(err);
          } else {
            if (bytes_read === 0) {
              file_done = true;
            } else {
              remainder = Buffer.concat(
                [remainder, read_buffer],
                remainder.length + bytes_read
              );
            }

            const data = _updateRemainder();
            if (data) {
              resolve({ value: data });
            } else {
              resolve({ done: true });
            }
          }
        });
      }
    }),
};

const start_time = Date.now();
console.log('start_time:', new Date(start_time));

async.eachSeries(
  generateRlpBlock,
  (data, done) => {
    const block_number = BlockTransformCSV.getInt(data[0][8]);
    const hardfork = common.activeHardfork(block_number);
    const block_common = new Common('mainnet', hardfork);
    const b = new Block(data, { common: block_common });

    if (only_block !== undefined && block_number > only_block) {
      really_done = true;
      done();
    } else if (only_block !== undefined && only_block !== block_number) {
      skip_count++;
      setImmediate(done);
    } else if (block_number < skip_until) {
      skip_count++;
      setImmediate(done);
    } else {
      min_block = Math.min(min_block, block_number);
      max_block = Math.max(max_block, block_number);
      block_count++;

      _importBlock(block_number, b);
      setImmediate(done);
    }
  },
  err => {
    console.log('');
    console.log('read file done');
    if (err) {
      console.log('run err:', err);
    }
    _flushBuffer();
  }
);

function _importBlock(block_number, b) {
  try {
    const t = timer.start();
    const stats = BlockTransformCSV.getBlockCsv(buffer_map, b);
    timer.end(t, 'get-sql');

    tx_count += stats.transaction_count;
    contract_count += stats.contract_count;
    uncle_count += stats.uncle_count;

    buffer_count++;
    if (buffer_count > csv_block_count) {
      _flushBuffer();
    }

    _periodicStats();
  } catch (e) {
    console.log('');
    console.error(`block(${block_number}) threw:`, e);
    error_count++;
  }
}

function _flushBuffer() {
  try {
    if (buffer_count > 0) {
      flush_count++;

      const old_buffer_map = buffer_map;
      buffer_map = {};
      buffer_count = 0;

      write_list.push(old_buffer_map);
    }
    setImmediate(_writeFiles);
  } catch (e) {
    console.error('_flushBuffer: threw', e);
  }
}
function _writeFiles() {
  try {
    if (!write_running && write_list.length > 0) {
      write_running = true;
      const buffer_map = write_list.shift();
      write_inflight_count++;

      for (let key in buffer_map) {
        const s = buffer_map[key];
        csv_bytes += s.length;
      }

      const opts = {
        bufferMap: buffer_map,
        bucket: BUCKET,
        prefix: PREFIX,
      };
      const t = timer.start();
      csvDB.s3WriteBufferMap(opts, (err, file_map) => {
        timer.end(t, 's3-write');

        if (err) {
          console.error('_flushBuffer: error:', err);
          write_inflight_count--;
        } else {
          setTimeout(() => {
            // we wait to add to to the files for a second, otherwise sql misses them.
            _addImport('block', file_map);
            _addImport('uncle', file_map);
            _addImport('transaction', file_map);
            _addImport('contract', file_map);

            write_inflight_count--;
            _importFiles();
          }, 5 * 1000);
        }

        write_running = false;
        setImmediate(_writeFiles);
      });
    } else {
      setImmediate(_importFiles);
    }
  } catch (e) {
    console.error('_writeFiles: threw', e);
  }
}

function _addImport(table, file_map) {
  if (table in file_map) {
    import_list.push({
      table,
      key: file_map[table],
    });
  }
}
function _importFiles() {
  if (!import_running && import_list.length > 0) {
    import_running = true;

    const { table, key } = import_list.shift();

    const opts = { table, bucket: BUCKET, key, region: REGION };
    const t = timer.start();
    csvDB.importFile(opts, err => {
      timer.end(t, 'db-insert');
      if (err) {
        console.error('_importFiles table:', table, 'key:', key, 'failed!');
        error_count++;
      } else {
        import_count++;
        _maybeLog('_importFiles table:', table, 'success!');
        _maybeLogDot('+');
      }

      import_running = false;
      setImmediate(_importFiles);

      _periodicStats();
    });
  } else {
    _checkDone();
  }
}

function _checkDone() {
  if (
    !import_running &&
    !write_running &&
    import_list.length === 0 &&
    file_done &&
    buffer_count === 0 &&
    write_inflight_count === 0
  ) {
    console.log('');
    console.log('everything is done');
    db.end(err => {
      if (err) {
        console.error('db end err:', err);
      }
      console.log('');
      _periodicStats(true);
      console.log('');
      console.log('done done');
    });
  }
}

let last_stats = Date.now();
function _periodicStats(force) {
  const now = Date.now();
  const delta = now - last_stats;
  if (force || delta > PERIODIC_PRINT) {
    last_stats = now;
    const now_time = Date.now();
    const delta_ms = now_time - start_time;

    console.log('');
    console.log('--------');
    if (force) {
      console.log('argv:', process.argv.slice(2).join(' '));
      console.log('');
    }
    console.log('now_time:', new Date(now_time));
    console.log('delta_ms:', util.timeFormat(delta_ms));
    console.log('fs-read:', timer.getString('fs-read'));
    console.log('rlp-decode:', timer.getString('rlp-decode'));
    console.log('get-sql:', timer.getString('get-sql'));
    console.log('tx-miner-reward:', timer.getString('tx-miner-reward'));
    console.log('tx-from:', timer.getString('tx-from'));
    console.log('s3-write:', timer.getString('s3-write'));
    console.log('db-insert:', timer.getString('db-insert'));
    console.log('');
    console.log('min_block:', min_block);
    console.log('max_block:', max_block);
    console.log('');
    console.log('block_count:', block_count);
    console.log('tx_count:', tx_count);
    console.log('contract_count:', contract_count);
    console.log('uncle_count:', uncle_count);
    console.log('skip_count:', skip_count);
    console.log('flush_count:', flush_count);
    console.log('import_count:', import_count);
    console.log('error_count:', error_count);
    console.log('write_inflight_count:', write_inflight_count);
    console.log('write_list.length:', write_list.length);
    console.log('import_list.length:', import_list.length);
    console.log('csv_bytes:', csv_bytes);

    console.log('');
    console.log('blocks/second:', (block_count / delta_ms) * 1000);
    console.log('csv_bytes/second:', (csv_bytes / delta_ms) * 1000);
    console.log('--------');
    console.log('');
  }
}

function _maybeLog(...args) {
  if (!run_quiet) {
    console.log(...args);
  }
}
function _maybeLogDot(dot) {
  if (run_quiet && !run_silent) {
    process.stdout.write(dot);
  }
}
