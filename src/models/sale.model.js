const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Sale = sequelize.define("Sale", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  branch_id: { type: DataTypes.INTEGER, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  sale_number: { type: DataTypes.STRING, unique: true },
  status: { type: DataTypes.ENUM("PENDING", "PAID", "CANCELLED"), defaultValue: "PAID" },
  customer_name: { type: DataTypes.STRING },
  customer_doc: { type: DataTypes.STRING },
  subtotal: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
  discount_total: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
  tax_total: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
  total: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
  paid_total: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
  change_total: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
  sold_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, { 
  tableName: 'sales', 
  timestamps: true,
  underscored: true 
});

module.exports = Sale;