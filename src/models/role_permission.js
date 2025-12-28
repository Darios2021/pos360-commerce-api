// src/models/role_permission.js
module.exports = (sequelize, DataTypes) => {
  const RolePermission = sequelize.define(
    "RolePermission",
    {
      role_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
        primaryKey: true,
      },
      permission_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
        primaryKey: true,
      },
    },
    {
      tableName: "role_permissions",
      timestamps: false,
      underscored: true,
    }
  );

  return RolePermission;
};
