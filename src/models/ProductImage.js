// src/models/ProductImage.js
module.exports = (sequelize, DataTypes) => {
  const ProductImage = sequelize.define(
    "ProductImage",
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      product_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      url: { type: DataTypes.TEXT, allowNull: false },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: DataTypes.DATE, allowNull: true },
      updated_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "product_images",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true,
    }
  );

  return ProductImage;
};
