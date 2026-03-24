// ✅ COPY-PASTE FINAL COMPLETO
// src/models/SaleDocumentTaxLine.js

module.exports = (sequelize, DataTypes) => {
  const SaleDocumentTaxLine = sequelize.define(
    "SaleDocumentTaxLine",
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

      tax_code: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },

      tax_name: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },

      base_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      rate: {
        type: DataTypes.DECIMAL(9, 4),
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
      tableName: "sale_document_tax_lines",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: false,
    }
  );

  SaleDocumentTaxLine.associate = (models) => {
    SaleDocumentTaxLine.belongsTo(models.SaleDocument, {
      foreignKey: "sale_document_id",
      as: "document",
    });
  };

  return SaleDocumentTaxLine;
};