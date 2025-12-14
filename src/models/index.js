// src/models/index.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// 🔥 Linux es case-sensitive: respetar el nombre real del archivo
const User = require("./User")(sequelize, DataTypes);
const Role = require("./Role")(sequelize, DataTypes);
const Permission = require("./permission")(sequelize, DataTypes); // este sí existe en minúscula

// ✅ pivotes (estos existen en minúscula)
const UserRole = require("./user_role")(sequelize, DataTypes);

let RolePermission = null;
try {
  RolePermission = require("./role_permission")(sequelize, DataTypes);
} catch (_) {}

// =====================
// Associations
// =====================

User.belongsToMany(Role, {
  through: { model: UserRole, timestamps: false },
  foreignKey: "user_id",
  otherKey: "role_id",
  as: "roles",
});

Role.belongsToMany(User, {
  through: { model: UserRole, timestamps: false },
  foreignKey: "role_id",
  otherKey: "user_id",
  as: "users",
});

if (RolePermission) {
  Role.belongsToMany(Permission, {
    through: { model: RolePermission, timestamps: false },
    foreignKey: "role_id",
    otherKey: "permission_id",
    as: "permissions",
  });

  Permission.belongsToMany(Role, {
    through: { model: RolePermission, timestamps: false },
    foreignKey: "permission_id",
    otherKey: "role_id",
    as: "roles",
  });
}

module.exports = {
  sequelize,
  User,
  Role,
  Permission,
  UserRole,
  RolePermission,
};
