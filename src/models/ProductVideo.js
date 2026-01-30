// src/models/ProductVideo.js
// ✅ COPY-PASTE FINAL
// Tabla: product_videos
// Guarda videos por producto: youtube (url embed) o upload (S3 key + bucket)

module.exports = (sequelize, DataTypes) => {
  const ProductVideo = sequelize.define(
    "ProductVideo",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },

      product_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },

      provider: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "youtube", // youtube | s3 | minio
      },

      title: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },

      // Para YouTube (embed url)
      url: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      // Para uploads (S3/MinIO)
      storage_bucket: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      storage_key: {
        type: DataTypes.STRING(1024),
        allowNull: true,
      },

      mime: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },

      size_bytes: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },

      sort_order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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
      freezeTableName: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        { fields: ["product_id"] },
        { fields: ["is_active"] },
        { fields: ["product_id", "is_active"] },
      ],
    }
  );

  return ProductVideo;
};
