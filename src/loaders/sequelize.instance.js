const { Sequelize } = require('sequelize');
const env = require('../config/env');

const sequelize = new Sequelize(env.DB_NAME, env.DB_USER, env.DB_PASSWORD, {
  host: env.DB_HOST,
  port: Number(env.DB_PORT || 3306),
  dialect: 'mysql',
  logging: env.NODE_ENV === 'development' ? console.log : false,
});

module.exports = { sequelize };
