// src/models/TelegramConfig.js
// Configuración singleton del bot de Telegram.
// Siempre existe una sola fila (id = 1). Se lee/actualiza vía upsert.
module.exports = (sequelize, DataTypes) => {
  const TelegramConfig = sequelize.define(
    "TelegramConfig",
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        primaryKey: true,
        defaultValue: 1,
      },
      bot_token: { type: DataTypes.STRING(255), allowNull: true },
      chat_id: { type: DataTypes.STRING(64), allowNull: true },
      parse_mode: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "HTML" },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

      // Toggles por tipo de alerta (arrancan apagados).
      alert_cash_opened: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      alert_cash_closed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      alert_cash_shortage: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      alert_cash_surplus: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      alert_cash_long_open: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      alert_cash_overtime: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      alert_cash_big_out: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      alert_stock_zero: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      alert_stock_low: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      alert_stock_negative: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      alert_stock_big_adjust: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      alert_shop_new_order: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      alert_transfer_dispatched: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      alert_transfer_pending: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      alert_transfer_received: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      alert_promo_change: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

      // JSON con umbrales por alerta (override de los defaults del service).
      thresholds: {
        type: DataTypes.TEXT,
        allowNull: true,
        get() {
          const raw = this.getDataValue("thresholds");
          if (!raw) return null;
          try { return JSON.parse(raw); } catch { return null; }
        },
        set(val) {
          this.setDataValue("thresholds", val == null ? null : JSON.stringify(val));
        },
      },

      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: "telegram_config",
      freezeTableName: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return TelegramConfig;
};
