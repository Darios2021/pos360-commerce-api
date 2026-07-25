// src/models/BudgetItem.js
//
// Renglón de presupuesto.
//
// product_id NULL = renglón libre de texto (para poner mano de obra, envío,
// o cualquier cosa que no esté en el catálogo).
//
// Todo lo del producto (sku, descripción, imagen, costo) se congela al
// agregarlo: si mañana cambia el precio de lista, el presupuesto ya emitido
// sigue diciendo lo mismo que se le mostró al cliente.
//
// Fórmula: unit_price = cost * (1 + margin_pct/100)   [sin IVA]
//          line_total = unit_price * qty              [sin IVA]

module.exports = (sequelize, DataTypes) => {
  const BudgetItem = sequelize.define(
    "BudgetItem",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },

      budget_id:  { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      product_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },

      // Snapshot del producto
      sku:         { type: DataTypes.STRING(80),  allowNull: true },
      description: { type: DataTypes.STRING(500), allowNull: false, defaultValue: "" },
      image_url:   { type: DataTypes.STRING(500), allowNull: true },
      // Especificaciones tecnicas para el apartado del documento. Se precargan
      // desde la ficha del producto y quedan congeladas.
      specs:       { type: DataTypes.TEXT, allowNull: true },
      // Lista de precios usada como base: sale | list | reseller | cost.
      price_source: { type: DataTypes.STRING(20), allowNull: true },

      qty:        { type: DataTypes.DECIMAL(12, 3), allowNull: false, defaultValue: "1.000" },
      cost:       { type: DataTypes.DECIMAL(14, 4), allowNull: false, defaultValue: "0.0000" },
      margin_pct: { type: DataTypes.DECIMAL(7, 2),  allowNull: false, defaultValue: "0.00" },
      vat_rate:   { type: DataTypes.DECIMAL(5, 2),  allowNull: false, defaultValue: "21.00" },

      // Calculados en el backend (el front los muestra pero no manda autoridad)
      unit_price: { type: DataTypes.DECIMAL(14, 4), allowNull: false, defaultValue: "0.0000" },
      line_total: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: "0.00" },

      sort_order: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    },
    {
      tableName: "budget_items",
      underscored: true,
      timestamps: true,
      paranoid: false,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [{ fields: ["budget_id"] }, { fields: ["product_id"] }],
    }
  );

  return BudgetItem;
};
