'use strict';

const crypto = require('crypto');
const async = require('async');

const aws = require('./aws');
const db = require('./pg_db');
const util = require('./util');

exports.appendRow = appendRow;
exports.s3WriteBufferMap = s3WriteBufferMap;
exports.importFile = importFile;

function appendRow(buffer_map, table_name, value_list) {
  let new_line = '';

  for (let i = 0; i < value_list.length; i++) {
    if (i > 0) {
      new_line += ',';
    }
    const val = value_list[i];
    if (val === null) {
      new_line += '\\N';
    } else {
      new_line += String(val);
    }
  }
  new_line += '\n';

  if (table_name in buffer_map) {
    buffer_map[table_name] += new_line;
  } else {
    buffer_map[table_name] = new_line;
  }
}

function s3WriteBufferMap(params, done) {
  const { bufferMap, bucket } = params;
  const prefix = params.prefix + '/' || '';
  const table_name_list = Object.keys(bufferMap);

  const table_key_map = {};
  async.each(
    table_name_list,
    (table_name, done) => {
      const csv_string = bufferMap[table_name];
      const iso_s = new Date().toISOString();
      const date = iso_s.slice(0, 10);
      const time = iso_s.slice(11, 19).replace(/:/g, '');
      const hash = crypto
        .createHash('md5')
        .update(csv_string)
        .digest('hex');

      const key = `${prefix}${date}/${time}/${table_name}_${hash}.csv`;
      const opts = {
        bucket,
        key,
        body: csv_string,
        contentType: 'text/csv',
        gzip: true,
      };
      aws.s3write(opts, err => {
        if (err) {
          util.errorLog('csv_db.s3WriteBuffer: s3 error:', err);
        } else {
          table_key_map[table_name] = key;
        }
        done(err);
      });
    },
    err => {
      done(err, table_key_map);
    }
  );
}

function importFile(params, done) {
  const { table, bucket, key, region } = params;
  const sql = `SELECT aws_s3.table_import_from_s3($1,'','(FORMAT CSV, NULL ''\\N'')',aws_commons.create_s3_uri($2,$3,$4))`;
  const values = [table, bucket, key, region];
  db.queryFromPool(sql, values, err => {
    if (err) {
      util.errorLog('csv_db.importFile: sql err:', err);
    }
    done(err);
  });
}
