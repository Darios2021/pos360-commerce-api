module.exports = (sequelize, DataTypes) => {
  const SaleItem = sequelize.define(
    "SaleItem",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      sale_id: { type: DataTypes.INTEGER, allowNull: false },
      product_id: { type: DataTypes.INTEGER, allowNull: false },

      // ✅ CLAVE
      warehouse_id: { type: DataTypes.INTEGER, allowNull: false },

      quantity: { type: DataTypes.DECIMAL(12, 3), allowNull: false },
      unit_price: { type: DataTypes.DECIMAL(12, 2), allowNull: false },

      // CORRECCIÓN: en tu DB es 'line_total'
      line_total: { type: DataTypes.DECIMAL(12, 2), allowNull: false },

      product_name_snapshot: { type: DataTypes.STRING },
      product_sku_snapshot: { type: DataTypes.STRING },
      product_barcode_snapshot: { type: DataTypes.STRING },
    },
    {
      tableName: "sale_items",
      underscored: true,
      timestamps: true,
      paranoid: false,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return SaleItem;
};