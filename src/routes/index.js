'use strict';

const express = require('express');

const block = require('./block');
const stats = require('./stats');

const router = new express.Router();
exports.router = router;

router.use(block.router);
router.use(stats.router);
