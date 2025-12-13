const authService = require('../service/auth.service');

async function login(req, res, next) {
  try {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) {
      return res.status(400).json({ message: 'identifier and password are required' });
    }

    const result = await authService.login({ identifier, password });

    if (!result.ok) {
      if (result.code === 'INVALID_CREDENTIALS') {
        return res.status(401).json({ message: 'Invalid credentials' });
      }
      if (result.code === 'USER_DISABLED') {
        return res.status(403).json({ message: 'User disabled' });
      }
      return res.status(400).json({ message: 'Login error' });
    }

    return res.json({
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { login };
