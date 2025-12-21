module.exports = (sequelize, DataTypes) => {
  const Payment = sequelize.define("Payment", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    sale_id: { type: DataTypes.INTEGER },
    
    // CORRECCIÓN: En tu DB es 'method', no 'payment_method'
    method: { 
      type: DataTypes.ENUM('CASH','TRANSFER','CARD','QR','OTHER'), 
      defaultValue: 'CASH' 
    }, 
    
    amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    reference: { type: DataTypes.STRING },
    note: { type: DataTypes.STRING }
  }, {
    tableName: 'payments',
    underscored: true,
    timestamps: true,
    paranoid: false
  });

  return Payment;
};