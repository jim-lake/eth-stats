'use strict';

const _ = require('lodash');
const util = require('util');
const async = require('async');
const fs = require('fs');
const crypto = require('crypto');

/* eslint no-useless-escape: "off" */
const EMAIL_REGEX = new RegExp(
  "^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$",
  'i'
);

exports.noop = noop;
exports.setRemoteLog = setRemoteLog;
exports.inspect = inspect;
exports.errorLog = errorLog;
exports.remoteLog = remoteLog;
exports.log = log;
exports.requiredProp = requiredProp;
exports.requiredType = requiredProp;
exports.optionalProp = optionalProp;
exports.optionalBool = optionalBool;
exports.requiredObject = requiredObject;
exports.optionalObject = optionalObject;
exports.requiredArray = requiredArray;
exports.optionalArray = optionalArray;
exports.isValidTypes = isValidTypes;
exports.deepClone = deepClone;
exports.md5 = md5;
exports.readView = readView;
exports.urlCat = urlCat;
exports.readSQL = readSQL;
exports.between = between;
exports.isBetween = isBetween;
exports.EMAIL_REGEX = EMAIL_REGEX;
exports.herdWrapper = herdWrapper;
exports.retryWrapper = retryWrapper;
exports.filterInPlace = filterInPlace;
exports.canonicalObjectMD5 = canonicalObjectMD5;
exports.jsonParse = jsonParse;
exports.mapSet = mapSet;
exports.mapAppend = mapAppend;
exports.mapPrepend = mapPrepend;
exports.mapGet = mapGet;
exports.getTime = getTime;
exports.setSyncTimeout = setSyncTimeout;
exports.pad = pad;
exports.timeFormat = timeFormat;
exports.byteFormat = byteFormat;

function noop() {}

let g_remoteLogFunc = null;
function setRemoteLog(func) {
  g_remoteLogFunc = func;
}

function inspect() {
  const s = _.reduce(
    arguments,
    (memo, a, index) => {
      if (index > 0) {
        memo += ' ';
      }

      if (typeof a == 'object') {
        memo += util.inspect(a, { depth: 99 });
      } else {
        memo += a;
      }
      return memo;
    },
    ''
  );
  console.log(s);
}

function errorLog() {
  const s = util.format.apply(this, arguments);
  console.error('[' + new Date().toUTCString() + '] ' + s);
  g_remoteLogFunc && g_remoteLogFunc(s);
  return s;
}
function remoteLog() {
  const s = util.format.apply(this, arguments);
  console.log('[' + new Date().toUTCString() + '] ' + s);
  g_remoteLogFunc && g_remoteLogFunc(s);
  return s;
}
function log() {
  const s = util.format.apply(this, arguments);
  console.log('[' + new Date().toUTCString() + '] ' + s);
  return s;
}

function optionalProp(req, prop, type) {
  let v;
  if (prop in req.body) {
    v = req.body[prop];
  } else if (req.query && prop in req.query) {
    v = req.query[prop];
  }

  if (v !== undefined) {
    if (type !== undefined) {
      if (type === 'number' && typeof v === 'string') {
        v = parseFloat(v);
        if (isNaN(v)) {
          throw { code: 400, body: `${prop} must be a ${type}` };
        }
      }

      if (typeof v !== type) {
        throw { code: 400, body: `${prop} must be a ${type}` };
      }
    } else if (v && typeof v === 'object') {
      throw { code: 400, body: `${prop} not allowed to be an object` };
    }
  }
  return v;
}
function requiredProp(req, prop, type) {
  const v = optionalProp(req, prop, type);
  if (v === undefined) {
    throw { code: 400, body: `${prop} is required` };
  }
  return v;
}
function optionalBool(req, prop) {
  let ret;

  let v = req.body[prop];
  if (v === undefined) {
    v = req.query && req.query[prop];
  }
  if (v !== undefined) {
    ret = !(
      v === false ||
      v === 0 ||
      v === null ||
      v === 'false' ||
      v === '0' ||
      v === 'null' ||
      v === ''
    );
  }
  return ret;
}
function optionalObject(req, prop) {
  let v;
  if (prop in req.body) {
    v = req.body[prop];
  } else if (req.query && prop in req.query) {
    v = req.query[prop];
  }
  if (v !== undefined && typeof v !== 'object') {
    throw { code: 400, body: `${prop} must be an object` };
  }
  return v;
}
function requiredObject(req, prop) {
  const v = optionalObject(req, prop);
  if (v === undefined) {
    throw { code: 400, body: `${prop} is required` };
  }
  return v;
}
function optionalArray(req, prop) {
  let v;
  if (req.body && prop in req.body) {
    v = req.body[prop];
  } else if (req.query && prop in req.query) {
    v = req.query[prop];
  }
  if (typeof v === 'string') {
    v = v.split(',');
  }
  if (v !== undefined && !Array.isArray(v)) {
    throw { code: 400, body: `${prop} must be an array` };
  }
  return v;
}
function requiredArray(req, prop) {
  const v = optionalArray(req, prop);
  if (v === undefined) {
    throw { code: 400, body: `${prop} is required` };
  }
  return v;
}
function isValidTypes(obj, spec) {
  if (typeof spec === typeof obj) {
    if (Array.isArray(spec)) {
      if (!obj.every(child => isValidTypes(child, spec[0]))) {
        return false;
      }
    } else if (typeof spec === 'object') {
      for (let key in spec) {
        if (!isValidTypes(obj[key], spec[key])) {
          return false;
        }
      }
    } else {
      return true;
    }
  } else {
    return false;
  }
  return true;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function urlCat() {
  let url = '';
  _.each(arguments, part => {
    if (url.length > 0 && url.charAt(url.length - 1) != '/') {
      url += '/';
    }
    if (part.charAt(0) == '/') {
      url += part.slice(1);
    } else {
      url += part;
    }
  });
  return url;
}

function md5() {
  const hash = crypto.createHash('md5');
  _.each(arguments, s => {
    hash.update(String(s), 'utf8');
  });
  return hash.digest('hex');
}

function readView(filename) {
  return fs.readFileSync(__dirname + '/views/' + filename, {
    encoding: 'utf8',
  });
}

function readSQL(filename) {
  return fs.readFileSync(__dirname + '/sql/' + filename, { encoding: 'utf8' });
}

function between(value, min, max) {
  return value > min ? (value < max ? value : max) : min;
}

function isBetween(value, min, max) {
  return value >= min && value <= max;
}

const g_done_list_map = {};
function herdWrapper(key, func) {
  if (key in g_done_list_map) {
    throw 'key in use:' + key;
  }
  g_done_list_map[key] = false;

  return done => {
    if (!done) {
      done = function() {};
    }

    if (g_done_list_map[key]) {
      g_done_list_map[key].push(done);
    } else {
      g_done_list_map[key] = [done];
      func((...args) => {
        const done_list = g_done_list_map[key];
        g_done_list_map[key] = false;
        done_list.forEach(done => done(...args));
      });
    }
  };
}

function retryWrapper(callback, done) {
  if (!done) {
    done = function() {};
  }

  const FACTOR = 2;
  const MIN_MS = 500;
  const MAX_MS = 60 * 1000;

  let success = false;
  let attempt = 0;

  async.until(
    () => success,
    done => {
      attempt++;
      let timeout = 0;
      if (attempt > 1) {
        timeout = Math.round(
          (Math.random() + 1) * MIN_MS * Math.pow(FACTOR, attempt)
        );
        timeout = Math.min(timeout, MAX_MS);
      }

      setTimeout(() => {
        callback(err => {
          if (!err) {
            success = true;
          }
          done();
        });
      }, timeout);
    },
    done
  );
}
function filterInPlace(array, callback) {
  for (let i = array.length - 1; i >= 0; i--) {
    if (!callback(array[i], i)) {
      array.splice(i, 1);
    }
  }
}

function _canonicalObject(input) {
  let output;
  if (input && typeof input === 'object') {
    output = {};
    const keys = Object.keys(input).sort();
    keys.forEach(k => (output[k] = _canonicalObject(input[k])));
  } else {
    output = input;
  }
  return output;
}
function canonicalObjectMD5(obj) {
  const json = JSON.stringify(_canonicalObject(obj), null, '');

  const hash = crypto.createHash('md5');
  hash.update(json, 'utf8');
  return hash.digest('hex');
}

function jsonParse(json, def) {
  let obj;
  try {
    obj = JSON.parse(json);
  } catch (e) {
    // noop
  }
  return obj || def;
}
function mapSet(obj, ...keys) {
  let map = obj;
  const value = keys[keys.length - 1];
  const last_key = keys[keys.length - 2];
  for (let i = 0; i < keys.length - 2; i++) {
    const key = keys[i];
    if (!map.has(key)) {
      map.set(key, new Map());
    }
    map = map.get(key);
  }
  map.set(last_key, value);
}
function mapAppend(obj, ...keys) {
  let map = obj;
  const value = keys[keys.length - 1];
  const last_key = keys[keys.length - 2];
  for (let i = 0; i < keys.length - 2; i++) {
    const key = keys[i];
    if (!map.has(key)) {
      map.set(key, new Map());
    }
    map = map.get(key);
  }
  let ret;
  if (map.has(last_key)) {
    ret = map.get(last_key);
    ret.push(value);
  } else {
    ret = [value];
    map.set(last_key, ret);
  }
  return ret;
}
function mapPrepend(obj, ...keys) {
  let map = obj;
  const value = keys[keys.length - 1];
  const last_key = keys[keys.length - 2];
  for (let i = 0; i < keys.length - 2; i++) {
    const key = keys[i];
    if (!map.has(key)) {
      map.set(key, new Map());
    }
    map = map.get(key);
  }
  let ret;
  if (map.has(last_key)) {
    ret = map.get(last_key);
    ret.unshift(value);
  } else {
    ret = [value];
    map.set(last_key, ret);
  }
  return ret;
}
function mapGet(obj, ...keys) {
  let ret = obj;
  for (let i = 0; ret && i < keys.length; i++) {
    ret = ret.get(keys[i]);
  }
  return ret;
}

function getTime(date_obj) {
  let ret;
  if (date_obj instanceof Date) {
    ret = date_obj.getTime();
  }
  return ret;
}

function setSyncTimeout(callback, interval_ms) {
  const now = Date.now();
  const next_ms = Math.ceil(now / interval_ms) * interval_ms - now;
  return setTimeout(callback, next_ms);
}

function pad(source, length) {
  let s = String(source);

  for (let i = s.length; i < (length || 2); i++) {
    s = '0' + s;
  }
  return s;
}
function timeFormat(time) {
  let seconds = Math.round(time / 1000);

  let hours = 0;
  let days = 0;
  let minutes = 0;
  if (seconds > 60) {
    minutes = Math.floor(seconds / 60);
    seconds -= minutes * 60;
  }
  if (minutes > 60) {
    hours = Math.floor(minutes / 60);
    minutes -= hours * 60;
  }
  if (hours > 24) {
    days = Math.floor(hours / 24);
    hours -= days * 24;
  }

  let ret;
  if (days > 0) {
    ret = days + 'd ' + pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);
  } else {
    ret = pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);
  }

  return ret;
}

function byteFormat(bytes) {
  const POSTFIXES = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

  let rank = 0;
  let ret = bytes;
  while (ret > 1024) {
    ret /= 1024;
    rank++;
  }
  if (rank > 0) {
    ret = ret.toFixed(3);
  } else {
    ret = String(ret);
  }
  return ret + POSTFIXES[rank];
}
