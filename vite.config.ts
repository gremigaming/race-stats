import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { telemetryServer } from "./src/plugin/telemetry-server";
import { resolveDevServerPort } from "./scripts/dev-server-port.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const devServerPort = resolveDevServerPort();
  const rawBase = env.VITE_BASE_PATH || "/";
  const leadingSlashBase = rawBase.startsWith("/") ? rawBase : `/${rawBase}`;
  const base = leadingSlashBase.endsWith("/")
    ? leadingSlashBase
    : `${leadingSlashBase}/`;

  return {
    base,
    server: {
      open: true,
      proxy: {
        // The replay bucket allows the production site origin, not localhost.
        // Proxy these requests in dev so browser CORS does not hide race data.
        "/__replays/": {
          target: "https://replays.gremigaming.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/__replays/, ""),
        },
        "/__replays-pages": {
          target: "https://gremigaming.github.io",
          changeOrigin: true,
          rewrite: (path) =>
            path.replace(/^\/__replays-pages/, "/race-stats/league/races"),
        },
        // The public league JSON is the recovery source when the live R2
        // publisher is unavailable. Proxy in dev so localhost can read it
        // without depending on GitHub Pages CORS headers.
        "/__league-pages/": {
          target: "https://gremigaming.github.io",
          changeOrigin: true,
          rewrite: (path) =>
            path.replace(/^\/__league-pages/, "/race-stats/league"),
        },
      },
      ...(devServerPort.port
        ? {
            port: devServerPort.port,
            strictPort: devServerPort.strict,
          }
        : {}),
    },
    plugins: [
      react(),
      tailwindcss(),
      telemetryServer(env.TELEMETRY_DIR, base),
    ],
  };
});
