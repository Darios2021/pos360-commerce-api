// src/models/ServiceRepairPrice.js
//
// Lista de precios de reparacion por modelo (hoja MODULOS del SERV_TEC.xlsm).
//
// Es tabla propia y no un producto del catalogo porque guarda el desglose que
// el catalogo no tiene: cuanto del precio va al repuesto, cuanto al tecnico,
// cuanto al vendedor y cuanto queda para el local. De ese desglose salen las
// comisiones que despues se cargan en la orden.
//
// `product_id` es el puente al catalogo: las reparaciones mas vendidas se
// espejan como producto de tipo servicio para poder cobrarlas rapido por el
// POS, pero la fuente de verdad del precio sigue siendo esta tabla.

module.exports = (sequelize, DataTypes) => {
  const ServiceRepairPrice = sequelize.define(
    "ServiceRepairPrice",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },

      model: { type: DataTypes.STRING(180), allowNull: false },

      // El Excel tiene una hoja por tipo de arreglo (MODULOS) y otra con
      // modulo/pin/bateria por marca (PrecioST). Se unifican con esta columna.
      repair_type: {
        type: DataTypes.STRING(60),
        allowNull: false,
        defaultValue: "modulo",
      },

      parts_cost:        { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: "0.00" },
      technician_cost:   { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: "0.00" },
      shop_margin:       { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: "0.00" },
      seller_commission: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: "0.00" },
      total_price:       { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: "0.00" },

      // Financiacion fija que ya usaba el local: 1.43 a 3 y 1.62 a 6.
      installment_3: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: "0.00" },
      installment_6: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: "0.00" },

      product_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      is_active:  { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: "service_repair_prices",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        { unique: true, fields: ["model", "repair_type"] },
        { fields: ["is_active"] },
      ],
    }
  );

  return ServiceRepairPrice;
};
