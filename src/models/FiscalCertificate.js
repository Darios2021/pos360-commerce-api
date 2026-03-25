module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "FiscalCertificate",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      branch_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
      },
      alias: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      cert_path: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      key_path: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      passphrase_encrypted: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      active: {
        type: DataTypes.TINYINT,
        allowNull: false,
        defaultValue: 1,
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      last_validated_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "fiscal_certificates",
      timestamps: true,
      underscored: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );
};