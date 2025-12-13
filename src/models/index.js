const fs = require('fs');
const path = require('path');

const sequelize = require('../loaders/sequelize.instance'); 
// 👆 Si vos no tenés este archivo, decime y lo adaptamos.
// La idea: exportar la misma instancia sequelize que usás para conectarte.

const basename = path.basename(__filename);
const db = {};

fs.readdirSync(__dirname)
  .filter((file) => file.indexOf('.') !== 0 && file !== basename && file.endsWith('.js'))
  .forEach((file) => {
    const modelFactory = require(path.join(__dirname, file));
    const model = modelFactory(sequelize);
    db[model.name] = model;
  });

// Asociaciones
const { User, Role, Permission } = db;

if (User && Role) {
  User.belongsToMany(Role, { through: 'user_roles', foreignKey: 'user_id', otherKey: 'role_id', as: 'roles' });
  Role.belongsToMany(User, { through: 'user_roles', foreignKey: 'role_id', otherKey: 'user_id', as: 'users' });
}

if (Role && Permission) {
  Role.belongsToMany(Permission, { through: 'role_permissions', foreignKey: 'role_id', otherKey: 'permission_id', as: 'permissions' });
  Permission.belongsToMany(Role, { through: 'role_permissions', foreignKey: 'permission_id', otherKey: 'role_id', as: 'roles' });
}

db.sequelize = sequelize;

module.exports = db;
