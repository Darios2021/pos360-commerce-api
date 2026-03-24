// ✅ COPY-PASTE FINAL COMPLETO
// src/models/SaleDocument.js

module.exports = (sequelize, DataTypes) => {
  const SaleDocument = sequelize.define(
    "SaleDocument",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },

      sale_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },

      branch_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },

      cash_register_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },

      issued_by: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },

      document_kind: {
        type: DataTypes.ENUM(
          "INVOICE",
          "CREDIT_NOTE",
          "DEBIT_NOTE",
          "RECEIPT",
          "TICKET",
          "OTHER"
        ),
        allowNull: false,
        defaultValue: "INVOICE",
      },

      invoice_type: {
        type: DataTypes.ENUM("TICKET", "A", "B", "C", "M", "NC", "ND", "OTHER"),
        allowNull: false,
      },

      invoice_letter: {
        type: DataTypes.ENUM("A", "B", "C", "M", "X"),
        allowNull: true,
      },

      invoice_mode: {
        type: DataTypes.ENUM("NO_FISCAL", "FISCAL", "MIXED", "TICKET_ONLY"),
        allowNull: true,
      },

      point_of_sale: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: true,
      },

      document_number: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },

      full_number: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },

      cbte_tipo_code: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: true,
      },

      concept_code: {
        type: DataTypes.TINYINT.UNSIGNED,
        allowNull: true,
      },

      issued_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },

      service_date_from: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },

      service_date_to: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },

      due_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },

      customer_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },

      customer_name: {
        type: DataTypes.STRING(160),
        allowNull: true,
      },

      customer_doc_type: {
        type: DataTypes.ENUM("DNI", "CUIT", "CUIL", "CDI", "PASSPORT", "OTHER"),
        allowNull: true,
      },

      customer_doc_number: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },

      customer_tax_condition: {
        type: DataTypes.ENUM(
          "CONSUMIDOR_FINAL",
          "RESPONSABLE_INSCRIPTO",
          "MONOTRIBUTO",
          "EXENTO",
          "NO_RESPONSABLE",
          "SUJETO_NO_CATEGORIZADO",
          "PROVEEDOR_DEL_EXTERIOR",
          "CLIENTE_DEL_EXTERIOR",
          "IVA_LIBERADO",
          "MONOTRIBUTO_SOCIAL",
          "PEQUENO_CONTRIBUYENTE_EVENTUAL",
          "OTRO"
        ),
        allowNull: true,
      },

      customer_address: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },

      customer_email: {
        type: DataTypes.STRING(160),
        allowNull: true,
      },

      currency_code: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: "ARS",
      },

      currency_rate: {
        type: DataTypes.DECIMAL(18, 6),
        allowNull: false,
        defaultValue: 1,
      },

      subtotal_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      discount_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      net_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      non_taxed_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      exempt_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      vat_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      other_taxes_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      total_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      fiscal_status: {
        type: DataTypes.ENUM(
          "NOT_REQUESTED",
          "PENDING",
          "AUTHORIZED",
          "REJECTED",
          "VOIDED"
        ),
        allowNull: false,
        defaultValue: "NOT_REQUESTED",
      },

      authorization_mode: {
        type: DataTypes.ENUM("CAE", "CAEA", "NONE"),
        allowNull: false,
        defaultValue: "NONE",
      },

      cae: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },

      cae_due_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },

      afip_result: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },

      afip_message: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },

      arca_request_json: {
        type: DataTypes.JSON,
        allowNull: true,
      },

      arca_response_json: {
        type: DataTypes.JSON,
        allowNull: true,
      },

      arca_observations_json: {
        type: DataTypes.JSON,
        allowNull: true,
      },

      arca_errors_json: {
        type: DataTypes.JSON,
        allowNull: true,
      },

      qr_payload: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      barcode_payload: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      cancel_reason: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      tableName: "sale_documents",
      underscored: true,
      timestamps: true,
    }
  );

  SaleDocument.associate = (models) => {
    SaleDocument.belongsTo(models.Sale, {
      foreignKey: "sale_id",
      as: "sale",
    });

    if (models.Branch) {
      SaleDocument.belongsTo(models.Branch, {
        foreignKey: "branch_id",
        as: "branch",
      });
    }

    if (models.CashRegister) {
      SaleDocument.belongsTo(models.CashRegister, {
        foreignKey: "cash_register_id",
        as: "cashRegister",
      });
    }

    if (models.User) {
      SaleDocument.belongsTo(models.User, {
        foreignKey: "issued_by",
        as: "issuedBy",
      });
    }

    if (models.EcomCustomer) {
      SaleDocument.belongsTo(models.EcomCustomer, {
        foreignKey: "customer_id",
        as: "customer",
      });
    }

    if (models.SaleDocumentVatLine) {
      SaleDocument.hasMany(models.SaleDocumentVatLine, {
        foreignKey: "sale_document_id",
        as: "vatLines",
      });
    }

    if (models.SaleDocumentTaxLine) {
      SaleDocument.hasMany(models.SaleDocumentTaxLine, {
        foreignKey: "sale_document_id",
        as: "taxLines",
      });
    }

    if (models.SaleDocumentRelation) {
      SaleDocument.hasMany(models.SaleDocumentRelation, {
        foreignKey: "sale_document_id",
        as: "relations",
      });

      SaleDocument.hasMany(models.SaleDocumentRelation, {
        foreignKey: "related_sale_document_id",
        as: "relatedToMe",
      });
    }
  };

  return SaleDocument;
};