const AWS = require('aws-sdk');
const { Readable } = require('stream');
const zlib = require('zlib');
const util = require('./util');

exports.s3write = s3write;

const g_s3Client = new AWS.S3();

function s3write(params, done) {
  const { body, gzip } = params;

  if (gzip) {
    zlib.gzip(body, {}, (err, buf) => {
      if (err) {
        done(err);
      } else {
        const opts = Object.assign({}, params, {
          body: buf,
          contentEncoding: 'gzip',
        });
        _rawS3Write(opts, done);
      }
    });
  } else {
    _rawS3Write(params, done);
  }
}

function _rawS3Write(params, done) {
  const { bucket, key, body, contentType, contentEncoding } = params;

  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const readable = new Readable({ highWaterMark: 5 * 1024 * 1024 });
  let pos = 0;
  readable._read = size => {
    if (pos >= buffer.length) {
      return readable.push(null);
    }
    let end = pos + size;
    if (end > buffer.length) {
      end = buffer.length;
    }
    readable.push(buffer.slice(pos, end));
    pos = end;
  };

  const opts = {
    Bucket: bucket,
    Key: key,
    ContentLength: buffer.length,
    Body: readable,
    ContentType: contentType,
  };
  if (contentEncoding) {
    opts.ContentEncoding = contentEncoding;
  }
  g_s3Client.putObject(opts, (err, data) => {
    if (err) {
      util.errorLog('aws.s3write: err:', err);
    }
    done(err, data);
  });
}
