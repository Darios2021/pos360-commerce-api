// src/models/UserBranch.js
module.exports = (sequelize, DataTypes) => {
  const UserBranch = sequelize.define(
    "UserBranch",
    {
      user_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
        primaryKey: true,
      },
      branch_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
        primaryKey: true,
      },
    },
    {
      tableName: "user_branches",
      timestamps: false,
      underscored: true,
    }
  );

  return UserBranch;
};
