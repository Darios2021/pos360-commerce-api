module.exports = (sequelize, DataTypes) => {
  const Sale = sequelize.define("Sale", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    branch_id: { type: DataTypes.INTEGER },
    user_id: { type: DataTypes.INTEGER },
    customer_name: { type: DataTypes.STRING },
    
    // CAMPOS OBLIGATORIOS SEGÚN TU DB
    subtotal: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
    discount_total: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
    tax_total: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
    
    total: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
    
    paid_total: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
    change_total: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
    
    status: { 
      type: DataTypes.ENUM('DRAFT','PAID','CANCELLED','REFUNDED'), 
      defaultValue: 'PAID' 
    },
    
    sold_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  }, {
    tableName: 'sales',
    underscored: true,
    timestamps: true,
    paranoid: false 
  });

  return Sale;
};