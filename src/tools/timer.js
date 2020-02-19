'use strict';

const util = require('./util');

exports.start = start;
exports.end = end;
exports.getString = getString;
exports.get = get;

const g_timerMap = new Map();

function start() {
  return process.hrtime.bigint();
}
function end(start, tag) {
  const now = process.hrtime.bigint();
  const delta = now - start;
  const old = g_timerMap.get(tag);
  if (old) {
    g_timerMap.set(tag, old + delta);
  } else {
    g_timerMap.set(tag, delta);
  }
}
function getString(tag, div) {
  const sum = g_timerMap.get(tag);
  let ret;
  if (sum) {
    let ms = Number(sum / BigInt(1000000));
    if (div) {
      ms /= div;
    }
    ret = util.timeFormat(ms);
  } else {
    ret = `Invalid timer: ${tag}`;
  }
  return ret;
}

function get(tag) {
  return g_timerMap.get(tag);
}
