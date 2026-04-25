// src/models/Customer.js
//
// Modelo unificado de clientes (POS + Ecom). Reemplaza la práctica de guardar
// solo `customer_name` libre en sales. Las ventas pueden seguir guardando el
// snapshot de nombre/doc/teléfono pero también linkean por `customer_id` cuando
// el customer existe en esta tabla.
//
// Identidad: idealmente unique por (doc_type, doc_number). Si no hay doc, el
// teléfono normalizado o el email sirven como identificador secundario.
//
// La tabla se crea con migración soft (CREATE TABLE IF NOT EXISTS) en el
// service de bootstrap para no requerir migración manual en producción.

module.exports = (sequelize, DataTypes) => {
  const Customer = sequelize.define(
    "Customer",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },

      // Identidad principal
      first_name: { type: DataTypes.STRING(120), allowNull: true },
      last_name:  { type: DataTypes.STRING(120), allowNull: true },
      // Nombre canónico para mostrar / agrupar (puede diferir de first+last
      // cuando es razón social o cuando viene de POS en un solo campo).
      display_name: { type: DataTypes.STRING(200), allowNull: false },

      // Documento fiscal/personal
      doc_type:   { type: DataTypes.STRING(20), allowNull: true },  // DNI, CUIT, CUIL, PAS, OTRO
      doc_number: { type: DataTypes.STRING(40), allowNull: true },

      // Contacto
      email: { type: DataTypes.STRING(160), allowNull: true },
      phone: { type: DataTypes.STRING(40),  allowNull: true },

      // Ubicación opcional
      address: { type: DataTypes.STRING(220), allowNull: true },
      city:    { type: DataTypes.STRING(120), allowNull: true },
      province:{ type: DataTypes.STRING(120), allowNull: true },
      postal_code: { type: DataTypes.STRING(20), allowNull: true },

      // Información comercial
      customer_type: {
        // Coincide con sale.customer_type para que el join sea natural.
        type: DataTypes.ENUM("CONSUMIDOR_FINAL", "RESPONSABLE_INSCRIPTO", "MONOTRIBUTO", "EXENTO", "OTRO"),
        allowNull: false,
        defaultValue: "CONSUMIDOR_FINAL",
      },
      tax_condition: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },

      // Marketing
      accepts_promos: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      tags: {
        // CSV simple (ej: "vip, mayorista") — más adelante puede pasar a tabla.
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      notes: { type: DataTypes.TEXT, allowNull: true },

      // Origen para auditar de dónde se creó
      source: {
        type: DataTypes.ENUM("pos", "ecom", "import", "admin", "backfill"),
        allowNull: false,
        defaultValue: "pos",
      },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: "customers",
      underscored: true,
      timestamps: true,
      paranoid: false,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        { fields: ["display_name"] },
        { fields: ["doc_number"] },
        { fields: ["phone"] },
        { fields: ["email"] },
      ],
    }
  );

  return Customer;
};
