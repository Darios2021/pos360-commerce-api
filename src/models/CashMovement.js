// src/models/CashMovement.js
module.exports = (sequelize, DataTypes) => {
  const CashMovement = sequelize.define(
    "CashMovement",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },

      cash_register_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },

      user_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },

      type: {
        type: DataTypes.ENUM("IN", "OUT"),
        allowNull: false,
      },

      reason: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },

      note: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },

      amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      happened_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },

      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },

      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "cash_movements",
      freezeTableName: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return CashMovement;
};