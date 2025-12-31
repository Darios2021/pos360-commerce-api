// src/models/Subcategory.js
// ✅ COPY-PASTE FINAL (100% alineado a tu BD real en Adminer)
// BD subcategories:
// - id BIGINT UNSIGNED AI PK
// - category_id BIGINT UNSIGNED NULL FK -> categories(id) ON DELETE SET NULL
// - name VARCHAR(120) NOT NULL
// - is_active TINYINT(1) NOT NULL DEFAULT 1
// - created_at / updated_at TIMESTAMP

"use strict";

module.exports = (sequelize, DataTypes) => {
  const Subcategory = sequelize.define(
    "Subcategory",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },

      category_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true, // ✅ en BD permite NULL
      },

      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },

      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true, // ✅ default 1
      },
    },
    {
      tableName: "subcategories",
      underscored: true,

      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  Subcategory.associate = (models) => {
    Subcategory.belongsTo(models.Category, {
      as: "category",
      foreignKey: "category_id",
    });

    Subcategory.hasMany(models.Product, {
      as: "products",
      foreignKey: "subcategory_id",
    });
  };

  return Subcategory;
};
