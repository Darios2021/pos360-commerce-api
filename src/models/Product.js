module.exports = (sequelize, DataTypes) => {
  const Product = sequelize.define("Product", {
    id: { 
      type: DataTypes.INTEGER, 
      primaryKey: true, 
      autoIncrement: true 
    },
    name: { 
      type: DataTypes.STRING, 
      allowNull: false 
    },
    code: { 
      type: DataTypes.STRING, 
      unique: true 
    },
    barcode: { 
      type: DataTypes.STRING 
    },
    description: { 
      type: DataTypes.TEXT 
    },
    price: { 
      type: DataTypes.DECIMAL(15, 2), 
      defaultValue: 0 
    },
    cost: { 
      type: DataTypes.DECIMAL(15, 2), 
      defaultValue: 0 
    },
    is_active: { 
      type: DataTypes.BOOLEAN, 
      defaultValue: true 
    },
    category_id: { 
      type: DataTypes.INTEGER 
    }
  }, {
    tableName: 'products',
    underscored: true,
    timestamps: true, // Crucial para paranoid
    paranoid: true    // Habilita Soft Delete correctamente
  });

  return Product;
};