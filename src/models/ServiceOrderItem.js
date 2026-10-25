// src/models/ServiceOrderItem.js
//
// Renglon de una orden de servicio tecnico: el repuesto que se puso, la mano de
// obra, o cualquier cargo suelto.
//
// `product_id` en NULL significa renglon libre, igual que en budget_items: no
// todo repuesto que entra al taller esta cargado en el catalogo. Cuando si lo
// esta, `stock_moved` marca si ya se descontó del deposito, para no descontar
// dos veces al editar la orden.

module.exports = (sequelize, DataTypes) => {
  const ServiceOrderItem = sequelize.define(
    "ServiceOrderItem",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },

      order_id:   { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      product_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },

      kind: {
        type: DataTypes.ENUM("repuesto", "mano_obra", "otro"),
        allowNull: false,
        defaultValue: "repuesto",
      },

      sku:         { type: DataTypes.STRING(80), allowNull: true },
      description: { type: DataTypes.STRING(500), allowNull: false, defaultValue: "" },

      qty:        { type: DataTypes.DECIMAL(12, 3), allowNull: false, defaultValue: "1.000" },
      cost:       { type: DataTypes.DECIMAL(14, 4), allowNull: false, defaultValue: "0.0000" },
      unit_price: { type: DataTypes.DECIMAL(14, 4), allowNull: false, defaultValue: "0.0000" },
      line_total: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: "0.00" },

      stock_moved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      sort_order:  { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },

      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: "service_order_items",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [{ fields: ["order_id"] }, { fields: ["product_id"] }],
    }
  );

  return ServiceOrderItem;
};
