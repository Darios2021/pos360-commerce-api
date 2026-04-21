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

      opening_ip: {
        type: DataTypes.STRING(45),
        allowNull: true,
      },

      // JSON con montos declarados por medio de pago al hacer el arqueo
      closing_declared: {
        type: DataTypes.TEXT,
        allowNull: true,
        get() {
          const raw = this.getDataValue("closing_declared");
          if (!raw) return null;
          try { return JSON.parse(raw); } catch { return null; }
        },
        set(val) {
          this.setDataValue(
            "closing_declared",
            val == null ? null : JSON.stringify(val)
          );
        },
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