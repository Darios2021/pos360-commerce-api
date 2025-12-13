const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');

function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [type, token] = header.split(' ');

    if (type !== 'Bearer' || !token) {
      return res.status(401).json({ ok: false, code: 'NO_TOKEN' });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { sub, email, username, roles, ... }
    return next();
  } catch (err) {
    return res.status(401).json({ ok: false, code: 'INVALID_TOKEN' });
  }
}

module.exports = { requireAuth };
