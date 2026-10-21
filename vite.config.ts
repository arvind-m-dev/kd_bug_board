import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

// Nitro picks the hosting target automatically (Vercel on Vercel, Node locally).
export default defineConfig(({ command }) => ({
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
