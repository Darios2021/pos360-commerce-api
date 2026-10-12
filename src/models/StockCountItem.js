// src/models/StockCountItem.js
// Renglón de un conteo: un producto por conteo (UNIQUE count_id, product_id).
module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "StockCountItem",
    {
      id:          { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      count_id:    { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      product_id:  { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      counted_qty: { type: DataTypes.DECIMAL(14, 3), allowNull: false, defaultValue: 0 },
      system_qty:  { type: DataTypes.DECIMAL(14, 3), allowNull: true },
      diff_qty:    { type: DataTypes.DECIMAL(14, 3), allowNull: true },
      updated_by:  { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    },
    {
      tableName:  "stock_count_items",
      timestamps: true,
      createdAt:  "created_at",
      updatedAt:  "updated_at",
    }
  );
};
