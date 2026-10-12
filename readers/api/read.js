'use strict';
// POST /api/read - one signed GET from this country. See lib/handler.js.
const { handler } = require('../lib/handler.js');
module.exports = (req, res) => handler(req, res);
