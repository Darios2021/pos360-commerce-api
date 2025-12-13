const sequelize = require('../loaders/sequelize.instance');

// Model definers (si ya tenés modelos separados, acá los requireás)
const User = require('./User')(sequelize);
const Role = require('./Role')(sequelize);
const Permission = require('./Permission')(sequelize);
const Branch = require('./Branch')(sequelize);

// Pivots
const UserRole = require('./UserRole')(sequelize);
const RolePermission = require('./RolePermission')(sequelize);
const UserBranch = require('./UserBranch')(sequelize);

// Associations (ajustá nombres según tus modelos reales)
User.belongsToMany(Role, { through: UserRole, foreignKey: 'user_id', otherKey: 'role_id' });
Role.belongsToMany(User, { through: UserRole, foreignKey: 'role_id', otherKey: 'user_id' });

Role.belongsToMany(Permission, { through: RolePermission, foreignKey: 'role_id', otherKey: 'permission_id' });
Permission.belongsToMany(Role, { through: RolePermission, foreignKey: 'permission_id', otherKey: 'role_id' });

User.belongsToMany(Branch, { through: UserBranch, foreignKey: 'user_id', otherKey: 'branch_id' });
Branch.belongsToMany(User, { through: UserBranch, foreignKey: 'branch_id', otherKey: 'user_id' });

module.exports = {
  sequelize,
  User,
  Role,
  Permission,
  Branch,
  UserRole,
  RolePermission,
  UserBranch,
};
