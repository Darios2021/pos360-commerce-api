const { Sequelize } = require('sequelize');
const env = require('../config/env');

const sequelize = new Sequelize(env.DB_NAME, env.DB_USER, env.DB_PASSWORD, {
  host: env.DB_HOST,
  port: env.DB_PORT,
  dialect: 'mysql',
  logging: env.NODE_ENV === 'development' ? console.log : false,
  timezone: '-03:00',
  dialectOptions: {
    // opcional, pero ayuda con MySQL8 en algunos casos
    // dateStrings: true,
  },
});

module.exports = sequelize;
