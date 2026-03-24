// ✅ COPY-PASTE FINAL COMPLETO
// src/models/SaleDocumentVatLine.js

module.exports = (sequelize, DataTypes) => {
  const SaleDocumentVatLine = sequelize.define(
    "SaleDocumentVatLine",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },

      sale_document_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },

      vat_code: {
        type: DataTypes.STRING(16),
        allowNull: true,
      },

      vat_name: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },

      vat_rate: {
        type: DataTypes.DECIMAL(7, 3),
        allowNull: false,
        defaultValue: 0,
      },

      base_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      tax_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: "sale_document_vat_lines",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: false,
    }
  );

  SaleDocumentVatLine.associate = (models) => {
    SaleDocumentVatLine.belongsTo(models.SaleDocument, {
      foreignKey: "sale_document_id",
      as: "document",
    });
  };

  return SaleDocumentVatLine;
};