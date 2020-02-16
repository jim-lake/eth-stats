'use strict';

process.env.TZ = 'UTC';

const async = require('async');
const pg = require('pg');

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

function init(params) {
  const opts = Object.assign({}, params, {
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
  pg.defaults.parseInt8 = true;
  db_pool = new pg.Pool(opts);
  db_pool.on('error', _onPoolError);
}
function end(done) {
  if (db_pool) {
    db_pool.end(done);
  } else {
    done('no_pool');
  }
}

function queryFromPool(opts, values, done) {
  if (!done && typeof values === 'function') {
    done = values;
    values = [];
  }

  db_pool.query(opts, values, function(err, result) {
    let results;
    if (!err) {
      results = _resultToResults(result);
      if (!results) {
        err = 'bad_result_format';
      }
    }
    done(err, results, result);
  });
}
function queryFromPoolWithConnection(opts, values, done) {
  let client;
  let results;
  async.series(
    [
      done => {
        db_pool.connect((err, c) => {
          if (!err && c) {
            c.on('error', _onClientError);
          }
          client = c;
          done(err);
        });
      },
      done => {
        query(client, opts, values, (err, r) => {
          results = r;
          done(err);
        });
      },
    ],
    err => {
      done(err, results, client);
    }
  );
}

function begin(done) {
  let client;
  async.series(
    [
      done => {
        db_pool.connect((err, c) => {
          if (!err && c) {
            c.on('error', _onClientError);
          }
          client = c;
          done(err);
        });
      },
      done => {
        client.query('BEGIN', done);
      },
    ],
    err => {
      done(err, client);
    }
  );
}
function query(client, sql, values, done) {
  client.query(sql, values, function(err, result) {
    let results;
    if (!err) {
      results = _resultToResults(result);
      if (!results) {
        err = 'bad_result_format';
      }
    }
    done(err, results, result);
  });
}

function commit(client, done) {
  client.query('COMMIT', err => {
    if (!err) {
      try {
        client.release();
        client.removeListener('error', _onClientError);
      } catch (e) {
        console.error('pg_db.commit release throw:', e);
      }
    }
    done(err);
  });
}
function rollback(client, done) {
  if (client) {
    try {
      client.query('ROLLBACK', err => {
        try {
          client.release();
          client.removeListener('error', _onClientError);
        } catch (e) {
          console.error('pg_db.rollback release throw:', e);
        }
        done && done(err);
      });
    } catch (e) {
      done && done(e);
    }
  } else {
    done && done();
  }
}

function _resultToResults(result) {
  let results;
  if (Array.isArray(result)) {
    results = result.map(r => r.rows);
  } else if (result && result.rows) {
    results = result.rows;
  }
  return results;
}

function _onPoolError(err) {
  console.error('pg_db._onPoolError: err:', err);
}
function _onClientError(err) {
  console.error('pg_db._onClientError: err:', err);
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
