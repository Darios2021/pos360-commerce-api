// src/models/TelegramAlertLog.js
// Registro de alertas enviadas. Sirve para:
// - Dedupe (no mandar 2 veces la misma alerta por el mismo ref).
// - Auditoría: ver qué se mandó y cuándo.
module.exports = (sequelize, DataTypes) => {
  const TelegramAlertLog = sequelize.define(
    "TelegramAlertLog",
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      alert_code: { type: DataTypes.STRING(64), allowNull: false },
      reference_type: { type: DataTypes.STRING(64), allowNull: true },
      reference_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      dedupe_key: { type: DataTypes.STRING(160), allowNull: true },
      chat_id: { type: DataTypes.STRING(64), allowNull: true },
      text: { type: DataTypes.TEXT, allowNull: true },
      payload: {
        type: DataTypes.TEXT,
        allowNull: true,
        get() {
          const raw = this.getDataValue("payload");
          if (!raw) return null;
          try { return JSON.parse(raw); } catch { return null; }
        },
        set(val) {
          this.setDataValue("payload", val == null ? null : JSON.stringify(val));
        },
      },
      success: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      error: { type: DataTypes.TEXT, allowNull: true },
      sent_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "telegram_alerts_log",
      freezeTableName: true,
      timestamps: false,
      indexes: [
        { fields: ["alert_code"] },
        { fields: ["dedupe_key"] },
        { fields: ["reference_type", "reference_id"] },
        { fields: ["sent_at"] },
      ],
    }
  );

  return TelegramAlertLog;
};
