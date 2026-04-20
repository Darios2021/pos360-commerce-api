// src/models/StockTransferItem.js
module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "StockTransferItem",
    {
      id:           { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      transfer_id:  { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      product_id:   { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      qty_sent:     { type: DataTypes.DECIMAL(14, 3), allowNull: false, defaultValue: 0 },
      qty_received: { type: DataTypes.DECIMAL(14, 3), allowNull: true },
      unit_cost:    { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      note:         { type: DataTypes.STRING(255), allowNull: true },
    },
    {
      tableName:  "stock_transfer_items",
      timestamps: false,
    }
  );
};
