// src/models/ProductImage.js
module.exports = (sequelize, DataTypes) => {
  const ProductImage = sequelize.define(
    "ProductImage",
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      product_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      url: { type: DataTypes.STRING(1024), allowNull: false },
      sort_order: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    },
    {
      tableName: "product_images",
      underscored: true,
      timestamps: true,
    }
  );

  ProductImage.associate = (models) => {
    ProductImage.belongsTo(models.Product, { foreignKey: "product_id", as: "product" });
  };

  return ProductImage;
};
