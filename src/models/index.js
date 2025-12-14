// src/models/index.js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

const User = require("./user")(sequelize, DataTypes);
const Role = require("./role")(sequelize, DataTypes);
const Permission = require("./permission")(sequelize, DataTypes);

// ✅ pivotes
const UserRole = require("./user_role")(sequelize, DataTypes);

// Si ya tenés role_permissions como tabla pivote, podés crear su modelo similar.
// Si NO la necesitás, podés borrar esto.
let RolePermission = null;
try {
  RolePermission = require("./role_permission")(sequelize, DataTypes);
} catch (_) {
  // si no existe el archivo, no pasa nada
}

// =====================
// Associations
// =====================

// ✅ User <-> Role con pivote SIN timestamps
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

// ✅ Role <-> Permission (si aplica)
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
  Sequelize: sequelize.Sequelize,
  User,
  Role,
  Permission,
  UserRole,
  RolePermission,
};
