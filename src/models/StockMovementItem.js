module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "StockMovementItem",
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      movement_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      product_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      qty: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
      unit_cost: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    },
    {
      tableName: "stock_movement_items",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: false,
    }
  );
};
