module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "StockMovement",
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      type: { type: DataTypes.ENUM("in", "out", "adjustment", "transfer"), allowNull: false },

      warehouse_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      from_warehouse_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      to_warehouse_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },

      ref_type: { type: DataTypes.STRING(50), allowNull: true },
      ref_id: { type: DataTypes.STRING(80), allowNull: true },
      note: { type: DataTypes.STRING(255), allowNull: true },

      created_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    },
    {
      tableName: "stock_movements",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: false,
    }
  );
};
