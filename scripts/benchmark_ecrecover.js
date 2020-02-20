'use strict';

const async = require('async');
const ethers = require('ethers');
const EthUtil = require('ethereumjs-util');
const fs = require('fs');
const yargs = require('yargs').argv;
const argv = yargs._;
const timer = require('../src/tools/timer');
const rlp = require('rlp');
const workers = require('worker_threads');
const secp256k1 = require('secp256k1');

const WORKER_COUNT = 8;
const g_workers = [];
let g_waiter = null;

if (workers.isMainThread) {
  console.log("main thead start");

  const chain_id = undefined;

  const skip_ethers = yargs['skip-ethers'] || false;
  const skip_util = yargs['skip-util'] || false;
  const skip_hash = yargs['skip-hash'] || false;

  let raw_data;
  if (argv[0] === '-') {
    console.log("read from stdin");
    raw_data = fs.readFileSync('/dev/stdin');
  } else {
    raw_data = Buffer.from(argv[0],'hex');
  }

  let raw_rlp = rlp.decode(raw_data);
  if (raw_rlp[1][0] && raw_rlp[1][0].length === 9) {
    console.log("whole block, pulling tx 0");
    raw_rlp = raw_rlp[1][0];
  }

  const msg_hash = _getMsgHash(raw_rlp);
  const msg_hash_str = msg_hash.toString('hex');
  const v = _getInt(raw_rlp[6]);
  const r = raw_rlp[7];
  const s = raw_rlp[8];

  const r_hex = '0x' + r.toString('hex');
  const s_hex = '0x' + s.toString('hex');

  console.log('msg_hash:', msg_hash);
  console.log('v:', v);
  console.log('r:', r);
  console.log('s:', s);
  console.log('');

  console.log('correctness:');
  console.log('');
  console.log(
    '_testEthUtilHash:',
    _testEthUtilHash(raw_rlp, v, r, s, chain_id)
  );
  console.log(
    '_testEthUtil:',
    _testEthUtil(msg_hash, v, r, s, chain_id)
  );
  console.log(
    '_testEthers:',
    _testEthers(msg_hash, v, r_hex, s_hex, chain_id)
  );
  console.log('----------');
  console.log('');

  _setupWorkers();

  async.series([
    done => {
      async.eachSeries([1, 1000, 10000, 100000],(count,done) => {
        const tag = `workers-${count}`;
        const t = timer.start();
        _testWorkers(count,raw_rlp,v,r,s,() => {
          timer.end(t,tag);
          const delta = Number(timer.get(tag));
          const delta_s = delta / 1000000000;
          console.log('timer:', tag, delta_s, '(s)', 'ops/second:', count / delta_s);
          done();
        });
      },done);
    },
  ],err => {
    _killWorkers();
    if (!skip_ethers) {
      [1, 1000, 10000].forEach(i =>
        _testNTimes(
          `ethers-${i}`,
          () => {
            _testEthers(msg_hash, v, r_hex, s_hex, chain_id);
          },
          i
        )
      );
    }

    if (!skip_util) {
      [1, 1000, 10000, 100000].forEach(i =>
        _testNTimes(
          `util-${i}`,
          () => {
            _testEthUtil(msg_hash, v, r, s, chain_id);
          },
          i
        )
      );
    }

    if (!skip_hash) {
      [1, 1000, 10000, 100000].forEach(i =>
        _testNTimes(
          `hash-${i}`,
          () => {
            _testEthUtilHash(raw_rlp, v, r, s, chain_id);
          },
          i
        )
      );
    }
  });
} else {
  _doWorker();
}

function _addrToString(addr) {
  return addr
}

function _testEthUtil(msg_hash, v, r, s, chain_id) {
  try {
    const pub_key = EthUtil.ecrecover(msg_hash, v, r, s, chain_id);
    const pub_addr = EthUtil.publicToAddress(pub_key).toString('hex');
    return pub_addr;
  } catch (e) {
    console.error('threw:', e);
  }
  return undefined;
}

function _testEthUtilHash(raw_rlp, v, r, s, chain_id) {
  try {
    const items = raw_rlp.slice(0, 6);
    const msg_hash = EthUtil.rlphash(items);
    const pub_key = _ecrecover(msg_hash, v, r, s, chain_id);
    const pub_addr = EthUtil.publicToAddress(pub_key).toString('hex');
    return pub_addr;
  } catch (e) {
    console.error('threw:', e);
  }
  return undefined;
}

function _testEthers(msg_hash_str, v, r, s, chain_id) {
  try {
    const pub_addr = ethers.utils.recoverAddress(msg_hash_str, { v, r, s });
    return pub_addr;
  } catch (e) {
    console.error('threw:', e);
  }
  return undefined;
}

function _testNTimes(tag, func, count) {
  const t = timer.start();
  for (let i = 0; i < count; i++) {
    func();
  }
  timer.end(t, tag);
  const delta = Number(timer.get(tag));
  const delta_s = delta / 1000000000;
  console.log('timer:', tag, delta_s, '(s)', 'ops/second:', count / delta_s);
}

function _getMsgHash(raw_rlp) {
  const items = raw_rlp.slice(0, 6);
  return EthUtil.rlphash(items);
}

function _getInt(buf) {
  let ret = 0;
  if (buf.length > 6) {
    throw 'doh';
  } else if (buf.length > 0) {
    ret = buf.readUIntBE(0, buf.length);
  }
  return ret;
}

function _setupWorkers() {
  for (let i = 0 ; i < WORKER_COUNT ; i++) {
    const worker = new workers.Worker(__filename);
    g_workers.push({
      worker,
      is_busy: false,
    });
  }
}
function _getWorker() {
  let ret;
  g_workers.some(w => {
    if (!w.is_busy) {
      w.is_busy = true;
      ret = w;
    }
    return ret;
  });
  return ret;
}

function _freeWorker(worker) {
  worker.is_busy = false;
  if (g_waiter) {
    g_waiter();
  }
}
function _waitForAllFree(done) {
  async.forever(done => {
    const all_free = g_workers.every(w => !w.is_busy);
    if (all_free) {
      done('end');
    } else {
      g_waiter = () => {
        g_waiter = null;
        done();
      }
    }
  },
  err => {
    done();
  });
}

function _killWorkers() {
  g_workers.forEach(w => {
    w.worker.terminate();
  });
}

function _testWorkers(count,raw_rlp,v,r,s,done) {
  async.timesSeries(count,(n,done) => {
    let w = _getWorker();
    async.until(done => done(w),done => {
      //console.log("wait for worker");
      g_waiter = () => {
        //console.log("wait done");
        g_waiter = null;
        w = _getWorker();
        done();
      };
    },err => {
      w.worker.once('message',m => {
        //console.log("worker message:",m);
        _freeWorker(w);
      });
      //console.log("post message to thread:",w.worker.threadId)
      w.worker.postMessage([n,raw_rlp,v,r,s]);
      done();
    });
  },err => {
    _waitForAllFree(err => {
      done();
    });
  });
}

let clientPort;
function _doWorker() {
  console.log("worker start:",workers.threadId);
  workers.parentPort.on('message',m => {
    const [n,raw_rlp,v,r,s] = m;
    //console.log("worker:",workers.threadId,"n:",n);
    const chain_id = undefined;
    const addr = _testEthUtilHash(raw_rlp,v,r,s,chain_id);
    workers.parentPort.postMessage([n,addr]);
  });
}

function _ecrecover(msg_hash,v,r,s,chainId) {
  const signature = Buffer.concat([r,s], 64);
  const recovery = calculateSigRecovery(v, chainId);
  if (!isValidSigRecovery(recovery)) {
      throw new Error('Invalid signature v value');
  }
  const senderPubKey = secp256k1.recover(msg_hash, signature, recovery);
  return secp256k1.publicKeyConvert(senderPubKey, false).slice(1);
}
function calculateSigRecovery(v, chainId) {
    return chainId ? v - (2 * chainId + 35) : v - 27;
}
function isValidSigRecovery(recovery) {
    return recovery === 0 || recovery === 1;
}
