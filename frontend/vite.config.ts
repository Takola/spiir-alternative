import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");
    return {
        plugins: [react()],
        server: {
            host: env.SPIIR_FRONTEND_HOST || "127.0.0.1",
            port: 5173,
            proxy: {
                "/api": "http://127.0.0.1:8000",
                "/auth": "http://127.0.0.1:8000",
                "/status": "http://127.0.0.1:8000"
            }
        }
    };
});
