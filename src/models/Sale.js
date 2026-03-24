// ✅ COPY-PASTE FINAL COMPLETO
// src/models/Sale.js

module.exports = (sequelize, DataTypes) => {
  const Sale = sequelize.define(
    "Sale",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },

      sale_number: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      branch_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },

      cash_register_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },

      user_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },

      customer_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },

      customer_name: {
        type: DataTypes.STRING(160),
        allowNull: true,
      },

      customer_doc: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },

      customer_phone: {
        type: DataTypes.STRING(60),
        allowNull: true,
      },

      customer_email: {
        type: DataTypes.STRING(160),
        allowNull: true,
      },

      customer_address: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },

      customer_doc_type: {
        type: DataTypes.ENUM("DNI", "CUIT", "CUIL", "CDI", "PASSPORT", "OTHER"),
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

      invoice_mode: {
        type: DataTypes.ENUM("NO_FISCAL", "FISCAL", "MIXED", "TICKET_ONLY"),
        allowNull: true,
      },

      invoice_type: {
        type: DataTypes.ENUM("TICKET", "A", "B", "C", "M", "NC", "ND", "OTHER"),
        allowNull: true,
      },

      customer_type: {
        type: DataTypes.ENUM(
          "FINAL_CONSUMER",
          "REGISTERED",
          "WALK_IN",
          "COMPANY",
          "OTHER"
        ),
        allowNull: true,
      },

      subtotal: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      discount_total: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      tax_total: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      total: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      paid_total: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      change_total: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      status: {
        type: DataTypes.ENUM("DRAFT", "PAID", "CANCELLED", "REFUNDED"),
        allowNull: false,
        defaultValue: "PAID",
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

      has_fiscal_document: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      fiscal_document_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },

      note: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },

      metadata_json: {
        type: DataTypes.JSON,
        allowNull: true,
      },

      sold_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "sales",
      underscored: true,
      timestamps: true,
      paranoid: false,
    }
  );

  Sale.associate = (models) => {
    Sale.belongsTo(models.Branch, {
      foreignKey: "branch_id",
      as: "branch",
    });

    Sale.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
    });

    if (models.CashRegister) {
      Sale.belongsTo(models.CashRegister, {
        foreignKey: "cash_register_id",
        as: "cashRegister",
      });
    }

    if (models.EcomCustomer) {
      Sale.belongsTo(models.EcomCustomer, {
        foreignKey: "customer_id",
        as: "customer",
      });
    }

    Sale.hasMany(models.SaleItem, {
      foreignKey: "sale_id",
      as: "items",
    });

    Sale.hasMany(models.Payment, {
      foreignKey: "sale_id",
      as: "payments",
    });

    if (models.SaleDocument) {
      Sale.hasMany(models.SaleDocument, {
        foreignKey: "sale_id",
        as: "documents",
      });

      Sale.belongsTo(models.SaleDocument, {
        foreignKey: "fiscal_document_id",
        as: "fiscalDocument",
      });
    }
  };

  return Sale;
};