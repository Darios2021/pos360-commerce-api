module.exports = (sequelize, DataTypes) => {
  return sequelize.define("Payment", {
    sale_id: { type: DataTypes.INTEGER, allowNull: false },
    method: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    reference: { type: DataTypes.STRING }
  }, { 
    tableName: 'payments', 
    underscored: true, 
    paranoid: true 
  });
};