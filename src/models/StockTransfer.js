// src/models/StockTransfer.js
module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "StockTransfer",
    {
      id:               { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      number:           { type: DataTypes.STRING(32), allowNull: false },
      from_warehouse_id:{ type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      to_warehouse_id:  { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      to_branch_id:     { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      status: {
        type: DataTypes.ENUM("draft","dispatched","received","partial","rejected","cancelled"),
        allowNull: false,
        defaultValue: "draft",
      },
      note:          { type: DataTypes.TEXT, allowNull: true },
      dispatched_at: { type: DataTypes.DATE, allowNull: true },
      dispatched_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      received_at:   { type: DataTypes.DATE, allowNull: true },
      received_by:   { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      created_by:    { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    },
    {
      tableName:  "stock_transfers",
      timestamps: true,
      createdAt:  "created_at",
      updatedAt:  "updated_at",
    }
  );
};
