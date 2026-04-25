// src/models/EmailPromoBlock.js
//
// Bloque promocional reutilizable. Filosofía: el bloque referencia un PRODUCTO
// del catálogo del shop (`product_id`). Al renderizar el email, el sistema
// hidrata título / imagen / precio / URL desde la tabla `products` (live), de
// forma que un cambio de precio se refleja automáticamente en el próximo envío.
//
// Los campos `override_*` son OPCIONALES: si están seteados, pisan los datos
// del producto en el render. Sirven para casos puntuales (ej: el nombre del
// producto es muy largo para un email y querés acortarlo).
//
// Los campos `name` (interno), `badge_text`, `installments_text`, `cta_label`,
// `cta_color`, `badge_color` son del bloque mismo (no derivados del producto).

module.exports = (sequelize, DataTypes) => {
  const EmailPromoBlock = sequelize.define(
    "EmailPromoBlock",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },

      // Nombre interno (lo ve sólo el admin). Se autogenera del producto al crear.
      name: { type: DataTypes.STRING(120), allowNull: false },

      // ─── Producto del catálogo (preferido) ───
      product_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },

      // ─── Overrides opcionales (pisan al producto) ───
      override_title:          { type: DataTypes.STRING(180), allowNull: true },
      override_subtitle:       { type: DataTypes.STRING(255), allowNull: true },
      override_image_url:      { type: DataTypes.STRING(512), allowNull: true },
      override_product_url:    { type: DataTypes.STRING(512), allowNull: true },
      override_price_original: { type: DataTypes.STRING(60),  allowNull: true },
      override_price_final:    { type: DataTypes.STRING(60),  allowNull: true },

      // ─── Campos legacy (bloque manual sin producto). Mantenidos para
      // compatibilidad con bloques creados antes del refactor. Si product_id
      // está seteado, se ignoran al render salvo que sean override_*. ───
      title:          { type: DataTypes.STRING(180), allowNull: true },
      subtitle:       { type: DataTypes.STRING(255), allowNull: true },
      image_url:      { type: DataTypes.STRING(512), allowNull: true },
      product_url:    { type: DataTypes.STRING(512), allowNull: true },
      price_original: { type: DataTypes.STRING(60),  allowNull: true },
      price_final:    { type: DataTypes.STRING(60),  allowNull: true },

      // ─── Datos propios del bloque (no derivados del producto) ───
      installments_text: { type: DataTypes.STRING(120), allowNull: true },
      badge_text:        { type: DataTypes.STRING(40),  allowNull: true },
      badge_color:       { type: DataTypes.STRING(20),  allowNull: true },
      cta_label:         { type: DataTypes.STRING(60),  allowNull: true },
      cta_color:         { type: DataTypes.STRING(20),  allowNull: true },

      active:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: "email_promo_blocks",
      underscored: true,
      timestamps: true,
      paranoid: false,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        { fields: ["active"] },
        { fields: ["position"] },
        { fields: ["product_id"] },
      ],
    }
  );

  return EmailPromoBlock;
};
