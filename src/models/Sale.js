module.exports = (sequelize, DataTypes) => {
  return sequelize.define("Sale", {
    branch_id: { type: DataTypes.INTEGER, allowNull: false },
    user_id: { type: DataTypes.INTEGER, allowNull: false },
    sale_number: { type: DataTypes.STRING, unique: true },
    status: { type: DataTypes.ENUM("PAID", "CANCELLED"), defaultValue: "PAID" },
    customer_name: { type: DataTypes.STRING },
    customer_doc: { type: DataTypes.STRING },
    total: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    sold_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  }, { 
    tableName: 'sales', 
    underscored: true, 
    paranoid: true 
  });
};