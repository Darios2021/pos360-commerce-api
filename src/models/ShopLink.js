// ✅ COPY-PASTE FINAL COMPLETO
// src/models/ShopLink.js
module.exports = (sequelize, DataTypes) => {
  const ShopLink = sequelize.define(
    "ShopLink",
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },

      // Tipos sugeridos: INSTAGRAM_POST | INSTAGRAM_PROFILE | PROMO | OTHER
      kind: { type: DataTypes.STRING(64), allowNull: false },

      title: { type: DataTypes.STRING(255), allowNull: true },
      subtitle: { type: DataTypes.STRING(255), allowNull: true },

      url: { type: DataTypes.TEXT, allowNull: false },

      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
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
