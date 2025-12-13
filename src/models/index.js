const { Sequelize, DataTypes } = require('sequelize');
const { DB_HOST, DB_NAME, DB_USER, DB_PASSWORD, DB_PORT } = require('../config/env');

const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
  host: DB_HOST,
  port: DB_PORT,
  dialect: 'mysql',
  logging: false,
});

const User = require('./User')(sequelize, DataTypes);
const Role = require('./Role')(sequelize, DataTypes);

// relaciones
User.belongsToMany(Role, { through: 'user_roles', foreignKey: 'user_id' });
Role.belongsToMany(User, { through: 'user_roles', foreignKey: 'role_id' });

module.exports = {
  sequelize,
  User,
  Role,
};
