import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { emitInitialSnapshots, registerLiveIo } from "./live-events.js";

export function initLiveSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: true },
    path: "/socket.io",
  });

  registerLiveIo(io);

  io.on("connection", (socket) => {
    emitInitialSnapshots();
    socket.emit("dashboard:connected");
  });

  return io;
}
