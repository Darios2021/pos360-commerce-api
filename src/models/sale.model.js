module.exports = (sequelize, DataTypes) => {
  const Sale = sequelize.define(
    "Sale",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
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

      status: {
        type: DataTypes.ENUM("DRAFT", "PAID", "CANCELLED", "REFUNDED"),
        allowNull: false,
        defaultValue: "PAID",
      },

      sale_number: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },

      customer_name: {
        type: DataTypes.STRING(160),
        allowNull: true,
      },

      // ✅ CLAVE: estaban faltando
      customer_doc: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },

      customer_phone: {
        type: DataTypes.STRING(40),
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

      note: {
        type: DataTypes.STRING(255),
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
      createdAt: "created_at",
      updatedAt: "updated_at",
      paranoid: false,
    }
  );

  Sale.associate = (models) => {
    Sale.belongsTo(models.Branch, { foreignKey: "branch_id", as: "branch" });
    Sale.belongsTo(models.User, { foreignKey: "user_id", as: "user" });
    Sale.hasMany(models.SaleItem, { foreignKey: "sale_id", as: "items" });
    Sale.hasMany(models.Payment, { foreignKey: "sale_id", as: "payments" });
  };

  return Sale;
};