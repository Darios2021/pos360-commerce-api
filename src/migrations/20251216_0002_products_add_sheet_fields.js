"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("products", "code", {
      type: Sequelize.STRING(60),
      allowNull: true,
    });

    // sub-rubro -> categories.id
    await queryInterface.addColumn("products", "subcategory_id", {
      type: Sequelize.BIGINT.UNSIGNED,
      allowNull: true,
      references: { model: "categories", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    await queryInterface.addColumn("products", "is_new", {
      type: Sequelize.TINYINT,
      allowNull: false,
      defaultValue: 0,
    });

    await queryInterface.addColumn("products", "is_promo", {
      type: Sequelize.TINYINT,
      allowNull: false,
      defaultValue: 0,
    });

    await queryInterface.addColumn("products", "list_price", {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    });

    await queryInterface.addColumn("products", "cash_price", {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    });

    await queryInterface.addColumn("products", "reseller_price", {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    });

    await queryInterface.addColumn("products", "promo_price", {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: true,
      defaultValue: null,
    });

    await queryInterface.addIndex("products", ["code"]);
    await queryInterface.addIndex("products", ["subcategory_id"]);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("products", ["subcategory_id"]);
    await queryInterface.removeIndex("products", ["code"]);

    await queryInterface.removeColumn("products", "promo_price");
    await queryInterface.removeColumn("products", "reseller_price");
    await queryInterface.removeColumn("products", "cash_price");
    await queryInterface.removeColumn("products", "list_price");
    await queryInterface.removeColumn("products", "is_promo");
    await queryInterface.removeColumn("products", "is_new");
    await queryInterface.removeColumn("products", "subcategory_id");
    await queryInterface.removeColumn("products", "code");
  },
};
