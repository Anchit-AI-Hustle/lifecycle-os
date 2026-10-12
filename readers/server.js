#!/usr/bin/env node
'use strict';
/**
 * readers/server.js - the same reader as a plain Node server, for a VM in a
 * country Vercel has no region in. Routes: POST /read (and /api/read),
 * GET /health (and /api/health). Env: READER_SECRET (>= 32 characters),
 * READER_COUNTRY (e.g. SA), READER_REGION (e.g. me-central2), PORT (8080),
 * HOST (0.0.0.0). See README.md.
 */
const http = require('http');
const { handler } = require('./lib/handler.js');

const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || '0.0.0.0';
const server = http.createServer((req, res) => { handler(req, res); });
server.requestTimeout = 30000;
server.headersTimeout = 10000;
server.listen(port, host, () => {
  process.stdout.write(`reader listening on ${host}:${port} (country ${process.env.READER_COUNTRY || 'unset'}, region ${process.env.READER_REGION || 'unset'})\n`);
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
