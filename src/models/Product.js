module.exports = (sequelize, DataTypes) => {
  const Product = sequelize.define("Product", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    code: DataTypes.STRING,
    sku: DataTypes.STRING,
    barcode: DataTypes.STRING,
    name: DataTypes.STRING,
    description: DataTypes.TEXT,
    category_id: DataTypes.INTEGER,
    subcategory_id: DataTypes.INTEGER,
    brand: DataTypes.STRING,
    model: DataTypes.STRING,
    is_new: DataTypes.BOOLEAN,
    is_promo: DataTypes.BOOLEAN,
    is_active: DataTypes.BOOLEAN,
    price_list: DataTypes.DECIMAL(10, 2),
    price_discount: DataTypes.DECIMAL(10, 2),
    price_reseller: DataTypes.DECIMAL(10, 2),
    // ... agrega cualquier otro campo que falte según tu SQL ...
  }, {
    tableName: 'products',
    underscored: true,
    timestamps: true,
    paranoid: false // Como vimos antes, para evitar el error del deleted_at
  });

  return Product;
};