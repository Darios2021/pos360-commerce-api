// src/models/ProductVideo.js
module.exports = (sequelize, DataTypes) => {
  const ProductVideo = sequelize.define(
    "ProductVideo",
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      product_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },

      provider: { type: DataTypes.ENUM("youtube", "minio", "other"), allowNull: false, defaultValue: "youtube" },
      title: { type: DataTypes.STRING(255), allowNull: true },

      url: { type: DataTypes.STRING(2048), allowNull: true },
      storage_bucket: { type: DataTypes.STRING(128), allowNull: true },
      storage_key: { type: DataTypes.STRING(512), allowNull: true },

      mime: { type: DataTypes.STRING(128), allowNull: true },
      size_bytes: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },

      sort_order: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      tableName: "product_videos",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  ProductVideo.associate = (models) => {
    ProductVideo.belongsTo(models.Product, { foreignKey: "product_id", as: "product" });
  };

  return ProductVideo;
};
