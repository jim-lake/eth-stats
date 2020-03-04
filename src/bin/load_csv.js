'use strict';

const async = require('async');
const db = require('../tools/pg_db');
const config = require('../../config.json');
const util = require('../tools/util');
const timer = require('../tools/timer');
const argv = require('yargs').argv;

process.on('uncaughtException', err => {
  console.log('Caught exception:', err);
});

let user_shutdown = false;
process.on('SIGINT', () => {
  console.log('');
  console.log('got SIGINT: shutting down next loop.');
  console.log('');
  user_shutdown = true;
});

const REGION = 'us-west-2';
const S3_REGEX = /s3:\/\/([^/]*)\/(.*)/;

const run_silent = argv['silent'] || false;
const run_quiet = argv['quiet'] || run_silent;
const first_block = argv['first-block'] || '0';

if (run_silent) {
  console.log('running silent');
} else if (run_quiet) {
  console.log('running quiet');
}

const db_opts = Object.assign(
  {
    idleTimeoutMillis: 120000,
    connectionTimeoutMillis: 30000,
  },
  config.db
);
db.init(db_opts);
db.pool.on('connect', client => {
  client.query('SET synchronous_commit TO OFF');
});

console.log('');

const start_time = Date.now();
console.log('start_time:', new Date(start_time));

let min_block_number = 1e99;
let max_block_number = 0;

_run();

function _run() {
  _loadFiles(err => {
    if (user_shutdown) {
      console.log('shutting down db.');
      db.end(err => {
        console.log('db end done: err:', err);
      });
    } else if (err === 'nothing') {
      console.log('nothing, waiting...');
      setTimeout(_run, 5000);
    } else {
      setImmediate(_run);
    }
  });
}

function _loadFiles(done) {
  if (max_block_number > 0) {
    const now = Date.now();
    const delta_ms = now - start_time;
    const block_count = max_block_number - min_block_number + 1;

    console.log('');
    console.log('loaded:', block_count);
    console.log('- delta time:', util.timeFormat(delta_ms));
    console.log('- blocks/second:', (block_count / delta_ms) * 1000);
    console.log('');
  }

  let etl_files;
  async.series(
    [
      done => {
        const sql = `
SELECT *
FROM etl_file
WHERE
  is_imported = false
  AND start_block_number >= $1
ORDER BY
  start_block_number ASC,
  CASE
    WHEN table_name = 'block' THEN 0
    WHEN table_name = 'uncle' THEN 1
    WHEN table_name = 'transaction' THEN 2
    WHEN table_name = 'contract' THEN 3
    ELSE 99
  END ASC
LIMIT 10
`;
        db.queryFromPool(sql, [first_block], (err, results) => {
          if (err) {
            console.error('_loadFiles: find err:', err);
          } else if (results.length === 0) {
            done('nothing');
          } else {
            etl_files = results;
          }
          done(err);
        });
      },
      done => {
        async.eachSeries(
          etl_files,
          (result, done) => {
            const {
              etl_file_id,
              table_name,
              s3_url,
              start_block_number,
              end_block_number,
            } = result;
            const [_ignore, bucket, path] = s3_url.match(S3_REGEX);
            const sql = `
BEGIN;
SET CONSTRAINTS ALL DEFERRED;
SELECT aws_s3.table_import_from_s3(
    '${table_name}',
    '',
    '(FORMAT CSV, NULL ''\\N'')',
    aws_commons.create_s3_uri('${bucket}','${path}','${REGION}')
  );
COMMIT;
UPDATE etl_file SET is_imported = true WHERE etl_file_id = ${etl_file_id};
`;
            db.queryFromPool(sql, [], (err, results) => {
              if (err) {
                console.error('_loadFiles: load err:', err, results);
              } else {
                console.log(
                  '- loaded:',
                  table_name,
                  start_block_number,
                  end_block_number
                );

                min_block_number = Math.min(
                  start_block_number,
                  min_block_number
                );
                max_block_number = Math.max(end_block_number, max_block_number);
              }
              if (user_shutdown) {
                err = 'user_shutdown';
              }
              done(err);
            });
          },
          done
        );
      },
    ],
    done
  );
}
