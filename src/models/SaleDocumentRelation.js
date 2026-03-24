// ✅ COPY-PASTE FINAL COMPLETO
// src/models/SaleDocumentRelation.js

module.exports = (sequelize, DataTypes) => {
  const SaleDocumentRelation = sequelize.define(
    "SaleDocumentRelation",
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

      related_sale_document_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },

      relation_type: {
        type: DataTypes.ENUM(
          "CREDIT_NOTE_OF",
          "DEBIT_NOTE_OF",
          "REVERSES",
          "ASSOCIATED_TO",
          "OTHER"
        ),
        allowNull: false,
        defaultValue: "ASSOCIATED_TO",
      },
    },
    {
      tableName: "sale_document_relations",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: false,
    }
  );

  SaleDocumentRelation.associate = (models) => {
    SaleDocumentRelation.belongsTo(models.SaleDocument, {
      foreignKey: "sale_document_id",
      as: "document",
    });

    SaleDocumentRelation.belongsTo(models.SaleDocument, {
      foreignKey: "related_sale_document_id",
      as: "relatedDocument",
    });
  };

  return SaleDocumentRelation;
};