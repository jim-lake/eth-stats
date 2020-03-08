'use strict';

const express = require('express');

const block = require('./block');
const contract = require('./contract');
const stats = require('./stats');

const router = new express.Router();
exports.router = router;

router.use(block.router);
router.use(contract.router);
router.use(stats.router);
