'use strict';

const express = require('express');

const db = require('../tools/pg_db.js');
const util = require('../tools/util.js');

const router = new express.Router();
exports.router = router;

router.get('/1/stats', getStats);

function getStats(req, res) {
  res.header('Cache-Control', 'no-cache,no-store,must-revalidate');

  const sql = `
SELECT
  COUNT(*) AS block_count,
  MIN(block_number) AS min_block,
  MAX(block_number) AS max_block
FROM block
`;
  db.queryFromPool(sql, [], (err, results) => {
    if (err) {
      util.errorLog('stats.getStats: sql err:', err);
      res.sendStatus(500);
    } else {
      res.send(results[0]);
    }
  });
}
