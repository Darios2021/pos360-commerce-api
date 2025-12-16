module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "Product",
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },

      // base
      sku: { type: DataTypes.STRING(64), allowNull: false },
      barcode: { type: DataTypes.STRING(64), allowNull: true },
      name: { type: DataTypes.STRING(200), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },

      // rubro/subrubro (ambos son Category)
      category_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      subcategory_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },

      // planilla
      code: { type: DataTypes.STRING(60), allowNull: true },
      is_new: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },
      is_promo: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },

      list_price: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      cash_price: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      reseller_price: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      promo_price: { type: DataTypes.DECIMAL(12, 2), allowNull: true, defaultValue: null },

      // existentes
      brand: { type: DataTypes.STRING(120), allowNull: true },
      model: { type: DataTypes.STRING(120), allowNull: true },
      warranty_months: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },

      track_stock: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 1 },
      is_active: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 1 },

      cost: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },

      // mantenemos "price" por compatibilidad (lo podés mapear a list_price)
      price: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },

      tax_rate: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 21.0 },
    },
    {
      tableName: "products",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );
};
