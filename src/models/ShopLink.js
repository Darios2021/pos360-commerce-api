// ✅ COPY-PASTE FINAL COMPLETO
// src/models/ShopLink.js

module.exports = (sequelize, DataTypes) => {
  const ShopLink = sequelize.define(
    "ShopLink",
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },

      kind: { type: DataTypes.STRING(32), allowNull: false },
      label: { type: DataTypes.STRING(128), allowNull: true },

      url: { type: DataTypes.STRING(512), allowNull: false },

      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    },
    {
      tableName: "shop_links",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true,
    }
  );

  return ShopLink;
};
