'use strict';

const async = require('async');
const real_db = require('../tools/pg_db');
const fake_db = require('../tools/fake_db');
const Common = require('ethereumjs-common').default;
const rlp = require('rlp');
const Block = require('ethereumjs-block');
const fs = require('fs');
const config = require('../../config.json');
const BlockTransformSQL = require('../lib/block_transform_sql');
const util = require('../tools/util');
const timer = require('../tools/timer');
const argv = require('yargs').argv;

const PARALLEL_LIMIT = 10;
const BUFFER_MIN = 10000000;
const READ_LEN = BUFFER_MIN * 2;
const PERIODIC_PRINT = 60 * 1000;

const delete_blocks = argv['delete-blocks'] || false;
const only_block = argv['only-block'];
const skip_until = argv['skip-until'] || 0;
const run_silent = argv['silent'] || false;
const run_quiet = argv['quiet'] || run_silent;
const input_file = argv._[0];
const fake_db_file = argv['fake-db'];

const common = new Common('mainnet');

console.log('input file:', input_file);
console.log('delete blocks before insert:', delete_blocks);
if (only_block !== undefined) {
  console.log('only block number:', only_block);
}
if (skip_until) {
  console.log('skip blocks until block number:', skip_until);
}

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

let min_block = 2 ** 32;
let max_block = 0;
const start_time = Date.now();
console.log('start_time:', new Date(start_time));
let block_count = 0;
let delete_count = 0;
let skip_count = 0;
let insert_count = 0;
let error_count = 0;

async.eachLimit(
  generateRlpBlock,
  PARALLEL_LIMIT,
  (data, done) => {
    const block_number = BlockTransformSQL.getInt(data[0][8]);
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

      _importBlock(block_number, b, done);
    }
  },
  err => {
    console.log('');
    if (err) {
      console.log('run err:', err);
    }

    db.end(err => {
      if (err) {
        console.log('pool end err:', err);
      }

      _periodicStats(true);
      console.log('done done');
    });
  }
);

function _importBlock(block_number, b, done) {
  let sql;

  try {
    const t = timer.start();
    sql = BlockTransformSQL.getBlockSql(b);
    timer.end(t, 'get-sql');
    async.series(
      [
        done => {
          if (delete_blocks) {
            const sql = 'DELETE FROM block WHERE block_number = $1';
            db.queryFromPool(sql, [block_number], (err, _, result) => {
              if (err) {
                console.error('delete block failed:', err);
              } else if (result && result.rowCount > 0) {
                delete_count++;
              }
              done(err);
            });
          } else {
            done();
          }
        },
        done => {
          const t = timer.start();
          db.queryFromPool(sql, [], err => {
            timer.end(t, 'db-insert');
            if (err && err.code === '23505') {
              skip_count++;
              _maybeLog('skip?:', block_number);
              _maybeLog('err:', err.detail ? err.detail : err);
              _maybeLogDot('S');
              //console.log('sql:', sql);
              err = null;
            } else if (err) {
              error_count++;
              console.error('insert err:', err.detail ? err.detail : err);
              console.error('failed block:', block_number);
              _maybeLogDot('E');
              //console.log('sql:', sql);
            } else {
              insert_count++;
              _maybeLog('inserted block:', block_number);
              if (delete_blocks) {
                _maybeLogDot('R');
              } else {
                _maybeLogDot('+');
              }
            }
            _periodicStats();
            done(err);
          });
        },
      ],
      done
    );
  } catch (e) {
    console.log('');
    console.error(`block(${block_number}) threw:`, e);
    error_count++;
    done(e);
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
    console.log('now_time:', new Date(now_time));
    console.log('delta_ms:', util.timeFormat(delta_ms));
    console.log('fs-read:', timer.getString('fs-read'));
    console.log('rlp-decode:', timer.getString('rlp-decode'));
    console.log('get-sql:', timer.getString('get-sql'));
    console.log('tx-miner-reward:', timer.getString('tx-miner-reward'));
    console.log('tx-from:', timer.getString('tx-from'));
    console.log('raw db-insert:', timer.getString('db-insert'));
    console.log(
      `db-insert/${PARALLEL_LIMIT}:`,
      timer.getString('db-insert', PARALLEL_LIMIT)
    );
    console.log('');
    console.log('min_block:', min_block);
    console.log('max_block:', max_block);
    console.log('');
    console.log('block_count:', block_count);
    console.log('delete_count:', delete_count);
    console.log('insert_count:', insert_count);
    console.log('skip_count:', skip_count);
    console.log('error_count:', error_count);

    console.log('');
    console.log('blocks/second:', (block_count / delta_ms) * 1000);
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
