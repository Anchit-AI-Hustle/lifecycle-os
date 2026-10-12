'use strict';
// GET /api/health - which country and region this reader runs in. Fetches nothing.
const { handler } = require('../lib/handler.js');
module.exports = (req, res) => handler(req, res);
