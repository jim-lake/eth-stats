'use strict';

const async = require('async');
const db = require('../tools/pg_db');
const rlp = require('rlp');
const Block = require('ethereumjs-block');
const fs = require('fs');
const config = require('../../config.json');
const BlockTransform = require('../lib/block_transform');
const argv = require('yargs').argv;

const PARALLEL_LIMIT = 10;
const BUFFER_MIN = 10000000;
const READ_LEN = BUFFER_MIN * 2;

const delete_blocks = argv['delete-blocks'] || false;
const only_block = argv['only-block'];
const skip_until = argv['skip-until'] || 0;
const input_file = argv._[0];

console.log('input file:', input_file);
console.log('delete blocks before insert:', delete_blocks);
if (only_block !== undefined) {
  console.log('only block number:', only_block);
}
if (skip_until) {
  console.log('skip blocks until block number:', skip_until);
}
console.log('');

db.init(config.db);

const read_buffer = Buffer.allocUnsafe(READ_LEN);
const fd = fs.openSync(input_file, 'r');
if (!fd) {
  console.error('failed to open file:', input_file);
  process.exit(-1);
}
const bytes_read = fs.readSync(fd, read_buffer, 0, READ_LEN, null);

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
      const rlp_ret = rlp.decode(remainder, true);
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

let file_done = false;
const generateRlpBlock = {
  // LOL
  [Symbol.toStringTag]: 'AsyncGenerator',
  next: () =>
    new Promise((resolve, reject) => {
      if (remainder.length === 0 && file_done) {
        resolve({ done: true });
      } else if (remainder.length > BUFFER_MIN || file_done) {
        const data = _updateRemainder();
        if (data) {
          resolve({ value: data });
        } else {
          resolve({ done: true });
        }
      } else {
        fs.read(fd, read_buffer, 0, READ_LEN, null, (err, bytes_read) => {
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
    const b = new Block(data);
    const block_number = BlockTransform.getInt(b.header.number);

    if (only_block !== undefined && only_block !== block_number) {
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
    if (err) {
      console.log('run err:', err);
    }

    db.end(err => {
      if (err) {
        console.log('pool end err:', err);
      }

      const end_time = Date.now();
      const delta_ms = end_time - start_time;

      console.log('end_time:', new Date(end_time));
      console.log('delta_ms:', delta_ms);
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
      console.log('');
      console.log('done done');
    });
  }
);

function _importBlock(block_number, b, done) {
  let sql;

  try {
    sql = BlockTransform.getBlockSql(b);
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
          db.queryFromPool(sql, [], err => {
            if (err && err.code === '23505') {
              skip_count++;
              console.log('skip?:', block_number);
              console.log('err:', err.detail ? err.detail : err);
              //console.log('sql:', sql);
              err = null;
            } else if (err) {
              error_count++;
              console.error('insert err:', err);
              //console.log('sql:', sql);
            } else {
              insert_count++;
              console.log('inserted block:', block_number);
            }
            done(err);
          });
        },
      ],
      done
    );
  } catch (e) {
    console.error(`block(${block_number}) threw:`, e);
    error_count++;
    done(e);
  }
}
