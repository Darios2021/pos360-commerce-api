module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "StockBalance",
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      warehouse_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      product_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      qty: { type: DataTypes.DECIMAL(14, 3), allowNull: false, defaultValue: 0 },
    },
    {
      tableName: "stock_balances",
      timestamps: true,
      createdAt: false,
      updatedAt: "updated_at",
    }
  );
};
