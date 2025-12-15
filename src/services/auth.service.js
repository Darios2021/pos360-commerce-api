// src/services/auth.service.js
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "https://pos360-commerce-api.cingulado.org";

const http = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
});

export async function login(identifier, password) {
  const { data } = await http.post("/api/v1/auth/login", { identifier, password });
  return data; // { user, accessToken, refreshToken }
}

export async function me(accessToken) {
  const { data } = await http.get("/api/v1/protected/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data; // { ok, user }
}
