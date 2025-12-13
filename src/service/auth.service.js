const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');

const { User, Role } = require('../models');
const {
  JWT_SECRET,
  JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRES,
  JWT_REFRESH_EXPIRES,
} = require('../config/env');

async function login({ identifier, password }) {
  // username o email
  const user = await User.findOne({
    where: {
      [Op.or]: [{ email: identifier }, { username: identifier }],
    },
  });

  if (!user) return { ok: false, code: 'INVALID_CREDENTIALS' };
  if (user.is_active === false) return { ok: false, code: 'USER_DISABLED' };

  const match = await bcrypt.compare(password, user.password);
  if (!match) return { ok: false, code: 'INVALID_CREDENTIALS' };

  // roles del usuario
  const roles = await user.getRoles({ attributes: ['name'] });
  const roleNames = roles.map((r) => r.name);

  const payload = {
    sub: String(user.id),
    email: user.email,
    username: user.username,
    roles: roleNames,
  };

  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_ACCESS_EXPIRES });
  const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRES });

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      roles: roleNames,
    },
    accessToken,
    refreshToken,
  };
}

module.exports = { login };
