module.exports = (sequelize, DataTypes) => {
  const Payment = sequelize.define("Payment", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    sale_id: { type: DataTypes.INTEGER },
    
    // CORRECCIÓN CRÍTICA: En tu DB se llama method
    method: { type: DataTypes.STRING, defaultValue: 'CASH' }, 
    
    amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false }
  }, {
    tableName: 'payments',
    underscored: true,
    timestamps: true,
    paranoid: false
  });

  return Payment;
};