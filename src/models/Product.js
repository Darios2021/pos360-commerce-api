// src/models/Product.js
// ✅ COPY-PASTE FINAL (agrega created_by al modelo)

module.exports = (sequelize, DataTypes) => {
  const Product = sequelize.define(
    "Product",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },

      branch_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },

      // ✅ NUEVO: creador (FK users.id)
      created_by: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },

      code: { type: DataTypes.STRING(64), allowNull: true },

      sku: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },

      barcode: { type: DataTypes.STRING(64), allowNull: true },

      name: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },

      description: { type: DataTypes.TEXT, allowNull: true },

      category_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      subcategory_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },

      is_new: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      is_promo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

      brand: { type: DataTypes.STRING(120), allowNull: true },
      model: { type: DataTypes.STRING(120), allowNull: true },

      warranty_months: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },

      track_stock: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

      sheet_stock_label: { type: DataTypes.STRING(20), allowNull: true },
      sheet_has_stock: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

      cost: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      price: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },

      price_list: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      price_discount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      price_reseller: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },

      tax_rate: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 21 },
    },
    {
      tableName: "products",
      underscored: true,
      timestamps: true,
      paranoid: false,
    }
  );

  return Product;
};
