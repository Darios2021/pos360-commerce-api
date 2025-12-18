module.exports = (sequelize, DataTypes) => {
  const Product = sequelize.define(
    "Product",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },

      // === Identificación ===
      code: { type: DataTypes.STRING(64), allowNull: true },
      sku: { type: DataTypes.STRING(64), allowNull: false },
      barcode: { type: DataTypes.STRING(64), allowNull: true },

      name: { type: DataTypes.STRING(200), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },

      // === Categoría (apunta a subrubro / hoja) ===
      category_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },

      // === Flags ===
      is_new: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },
      is_promo: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },

      // === Marca / modelo ===
      brand: { type: DataTypes.STRING(120), allowNull: true },
      model: { type: DataTypes.STRING(120), allowNull: true },
      warranty_months: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
      },

      // === Stock ===
      track_stock: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 1 },
      sheet_stock_label: { type: DataTypes.STRING(20), allowNull: true },
      sheet_has_stock: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 1 },

      is_active: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 1 },

      // === Precios ===
      cost: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      price: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 }, // compat
      price_list: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      price_discount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      price_reseller: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },

      tax_rate: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 21.0 },
    },
    {
      tableName: "products",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return Product;
};
