const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const SaleItem = sequelize.define("SaleItem", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  sale_id: { type: DataTypes.INTEGER, allowNull: false },
  product_id: { type: DataTypes.INTEGER, allowNull: false },
  warehouse_id: { type: DataTypes.INTEGER, allowNull: false },
  quantity: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  unit_price: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
  line_total: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
  // Snapshots
  product_name_snapshot: { type: DataTypes.STRING },
  product_sku_snapshot: { type: DataTypes.STRING }
}, { 
  tableName: 'sale_items', 
  timestamps: false,
  underscored: true 
});

module.exports = SaleItem;