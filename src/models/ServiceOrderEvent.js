// src/models/ServiceOrderEvent.js
//
// Seguimiento de una orden de servicio tecnico: un renglon por ingreso, cambio
// de estado, derivacion a un tecnico, nota interna o aviso al cliente.
//
// Los nombres (tecnico, usuario) van congelados como en la orden: el historial
// tiene que decir lo mismo aunque despues se renombre o se borre el usuario.
//
// La tabla se crea con CREATE TABLE IF NOT EXISTS en migrations/runner.js.

module.exports = (sequelize, DataTypes) => {
  const ServiceOrderEvent = sequelize.define(
    "ServiceOrderEvent",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },

      order_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },

      kind: {
        type: DataTypes.ENUM("ingreso", "estado", "tecnico", "nota", "aviso"),
        allowNull: false,
      },

      from_status: { type: DataTypes.STRING(30), allowNull: true },
      to_status:   { type: DataTypes.STRING(30), allowNull: true },

      technician_id:   { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      technician_name: { type: DataTypes.STRING(180), allowNull: true },

      channel: { type: DataTypes.STRING(20), allowNull: true },
      note:    { type: DataTypes.TEXT, allowNull: true },

      user_id:   { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      user_name: { type: DataTypes.STRING(180), allowNull: true },

      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: "service_order_events",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: false,
      indexes: [{ fields: ["order_id", "created_at"] }],
    }
  );

  return ServiceOrderEvent;
};
