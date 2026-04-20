"use strict";
// src/services/socket.service.js
// Singleton de Socket.io — permite emitir eventos desde cualquier servicio.

const { Server } = require("socket.io");

let _io = null;

/**
 * Inicializa el servidor Socket.io adjuntándolo al httpServer de Express.
 * Llamar UNA sola vez desde server.js.
 */
function init(httpServer) {
  _io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ["polling", "websocket"],   // polling primero (atraviesa proxies), luego upgrade a WS
    pingTimeout:  60_000,
    pingInterval: 25_000,
  });

  _io.on("connection", (socket) => {
    // El cliente envía su branchId al conectarse para unirse a la sala
    socket.on("join:branch", (branchId) => {
      if (branchId) {
        socket.join(`branch:${branchId}`);
      }
    });
  });

  console.log("🔌 [Socket.io] Servidor inicializado");
  return _io;
}

/**
 * Emite un evento a todos los sockets conectados de una sucursal.
 * Si socket.io aún no se inicializó, lo ignora silenciosamente.
 */
function emitToBranch(branchId, event, data) {
  if (_io && branchId) {
    _io.to(`branch:${branchId}`).emit(event, data);
  }
}

module.exports = { init, emitToBranch };
