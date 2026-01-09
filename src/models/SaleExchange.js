// src/models/SaleExchange.js
// ✅ COPY-PASTE FINAL COMPLETO (MATCH 100% con tabla sale_exchanges)

module.exports = (sequelize, DataTypes) => {
  const SaleExchange = sequelize.define(
    "SaleExchange",
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },

      original_sale_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      return_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      new_sale_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },

      original_total: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      returned_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      new_total: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      diff: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },

      note: { type: DataTypes.STRING(255), allowNull: true },

      created_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: "sale_exchanges",
      timestamps: false,
      underscored: true,
    }
  );

  SaleExchange.associate = (models) => {
    // Venta original y venta nueva
    if (models.Sale) {
      SaleExchange.belongsTo(models.Sale, { foreignKey: "original_sale_id", as: "originalSale" });
      SaleExchange.belongsTo(models.Sale, { foreignKey: "new_sale_id", as: "newSale" });
    }

    // Usuario creador (created_by)
    if (models.User) {
      SaleExchange.belongsTo(models.User, { foreignKey: "created_by", as: "creator" });
    }

    // No hay FK directa a sale_returns porque es otra tabla (y return_id apunta a sale_returns.id)
    // Si algún día hacés modelo SaleReturn, acá podrías asociarlo.
  };

  return SaleExchange;
};
