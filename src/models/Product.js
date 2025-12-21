// Dentro de src/models/Product.js
module.exports = (sequelize, DataTypes) => {
  const Product = sequelize.define("Product", {
    // ... tus campos (id, name, code, etc) ...
  }, {
    tableName: 'products',
    underscored: true,
    timestamps: true,
    // CAMBIA ESTO:
    paranoid: false 
  });

  return Product;
};