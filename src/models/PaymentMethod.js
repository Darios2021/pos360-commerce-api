// ✅ COPY-PASTE FINAL COMPLETO
// src/models/PaymentMethod.js

module.exports = (sequelize, DataTypes) => {
  const PaymentMethod = sequelize.define(
    "PaymentMethod",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },

      branch_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },

      code: {
        type: DataTypes.STRING(80),
        allowNull: false,
      },

      name: {
        type: DataTypes.STRING(140),
        allowNull: false,
      },

      display_name: {
        type: DataTypes.STRING(180),
        allowNull: true,
      },

      description: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },

      kind: {
        type: DataTypes.ENUM(
          "CASH",
          "TRANSFER",
          "CARD",
          "QR",
          "MERCADOPAGO",
          "CREDIT_SJT",
          "OTHER"
        ),
        allowNull: false,
        defaultValue: "OTHER",
      },

      provider_code: {
        type: DataTypes.STRING(80),
        allowNull: true,
      },

      card_brand: {
        type: DataTypes.STRING(60),
        allowNull: true,
      },

      card_kind: {
        type: DataTypes.ENUM("CREDIT", "DEBIT", "PREPAID", "BOTH"),
        allowNull: true,
      },

      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      is_default: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      is_system: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      is_featured: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      sort_order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 100,
      },

      allow_mixed: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      only_pos: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      only_ecom: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      only_backoffice: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      allows_change: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      change_limit_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
      },

      counts_as_cash_in_register: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      impacts_cash_register: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      register_group: {
        type: DataTypes.ENUM(
          "CASH",
          "BANK",
          "CARD",
          "DIGITAL",
          "INTERNAL_CREDIT",
          "OTHER"
        ),
        allowNull: false,
        defaultValue: "OTHER",
      },

      settlement_delay_days: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      auto_reconcile: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      pricing_mode: {
        type: DataTypes.ENUM(
          "SALE_PRICE",
          "LIST_PRICE",
          "SURCHARGE_PERCENT",
          "FIXED_PRICE"
        ),
        allowNull: false,
        defaultValue: "SALE_PRICE",
      },

      surcharge_percent: {
        type: DataTypes.DECIMAL(8, 4),
        allowNull: false,
        defaultValue: 0,
      },

      surcharge_fixed_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      fixed_price_value: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
      },

      rounding_mode: {
        type: DataTypes.ENUM("NONE", "NEAREST", "UP", "DOWN"),
        allowNull: false,
        defaultValue: "NONE",
      },

      rounding_value: {
        type: DataTypes.DECIMAL(12, 4),
        allowNull: true,
      },

      supports_installments: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      min_installments: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },

      max_installments: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },

      default_installments: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },

      installment_pricing_mode: {
        type: DataTypes.ENUM(
          "SAME_AS_BASE",
          "SALE_PRICE",
          "LIST_PRICE",
          "SURCHARGE_PERCENT",
          "PLAN"
        ),
        allowNull: false,
        defaultValue: "SAME_AS_BASE",
      },

      installment_surcharge_percent: {
        type: DataTypes.DECIMAL(8, 4),
        allowNull: false,
        defaultValue: 0,
      },

      installment_plan_json: {
        type: DataTypes.JSON,
        allowNull: true,
      },

      requires_reference: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      requires_auth_code: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      requires_last4: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      requires_card_holder: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      requires_bank_name: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      requires_customer_doc: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      requires_customer_phone: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      min_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
      },

      max_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
      },

      valid_from: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      valid_to: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      input_schema_json: {
        type: DataTypes.JSON,
        allowNull: true,
      },

      meta: {
        type: DataTypes.JSON,
        allowNull: true,
      },
    },
    {
      tableName: "payment_methods",
      freezeTableName: true,
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        {
          name: "idx_payment_methods_branch_id",
          fields: ["branch_id"],
        },
        {
          name: "idx_payment_methods_active",
          fields: ["is_active"],
        },
        {
          name: "idx_payment_methods_kind",
          fields: ["kind"],
        },
        {
          name: "idx_payment_methods_sort",
          fields: ["sort_order"],
        },
        {
          name: "uq_payment_methods_branch_code",
          unique: true,
          fields: ["branch_id", "code"],
        },
      ],
    }
  );

  return PaymentMethod;
};