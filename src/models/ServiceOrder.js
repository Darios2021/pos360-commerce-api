// src/models/ServiceOrder.js
//
// Orden de servicio tecnico. Reemplaza el libro SERV_TEC.xlsm que se llevaba a
// mano en el mostrador de San Juan Tecnologia.
//
// Sigue la forma del presupuestador: los datos del cliente van duplicados
// (customer_* ademas del FK) porque la orden es un comprobante que se le
// entrega al cliente y no debe cambiar si despues se edita la ficha.
//
// Dos series de numeracion conviven a proposito:
//   - `number`: la serie del sistema, arranca en 1 y es unica.
//   - `legacy_number`: el numero del papel del Excel (644 al 1287). No es unico
//     (hay dos repetidos en el libro) y las ordenes migradas entran con
//     `number` en NULL, asi las dos series nunca chocan.
//
// La tabla se crea con CREATE TABLE IF NOT EXISTS en migrations/runner.js.

module.exports = (sequelize, DataTypes) => {
  const ServiceOrder = sequelize.define(
    "ServiceOrder",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },

      number:        { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      legacy_number: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },

      branch_id:   { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      user_id:     { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      received_by: { type: DataTypes.STRING(180), allowNull: true },

      // Cliente: FK opcional + snapshot congelado
      customer_id:      { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      customer_name:    { type: DataTypes.STRING(180), allowNull: false, defaultValue: "Consumidor Final" },
      customer_phone:   { type: DataTypes.STRING(60),  allowNull: true },
      customer_email:   { type: DataTypes.STRING(180), allowNull: true },
      customer_address: { type: DataTypes.STRING(255), allowNull: true },
      customer_doc:     { type: DataTypes.STRING(40),  allowNull: true },

      // Equipo que se recibe
      device_brand:       { type: DataTypes.STRING(80),  allowNull: true },
      device_model:       { type: DataTypes.STRING(160), allowNull: true },
      device_imei:        { type: DataTypes.STRING(40),  allowNull: true },
      device_serial:      { type: DataTypes.STRING(60),  allowNull: true },
      // El PIN o patron que deja el cliente: sin esto el tecnico no puede
      // probar que la reparacion funciono.
      device_unlock:      { type: DataTypes.STRING(60),  allowNull: true },
      device_accessories: { type: DataTypes.STRING(255), allowNull: true },

      intake_condition: { type: DataTypes.STRING(180), allowNull: true },
      reported_fault:   { type: DataTypes.TEXT, allowNull: true },
      technical_report: { type: DataTypes.TEXT, allowNull: true },
      suggestions:      { type: DataTypes.TEXT, allowNull: true },

      technician_id:   { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      technician_name: { type: DataTypes.STRING(180), allowNull: true },

      status: {
        type: DataTypes.ENUM(
          "recibido",
          "diagnostico",
          "presupuestado",
          "aprobado",
          "en_reparacion",
          "reparado",
          "entregado",
          "sin_solucion",
          "no_retirado"
        ),
        allowNull: false,
        defaultValue: "recibido",
      },

      quoted_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: "0.00" },
      deposit:       { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: "0.00" },
      balance:       { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: "0.00" },
      parts_cost:    { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: "0.00" },
      total_charged: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: "0.00" },

      // El reparto del Excel: una parte al tecnico, una al vendedor que lo
      // recibio y el resto al local.
      commission_technician: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: "0.00" },
      commission_seller:     { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: "0.00" },
      commission_shop:       { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: "0.00" },

      estimated_pickup: { type: DataTypes.DATEONLY, allowNull: true },
      delivered_at:     { type: DataTypes.DATE, allowNull: true },
      delivered_by:     { type: DataTypes.STRING(180), allowNull: true },
      paid_at:          { type: DataTypes.DATE, allowNull: true },

      // Venta del POS generada al entregar: la plata entra por caja.
      sale_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },

      source: {
        type: DataTypes.ENUM("app", "import"),
        allowNull: false,
        defaultValue: "app",
      },

      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: "service_orders",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        { fields: ["legacy_number"] },
        { fields: ["customer_id"] },
        { fields: ["status"] },
        { fields: ["created_at"] },
      ],
    }
  );

  return ServiceOrder;
};
