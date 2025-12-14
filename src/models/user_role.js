// src/models/user_role.js
module.exports = (sequelize, DataTypes) => {
  const UserRole = sequelize.define(
    "UserRole",
    {
      user_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
        primaryKey: true,
      },
      role_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
        primaryKey: true,
      },
    },
    {
      tableName: "user_roles",
      timestamps: false,     // ✅ NO createdAt/updatedAt en la pivote
      underscored: true,
    }
  );

  return UserRole;
};
