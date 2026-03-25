module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    "FiscalConfig",
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
      enabled: {
        type: DataTypes.TINYINT,
        allowNull: false,
        defaultValue: 0,
      },
      environment: {
        type: DataTypes.ENUM("testing", "production"),
        allowNull: false,
        defaultValue: "testing",
      },
      cuit: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      razon_social: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      punto_venta: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
      },
      condicion_iva: {
        type: DataTypes.ENUM(
          "RESPONSABLE_INSCRIPTO",
          "MONOTRIBUTO",
          "EXENTO",
          "CONSUMIDOR_FINAL",
          "OTRO"
        ),
        allowNull: false,
        defaultValue: "RESPONSABLE_INSCRIPTO",
      },
      default_invoice_type: {
        type: DataTypes.ENUM("TICKET", "A", "B", "C", "M", "NC", "ND", "OTHER"),
        allowNull: false,
        defaultValue: "B",
      },
      wsaa_url: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      wsfe_url: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      cert_active_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: true,
      },
      notes: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
    },
    {
      tableName: "fiscal_configs",
      timestamps: true,
      underscored: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );
};