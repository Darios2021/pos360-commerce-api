// src/models/EmailPromoBlock.js
//
// Bloque promocional reutilizable estilo "casa grande" (Oncity / Frávega /
// MercadoLibre). Cada bloque representa UN producto destacado que el admin
// arma una vez y reutiliza en N envíos. El template/email no almacena el
// detalle del producto, sino la lista de IDs de bloques que adjunta.
//
// Diseño visual del bloque renderizado (ver emailLayout.service.js):
//
//   ┌──────────────────────────┐
//   │ [BADGE -30% OFF]         │ ← badge_text (esquina sup-izq)
//   │  [imagen producto]       │ ← image_url
//   │                          │
//   │  Notebook Lenovo IdeaPad │ ← title
//   │  Procesador Ryzen 5...   │ ← subtitle (opcional, una línea)
//   │  ~~$1.500.000~~          │ ← price_original (tachado)
//   │  $999.000                │ ← price_final
//   │  12 cuotas sin interés   │ ← installments_text
//   │  [▶ COMPRAR AHORA]       │ ← cta_label → product_url
//   └──────────────────────────┘
//
// Campos opcionales: si no se carga price_original, no se renderiza tachado.
// Si no se carga badge_text, no aparece el badge. Si no hay installments_text,
// se omite la línea de cuotas.

module.exports = (sequelize, DataTypes) => {
  const EmailPromoBlock = sequelize.define(
    "EmailPromoBlock",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },

      // Nombre interno del bloque (lo ve sólo el admin en el listado).
      name: { type: DataTypes.STRING(120), allowNull: false },

      // Datos visuales del producto.
      title:    { type: DataTypes.STRING(180), allowNull: false },
      subtitle: { type: DataTypes.STRING(255), allowNull: true },

      image_url:   { type: DataTypes.STRING(512), allowNull: true },
      product_url: { type: DataTypes.STRING(512), allowNull: false },

      // Precios como strings ya formateados ("$ 999.000") para flexibilidad
      // (admite ARS, USD, "Consultar precio", etc.) sin lockear el modelo a
      // decimal/locale específico.
      price_original: { type: DataTypes.STRING(60), allowNull: true },
      price_final:    { type: DataTypes.STRING(60), allowNull: true },

      // Texto de financiación libre ("12 cuotas sin interés", "3 cuotas
      // 30% OFF", etc.).
      installments_text: { type: DataTypes.STRING(120), allowNull: true },

      // Badge superior izquierdo (texto corto: "-30%", "HOT SALE", "NUEVO").
      badge_text:  { type: DataTypes.STRING(40), allowNull: true },
      badge_color: { type: DataTypes.STRING(20), allowNull: true }, // hex, ej "#e53935"

      // Texto del botón. Default "Comprar ahora".
      cta_label: { type: DataTypes.STRING(60), allowNull: true },
      cta_color: { type: DataTypes.STRING(20), allowNull: true }, // hex

      // Referencia opcional al producto interno (para auto-completar
      // imagen/precio desde el catálogo del shop).
      product_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },

      // Listado / activación.
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
