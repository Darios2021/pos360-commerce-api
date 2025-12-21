module.exports = (sequelize, DataTypes) => {
  const Payment = sequelize.define("Payment", {
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
      type: DataTypes.ENUM("CASH", "TRANSFER", "CARD", "QR", "OTHER"),
      allowNull: false,
      defaultValue: "CASH",
    },
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    reference: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    note: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    paid_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  }, {
    tableName: "payments",
    underscored: true,
    timestamps: true,
  });

  Payment.associate = (models) => {
    Payment.belongsTo(models.Sale, { foreignKey: "sale_id" });
  };

  return Payment;
};
