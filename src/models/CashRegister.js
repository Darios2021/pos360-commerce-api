// src/models/CashRegister.js
module.exports = (sequelize, DataTypes) => {
  const CashRegister = sequelize.define(
    "CashRegister",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },

      branch_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },

      opened_by: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },

      closed_by: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },

      status: {
        type: DataTypes.ENUM("OPEN", "CLOSED"),
        allowNull: false,
        defaultValue: "OPEN",
      },

      opening_cash: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      opening_note: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },

      opened_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },

      closing_cash: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
      },

      closing_note: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },

      closed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      expected_cash: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
      },

      difference_cash: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
      },

      // ✅ columnas nuevas que agregaste por ALTER TABLE
      caja_type: {
        type: DataTypes.ENUM("GENERAL", "SHIFT", "BRANCH", "MOBILE"),
        allowNull: true,
      },

      invoice_mode: {
        type: DataTypes.ENUM("NO_FISCAL", "FISCAL", "MIXED", "TICKET_ONLY"),
        allowNull: true,
      },

      invoice_type: {
        type: DataTypes.ENUM("TICKET", "A", "B", "C", "NC"),
        allowNull: true,
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
      tableName: "cash_registers",
      freezeTableName: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return CashRegister;
};