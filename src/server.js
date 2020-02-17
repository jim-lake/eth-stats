'use strict';

process.env.TZ = 'UTC';

const config = require('node-config-sets');
const body_parser = require('body-parser');
const cookie_parser = require('cookie-parser');
const errorhandler = require('errorhandler');
const express = require('express');
const http = require('http');
const method_override = require('method-override');
const morgan = require('morgan');
const multipart = require('connect-multiparty');
const path = require('path');

// before other includes
config.globalLoad({ rootdir: path.join(__dirname, '..') });

const db = require('./tools/pg_db');
const util = require('./tools/util');
const routes = require('./routes');

util.log('eth-stats: Startup');

db.init(config.db);

const app = express();

const g_isDev = app.get('env') === 'development';
app.enable('trust proxy');
app.set('port', process.env.PORT || 3090);
app.set('x-powered-by', false);

const http_server = http.createServer(app);

app.all('/status_check', function(req, res) {
  res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendStatus(200);
});

morgan.token('url', req =>
  req.url.replace(
    /(player_session_key|admin_session_key)=[^&]*/,
    '$1=[REDACTED]'
  )
);
if (g_isDev) {
  app.use(
    morgan(
      '[:date] :method :url :status :res[content-length] - :response-time ms ":referrer" ":user-agent"'
    )
  );
} else {
  app.use(
    morgan(
      ':remote-addr - - [:date] ":method :url HTTP/:http-version" :status :response-time(ms) ":referrer" ":user-agent"'
    )
  );
}
app.use(_allowTextContentType);
app.use(_allowCrossDomain);

app.use(body_parser.json({ limit: '50mb' }));
app.use(body_parser.urlencoded({ extended: false, limit: '50mb' }));
app.use(multipart());
app.use(cookie_parser());
app.use(method_override());

app.use(routes.router);

if (g_isDev) {
  app.all('/quit', () => {
    process.exit(0);
  });
}

app.use(_throwErrorHandler);

util.log('eth-stats: Ready to start server.');
http_server.listen(app.get('port'), function() {
  util.log('eth-stats: Server listening on port', app.get('port'));
});

function _allowTextContentType(req, res, next) {
  if (req.is('text/plain')) {
    req.headers['content-type'] = 'application/json';
  }
  next();
}
function _allowCrossDomain(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'content-type,accept,x-player-session-key'
  );
  res.header('Access-Control-Max-Age', '3600');
  if (req.method === 'OPTIONS') {
    res.header('Cache-Control', 'no-cache,no-store,must-revalidate');
    res.sendStatus(204);
  } else {
    next();
  }
}

function _throwErrorHandler(err, req, res, next) {
  if (err && err.code && err.body && typeof err.code === 'number') {
    res.header('Cache-Control', 'no-cache,no-store,must-revalidate');
    res.status(err.code).send(err.body);
  } else if (g_isDev) {
    errorhandler()(err, req, res, next);
  } else {
    util.errorLog('Middleware err:', err);
    res.header('Cache-Control', 'no-cache,no-store,must-revalidate');
    res.sendStatus(500);
  }
}
