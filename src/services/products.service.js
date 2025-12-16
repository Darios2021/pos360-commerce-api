// src/app/store/products.store.js
import { defineStore } from "pinia";
import { ProductsService } from "../services/products.service";

export const useProductsStore = defineStore("products", {
  state: () => ({
    items: [],
    total: 0,
    page: 1,
    limit: 20,
    q: "",
    loading: false,
    error: null,
  }),

  actions: {
    async fetch({ q, page, limit } = {}) {
      this.loading = true;
      this.error = null;

      if (q !== undefined) this.q = q;
      if (page !== undefined) this.page = page;
      if (limit !== undefined) this.limit = limit;

      try {
        const resp = await ProductsService.list({
          q: this.q,
          page: this.page,
          limit: this.limit,
        });

        if (!resp?.ok) throw new Error(resp?.message || "Error listando productos");

        this.items = resp.items || [];
        this.total = resp.total ?? 0;
        this.page = resp.page ?? this.page;
        this.limit = resp.limit ?? this.limit;
      } catch (e) {
        this.error = e?.message || String(e);
      } finally {
        this.loading = false;
      }
    },

    async create(payload) {
      this.loading = true;
      this.error = null;
      try {
        const resp = await ProductsService.create(payload);
        if (!resp?.ok) throw new Error(resp?.message || "Error creando producto");
        await this.fetch({ page: 1 });
        return resp.item;
      } catch (e) {
        this.error = e?.message || String(e);
        throw e;
      } finally {
        this.loading = false;
      }
    },

    async update(id, payload) {
      this.loading = true;
      this.error = null;
      try {
        const resp = await ProductsService.update(id, payload);
        if (!resp?.ok) throw new Error(resp?.message || "Error actualizando producto");
        await this.fetch();
        return resp.item;
      } catch (e) {
        this.error = e?.message || String(e);
        throw e;
      } finally {
        this.loading = false;
      }
    },
  },
});
