import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const DEV_UI_PORT = 5173;
const DEV_API_PORT = 3000;

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: DEV_UI_PORT,
    proxy: {
      "/api": `http://127.0.0.1:${DEV_API_PORT}`,
    },
  },
});
