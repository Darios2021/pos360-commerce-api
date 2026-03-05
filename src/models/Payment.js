// ✅ COPY-PASTE FINAL COMPLETO
// src/models/payment.js  (o donde lo tengas)

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

      // ✅ MATCH DB REAL
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

      // ✅ MATCH DB REAL
      reference: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },

      // ✅ CLAVE: cuotas (DB default 1)
      installments: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },

      // ✅ DB es varchar(255) => limitamos
      note: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },

      // ✅ DB real: datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
      // Lo dejamos allowNull false para que Sequelize no mande null
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
    }
  );

  Payment.associate = (models) => {
    Payment.belongsTo(models.Sale, { foreignKey: "sale_id" });
  };

  return Payment;
};