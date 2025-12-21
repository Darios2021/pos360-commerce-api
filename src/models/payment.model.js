module.exports = (sequelize, DataTypes) => {
  const Payment = sequelize.define("Payment", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    amount: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    payment_method: { type: DataTypes.STRING, defaultValue: 'cash' }, // cash, card, transfer
    sale_id: { type: DataTypes.INTEGER }
  }, {
    tableName: 'payments',
    underscored: true,
    timestamps: true,
    paranoid: true
  });

  return Payment;
};