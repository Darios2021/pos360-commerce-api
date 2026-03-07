module.exports = (sequelize, DataTypes) => {
  const Payment = sequelize.define(
    "Payment",
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

      method: {
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
        defaultValue: "CASH",
      },

      amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      reference: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },

      installments: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },

      note: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },

      paid_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "payments",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      paranoid: false,
    }
  );

  Payment.associate = (models) => {
    Payment.belongsTo(models.Sale, { foreignKey: "sale_id", as: "sale" });
  };

  return Payment;
};