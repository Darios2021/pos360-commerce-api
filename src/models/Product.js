// src/models/Product.js
// ✅ COPY-PASTE FINAL (DB MATCH + asociaciones CORRECTAS)
// - products.created_at / updated_at
// - category_id -> categories.id
// - subcategory_id -> subcategories.id  ✅ CLAVE
// - created_by -> users.id

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

      created_by: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },

      code: { type: DataTypes.STRING(64), allowNull: true },

      sku: { type: DataTypes.STRING(64), allowNull: false },

      barcode: { type: DataTypes.STRING(64), allowNull: true },

      name: { type: DataTypes.STRING(200), allowNull: false },

      description: { type: DataTypes.TEXT, allowNull: true },

      category_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },

      // ✅ FK REAL en tu DB: products.subcategory_id -> subcategories.id
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

      cost: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: "0.00" },
      price: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: "0.00" },

      price_list: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: "0.00" },
      price_discount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: "0.00" },
      price_reseller: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: "0.00" },

      tax_rate: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: "21.00" },
    },
    {
      tableName: "products",
      underscored: true,

      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",

      paranoid: false,
    }
  );

  // ✅ CLAVE: asociaciones
  Product.associate = (models) => {
    // category_id -> categories.id
    if (models.Category) {
      Product.belongsTo(models.Category, {
        foreignKey: "category_id",
        as: "category",
      });
    }

    // ✅ subcategory_id -> subcategories.id (NO categories)
    if (models.Subcategory) {
      Product.belongsTo(models.Subcategory, {
        foreignKey: "subcategory_id",
        as: "subcategory",
      });
    }

    // branch_id -> branches.id (opcional)
    if (models.Branch) {
      Product.belongsTo(models.Branch, {
        foreignKey: "branch_id",
        as: "branch",
      });
    }

    // created_by -> users.id (opcional)
    if (models.User) {
      Product.belongsTo(models.User, {
        foreignKey: "created_by",
        as: "createdByUser",
      });
    }

    // images (si existe el modelo)
    if (models.ProductImage) {
      Product.hasMany(models.ProductImage, {
        foreignKey: "product_id",
        as: "images",
      });
    }
  };

  return Product;
};
