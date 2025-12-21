// src/modules/pos/pos.models.js
const { DataTypes } = require("sequelize");

// IMPORTANTE: este path asume que tu instancia sequelize vive acá.
// En tu repo se ve: src/loaders/sequelize.instance.js
// Si el export no coincide, decime qué exporta y lo ajusto.
const sequelize = require("../../loaders/sequelize.instance");

let inited = false;

let Sale;
let SaleItem;
let Payment;
let CashRegister;
let CashMovement;

function initPosModels() {
  if (inited) {
    return { sequelize, Sale, SaleItem, Payment, CashRegister, CashMovement };
  }

  // ----------------------
  // CASH REGISTERS
  // ----------------------
  CashRegister = sequelize.define(
    "CashRegister",
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },

      branch_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      opened_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      closed_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },

      status: { type: DataTypes.ENUM("OPEN", "CLOSED"), allowNull: false, defaultValue: "OPEN" },

      opening_cash: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      opening_note: { type: DataTypes.STRING(255), allowNull: true },
      opened_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },

      closing_cash: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      closing_note: { type: DataTypes.STRING(255), allowNull: true },
      closed_at: { type: DataTypes.DATE, allowNull: true },

      expected_cash: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      difference_cash: { type: DataTypes.DECIMAL(12, 2), allowNull: true },

      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: "cash_registers",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true,
    }
  );

  // ----------------------
  // CASH MOVEMENTS
  // ----------------------
  CashMovement = sequelize.define(
    "CashMovement",
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },

      cash_register_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },

      type: { type: DataTypes.ENUM("IN", "OUT"), allowNull: false },
      reason: { type: DataTypes.STRING(120), allowNull: false },
      note: { type: DataTypes.STRING(255), allowNull: true },
      amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },

      happened_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },

      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: "cash_movements",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true,
    }
  );

  // ----------------------
  // SALES
  // ----------------------
  Sale = sequelize.define(
    "Sale",
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },

      branch_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      cash_register_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },

      status: {
        type: DataTypes.ENUM("DRAFT", "PAID", "CANCELLED", "REFUNDED"),
        allowNull: false,
        defaultValue: "PAID",
      },

      sale_number: { type: DataTypes.STRING(32), allowNull: true, unique: true },

      customer_name: { type: DataTypes.STRING(160), allowNull: true },
      customer_doc: { type: DataTypes.STRING(40), allowNull: true },
      customer_phone: { type: DataTypes.STRING(40), allowNull: true },

      subtotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      discount_total: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      tax_total: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      total: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },

      paid_total: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      change_total: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },

      note: { type: DataTypes.STRING(255), allowNull: true },
      sold_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },

      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: "sales",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true,
    }
  );

  // ----------------------
  // SALE ITEMS
  // ----------------------
  SaleItem = sequelize.define(
    "SaleItem",
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },

      sale_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      product_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      warehouse_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },

      quantity: { type: DataTypes.DECIMAL(12, 3), allowNull: false, defaultValue: 1 },
      unit_price: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },

      discount_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      tax_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },

      line_total: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },

      product_name_snapshot: { type: DataTypes.STRING(200), allowNull: true },
      product_sku_snapshot: { type: DataTypes.STRING(64), allowNull: true },
      product_barcode_snapshot: { type: DataTypes.STRING(64), allowNull: true },

      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: "sale_items",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true,
    }
  );

  // ----------------------
  // PAYMENTS
  // ----------------------
  Payment = sequelize.define(
    "Payment",
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },

      sale_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },

      method: { type: DataTypes.ENUM("CASH", "TRANSFER", "CARD", "QR", "OTHER"), allowNull: false },
      amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },

      reference: { type: DataTypes.STRING(120), allowNull: true },
      note: { type: DataTypes.STRING(255), allowNull: true },

      paid_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },

      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: "payments",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true,
    }
  );

  // Associations internas POS
  Sale.hasMany(SaleItem, { foreignKey: "sale_id", as: "items" });
  SaleItem.belongsTo(Sale, { foreignKey: "sale_id", as: "sale" });

  Sale.hasMany(Payment, { foreignKey: "sale_id", as: "payments" });
  Payment.belongsTo(Sale, { foreignKey: "sale_id", as: "sale" });

  CashRegister.hasMany(CashMovement, { foreignKey: "cash_register_id", as: "movements" });
  CashMovement.belongsTo(CashRegister, { foreignKey: "cash_register_id", as: "cashRegister" });

  inited = true;

  return { sequelize, Sale, SaleItem, Payment, CashRegister, CashMovement };
}

module.exports = { initPosModels };
