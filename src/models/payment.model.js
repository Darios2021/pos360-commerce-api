const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Payment = sequelize.define("Payment", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  sale_id: { type: DataTypes.INTEGER, allowNull: false },
  method: { type: DataTypes.STRING, allowNull: false }, // CASH, DEBIT, CREDIT
  amount: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
  reference: { type: DataTypes.STRING },
  paid_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, { 
  tableName: 'payments', 
  timestamps: false,
  underscored: true 
});

module.exports = Payment;