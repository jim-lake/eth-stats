'use strict';

const fs = require('fs');

let db_pool;

exports.init = init;
exports.end = end;
exports.pool = db_pool;
exports.queryFromPool = queryFromPool;
exports.queryFromPoolWithConnection = queryFromPoolWithConnection;
exports.begin = begin;
exports.query = query;
exports.commit = commit;
exports.rollback = rollback;
exports.buildQuery = buildQuery;

let g_out_stream;

function init(params) {
  const opts = {
    flags: 'w+',
  };
  g_out_stream = fs.createWriteStream(params.file, opts);
  g_out_stream.on('error', _onError);
}
function end(done) {
  g_out_stream.end('-- END\n', 'utf8', done);
}

function queryFromPool(opts, values, done) {
  query(null, opts, values, done);
}
function queryFromPoolWithConnection(opts, values, done) {
  query(null, opts, values, done);
}

function begin(done) {
  _write('BEGIN;\n', done);
}
function query(client, opts, values, done) {
  const sql = typeof opts === 'string' ? opts : opts.sql;
  _write(sql + ';\n', done);
}

function commit(client, done) {
  _write('COMMIT;\n', done);
}
function rollback(client, done) {
  _write('ROLLBACK;\n', done);
}

function _write(str, done) {
  const can_write_again = g_out_stream.write(str, 'utf8');
  if (can_write_again) {
    done();
  } else {
    g_out_stream.once('drain', () => {
      done();
    });
  }
}
function _onError(err) {
  console.error('fake_db._onError: err:', err);
}
function buildQuery(input_sql, object) {
  const keys = Object.keys(object);
  const values = Object.values(object);

  const numbers = keys.map((k, i) => {
    return '$' + String(i + 1);
  });

  const insert_sql = `(${keys.join(',')}) VALUES (${numbers.join(',')})`;
  const sql = input_sql.replace('?', insert_sql);
  return {
    sql,
    values,
  };
}
