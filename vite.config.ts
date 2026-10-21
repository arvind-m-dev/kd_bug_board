import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

// Absolute site URL for link-preview images; Vercel provides its production domain at build time.
const vercelDomain = process.env["VERCEL_PROJECT_PRODUCTION_URL"];
const siteUrl = process.env["SITE_URL"] ?? (vercelDomain ? `https://${vercelDomain}` : "");

// Nitro picks the hosting target automatically (Vercel on Vercel, Node locally).
export default defineConfig(({ command }) => ({
  define: { "import.meta.env.VITE_SITE_URL": JSON.stringify(siteUrl) },
  server: { port: 8080 },
  resolve: {
    tsconfigPaths: true,
    dedupe: ["react", "react-dom", "@tanstack/react-query", "@tanstack/query-core"],
  },
  plugins: [
    tailwindcss(),
    // Use src/server.ts (our SSR error wrapper) as the server entry.
    tanstackStart({ server: { entry: "server" } }),
    ...(command === "build" ? [nitro()] : []),
    viteReact(),
  ],
}));
