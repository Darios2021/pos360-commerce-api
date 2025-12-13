const sequelize = require('./sequelize.instance');

async function initSequelize() {
  await sequelize.authenticate();
  return sequelize;
}

module.exports = { initSequelize };
