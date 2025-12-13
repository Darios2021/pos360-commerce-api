const { Sequelize } = require('sequelize');
const { DB, NODE_ENV } = require('../config/env');

let sequelize;

const initSequelize = async () => {
  sequelize = new Sequelize(DB.NAME, DB.USER, DB.PASSWORD, {
    host: DB.HOST,
    port: DB.PORT,
    dialect: 'mysql',
    logging: NODE_ENV === 'development' ? false : false
  });

  await sequelize.authenticate();
  global.sequelize = sequelize;

  return sequelize;
};

const getSequelize = () => {
  if (!sequelize) throw new Error('Sequelize not initialized yet');
  return sequelize;
};

module.exports = { initSequelize, getSequelize };
