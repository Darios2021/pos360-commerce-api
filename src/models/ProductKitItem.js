// src/models/ProductKitItem.js
// Componentes de un kit/combo. Vincula products (kit) → products (component)
// con una cantidad. La unicidad (kit_id, component_id) garantiza que cada
// componente aparezca una sola vez por kit (su qty representa la cantidad).

module.exports = (sequelize, DataTypes) => {
  const ProductKitItem = sequelize.define(
    "ProductKitItem",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      kit_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },
      component_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },
      qty: {
        type: DataTypes.DECIMAL(12, 3),
        allowNull: false,
        defaultValue: "1.000",
      },
      sort_order: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: "product_kit_items",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      paranoid: false,
    }
  );

  ProductKitItem.associate = (models) => {
    if (models.Product) {
      ProductKitItem.belongsTo(models.Product, {
        foreignKey: "kit_id",
        as: "kit",
      });
      ProductKitItem.belongsTo(models.Product, {
        foreignKey: "component_id",
        as: "component",
      });
    }
  };

  return ProductKitItem;
};
