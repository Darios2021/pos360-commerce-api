// src/models/product.js
module.exports = (sequelize, DataTypes) => {
  const Product = sequelize.define(
    "Product",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },

      // ✅ MULTI-SUCURSAL (OBLIGATORIO EN DB)
      branch_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },

      code: DataTypes.STRING,
      sku: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      barcode: DataTypes.STRING,
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: DataTypes.TEXT,

      category_id: DataTypes.BIGINT.UNSIGNED,
      subcategory_id: DataTypes.BIGINT.UNSIGNED,

      brand: DataTypes.STRING,
      model: DataTypes.STRING,

      is_new: DataTypes.BOOLEAN,
      is_promo: DataTypes.BOOLEAN,
      is_active: DataTypes.BOOLEAN,

      // precios
      price_list: DataTypes.DECIMAL(10, 2),
      price_discount: DataTypes.DECIMAL(10, 2),
      price_reseller: DataTypes.DECIMAL(10, 2),

      // (si tenés más columnas en SQL, agregalas acá)
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
