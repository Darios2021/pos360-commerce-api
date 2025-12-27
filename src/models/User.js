module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define(
    "User",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },

      branch_id: DataTypes.INTEGER,
      email: DataTypes.STRING,
      username: DataTypes.STRING,
      password: DataTypes.STRING,

      first_name: DataTypes.STRING,
      last_name: DataTypes.STRING,

      avatar_key: DataTypes.STRING,
      avatar_url: DataTypes.STRING,

      is_active: DataTypes.BOOLEAN,
      last_login_at: DataTypes.DATE,
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE,
    },
    {
      tableName: "users",
      timestamps: false,
    }
  );

  return User;
};
