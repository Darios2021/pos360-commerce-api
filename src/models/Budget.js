// src/models/Budget.js
//
// Cabecera de presupuesto. Un presupuesto es una cotización que todavía no
// mueve stock ni caja: solo cuando pasa a `vendido` se puede convertir en
// venta del POS (sale_id).
//
// Los datos del cliente se guardan duplicados (customer_*) además del FK:
// el presupuesto es un documento que se le entrega al cliente y no debe
// cambiar si después se edita la ficha en customers.
//
// La tabla se crea con CREATE TABLE IF NOT EXISTS en migrations/runner.js,
// así no hace falta migración manual en producción.

module.exports = (sequelize, DataTypes) => {
  const Budget = sequelize.define(
    "Budget",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },

      // Correlativo visible. Se calcula en el controller (MAX+1).
      number: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },

      branch_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      user_id:   { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },

      // Vendedor y local congelados al emitir: el documento dice quién lo hizo
      // y desde qué local, aunque después cambie el usuario o la sucursal.
      // branch_code es el "número de local" que abre la numeración (001-00035).
      user_name:   { type: DataTypes.STRING(180), allowNull: true },
      branch_code: { type: DataTypes.STRING(10),  allowNull: true },

      // Cliente: FK opcional + snapshot
      customer_id:      { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      customer_name:    { type: DataTypes.STRING(180), allowNull: false, defaultValue: "Consumidor Final" },
      customer_email:   { type: DataTypes.STRING(180), allowNull: true },
      customer_phone:   { type: DataTypes.STRING(60),  allowNull: true },
      customer_address: { type: DataTypes.STRING(255), allowNull: true },
      customer_cuit:    { type: DataTypes.STRING(20),  allowNull: true },

      status: {
        type: DataTypes.ENUM("generado", "en_proceso", "entregado", "vendido", "no_venta"),
        allowNull: false,
        defaultValue: "generado",
      },

      currency:      { type: DataTypes.ENUM("ARS", "USD"), allowNull: false, defaultValue: "ARS" },
      exchange_rate: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: "1.00" },
      // Trazabilidad de la cotizacion: de donde salio y de cuando.
      fx_source:     { type: DataTypes.STRING(120), allowNull: true },
      fx_date:       { type: DataTypes.DATE, allowNull: true },

      valid_until: { type: DataTypes.DATEONLY, allowNull: true },
      notes:       { type: DataTypes.TEXT, allowNull: true },

      // Si está en 0 el PDF y la pantalla ocultan costo y margen.
      show_cost: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

      // Totales denormalizados: se recalculan en cada guardado de renglones.
      // El descuento no se carga a mano: sale de los renglones con margen
      // negativo. subtotal_gross es lo que valdrían esos renglones sin el
      // descuento, así el documento puede mostrarle al cliente cuánto se le hizo.
      subtotal_gross: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: "0.00" },
      discount:       { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: "0.00" },

      subtotal: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: "0.00" },
      vat_21:   { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: "0.00" },
      vat_105:  { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: "0.00" },
      total:    { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: "0.00" },

      sale_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    },
    {
      tableName: "budgets",
      underscored: true,
      timestamps: true,
      paranoid: false,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        { fields: ["customer_id"] },
        { fields: ["branch_id"] },
        { fields: ["status"] },
      ],
    }
  );

  return Budget;
};
