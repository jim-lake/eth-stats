'use strict';

const express = require('express');

const db = require('../tools/pg_db.js');
const util = require('../tools/util.js');

const router = new express.Router();
exports.router = router;

router.get('/1/contract', getSummary);

function getSummary(req, res) {
  res.header('Cache-Control', 'no-cache,no-store,must-revalidate');

  const sql = `
SELECT
  COUNT(*) AS contract_count
FROM contract
`;
  db.queryFromPool(sql, [], (err, results) => {
    if (err) {
      util.errorLog('contract.getSummary: sql err:', err);
      res.sendStatus(500);
    } else {
      res.send(results[0]);
    }
  });
}
