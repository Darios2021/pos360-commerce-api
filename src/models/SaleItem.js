module.exports = (sequelize, DataTypes) => {
  return sequelize.define("SaleItem", {
    sale_id: { type: DataTypes.INTEGER, allowNull: false },
    product_id: { type: DataTypes.INTEGER, allowNull: false },
    warehouse_id: { type: DataTypes.INTEGER, allowNull: false },
    quantity: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    unit_price: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    line_total: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    product_name_snapshot: { type: DataTypes.STRING }
  }, { 
    tableName: 'sale_items', 
    underscored: true, 
    paranoid: true 
  });
};