import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    target: ["es2018", "safari13"]
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3001",
      "/events": "http://127.0.0.1:3001"
    }
  }
});
