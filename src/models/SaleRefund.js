// src/models/SaleRefund.js
// ✅ COPY-PASTE FINAL COMPLETO (VIEW sale_refunds)

module.exports = (sequelize, DataTypes) => {
  const SaleRefund = sequelize.define(
    "SaleRefund",
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true },

      sale_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      branch_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },

      // OJO: en tu VIEW sale_refunds, user_id viene de sale_returns.created_by => puede ser NULL
      user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },

      amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      refund_method: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "OTHER" },

      restock: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      reason: { type: DataTypes.STRING(255), allowNull: true },
      reference: { type: DataTypes.STRING(120), allowNull: true },

      created_at: { type: DataTypes.DATE, allowNull: false },
    },
    {
      tableName: "sale_refunds",
      timestamps: false,
      underscored: true,
    }
  );

  SaleRefund.associate = (models) => {
    if (models.Sale) {
      SaleRefund.belongsTo(models.Sale, { foreignKey: "sale_id", as: "sale" });
      // NO hacemos Sale.hasMany(SaleRefund) si no lo necesitás, pero si lo querés, está OK.
    }
    if (models.User) {
      SaleRefund.belongsTo(models.User, { foreignKey: "user_id", as: "user" });
    }
    if (models.Branch) {
      SaleRefund.belongsTo(models.Branch, { foreignKey: "branch_id", as: "branch" });
    }
  };

  return SaleRefund;
};
