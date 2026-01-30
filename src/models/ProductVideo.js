// src/models/ProductVideo.js
// ✅ COPY-PASTE FINAL
// Tabla: product_videos
// Campos según tu DB:
// id, product_id, provider, title, url, storage_bucket, storage_key, mime,
// size_bytes, sort_order, is_active, created_at, updated_at

module.exports = (sequelize, DataTypes) => {
  const ProductVideo = sequelize.define(
    "ProductVideo",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },

      product_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },

      provider: {
        type: DataTypes.ENUM("youtube", "minio", "other"),
        allowNull: false,
        defaultValue: "youtube",
      },

      title: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },

      url: {
        type: DataTypes.STRING(2048),
        allowNull: true,
      },

      storage_bucket: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },

      storage_key: {
        type: DataTypes.STRING(512),
        allowNull: true,
      },

      mime: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },

      size_bytes: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },

      sort_order: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
      },

      is_active: {
        type: DataTypes.TINYINT(1),
        allowNull: false,
        defaultValue: 1,
      },

      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },

      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "product_videos",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true,
    }
  );

  return ProductVideo;
};
