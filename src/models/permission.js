// src/models/permission.js
module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "Permission",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },

      // En tu DB se llama "code" (NO "name")
      code: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },

      description: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },

      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      tableName: "permissions",
      timestamps: false, // porque solo tenés created_at
    }
  );
};
