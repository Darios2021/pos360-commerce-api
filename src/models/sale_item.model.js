// ✅ COPY-PASTE FINAL COMPLETO
// src/models/SaleItem.js

module.exports = (sequelize, DataTypes) => {
  const SaleItem = sequelize.define(
    "SaleItem",
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },

      sale_id: { 
        type: DataTypes.BIGINT.UNSIGNED, 
        allowNull: false 
      },

      product_id: { 
        type: DataTypes.BIGINT.UNSIGNED, 
        allowNull: false 
      },

      // ✅ FIX CRÍTICO (LO QUE TE ESTÁ ROMPIENDO TODO)
      warehouse_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },

      quantity: { 
        type: DataTypes.DECIMAL(12, 3), 
        allowNull: false 
      },

      unit_price: { 
        type: DataTypes.DECIMAL(12, 2), 
        allowNull: false 
      },

      // Opcionales (pero compatibles con tu backend actual)
      discount_amount: { 
        type: DataTypes.DECIMAL(12, 2), 
        allowNull: false,
        defaultValue: 0,
      },

      tax_amount: { 
        type: DataTypes.DECIMAL(12, 2), 
        allowNull: false,
        defaultValue: 0,
      },

      // ✅ ESTE YA LO TENÍAS BIEN
      line_total: { 
        type: DataTypes.DECIMAL(12, 2), 
        allowNull: false 
      },

      // Snapshots
      product_name_snapshot: { type: DataTypes.STRING },
      product_sku_snapshot: { type: DataTypes.STRING },
      product_barcode_snapshot: { type: DataTypes.STRING },
    },
    {
      tableName: "sale_items",
      underscored: true,
      timestamps: true,
      paranoid: false,
    }
  );

  return SaleItem;
};