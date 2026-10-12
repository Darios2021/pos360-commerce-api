// src/models/StockCount.js
// Conteo de stock de un depósito. Contrato: docs/conteos-y-codigo.md
module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "StockCount",
    {
      id:           { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      number:       { type: DataTypes.STRING(32), allowNull: false },
      warehouse_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      branch_id:    { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      status: {
        type: DataTypes.ENUM("draft", "pending", "applied", "cancelled"),
        allowNull: false,
        defaultValue: "draft",
      },
      motivo:       { type: DataTypes.STRING(255), allowNull: true },
      created_by:   { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      submitted_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      submitted_at: { type: DataTypes.DATE, allowNull: true },
      applied_by:   { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      applied_at:   { type: DataTypes.DATE, allowNull: true },
      cancelled_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      cancelled_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName:  "stock_counts",
      timestamps: true,
      createdAt:  "created_at",
      updatedAt:  "updated_at",
    }
  );
};
