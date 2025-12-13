const { sequelize } = require('../loaders/sequelize.instance');

const User = require('./User')(sequelize);
const Role = require('./Role')(sequelize);
const UserRole = require('./UserRole')(sequelize);

// asociaciones para user.getRoles()
User.belongsToMany(Role, {
  through: UserRole,
  foreignKey: 'user_id',
  otherKey: 'role_id',
});

Role.belongsToMany(User, {
  through: UserRole,
  foreignKey: 'role_id',
  otherKey: 'user_id',
});

module.exports = {
  sequelize,
  User,
  Role,
  UserRole,
};
