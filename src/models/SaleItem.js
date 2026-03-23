module.exports = (sequelize, DataTypes) => {
  const SaleItem = sequelize.define(
    "SaleItem",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },

      sale_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },

      product_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },

      warehouse_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },

      quantity: {
        type: DataTypes.DECIMAL(12, 3),
        allowNull: false,
        defaultValue: 1,
      },

      unit_price: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      discount_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      tax_amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      line_total: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },

      product_name_snapshot: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },

      product_sku_snapshot: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },

      product_barcode_snapshot: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },

      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },

      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "sale_items",
      underscored: true,
      timestamps: true,
      paranoid: false,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  SaleItem.associate = (models) => {
    if (models.Sale) {
      SaleItem.belongsTo(models.Sale, {
        foreignKey: "sale_id",
        as: "sale",
      });
    }

    if (models.Product) {
      SaleItem.belongsTo(models.Product, {
        foreignKey: "product_id",
        as: "product",
      });
    }

    if (models.Warehouse) {
      SaleItem.belongsTo(models.Warehouse, {
        foreignKey: "warehouse_id",
        as: "warehouse",
      });
    }
  };

  return SaleItem;
};