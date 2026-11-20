import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolveSiteUrl } from "./scripts/siteUrl.mjs";

function htmlSiteUrlPlugin(env) {
  return {
    name: "html-site-url",
    transformIndexHtml(html) {
      return html.replaceAll("__SITE_URL__", resolveSiteUrl(env));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  return {
    plugins: [react(), tailwindcss(), htmlSiteUrlPlugin(env)],
    server: {
      port: 3000,
      open: true,
    },
    build: {
      outDir: "build",
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (
              id.includes("/react/") ||
              id.includes("/react-dom/") ||
              id.includes("/react-router") ||
              id.includes("/scheduler/")
            ) {
              return "vendor-react";
            }
            if (id.includes("/framer-motion/") || id.includes("/motion-")) {
              return "vendor-motion";
            }
            if (id.includes("/@supabase/")) {
              return "vendor-supabase";
            }
            if (id.includes("/@google/genai/")) {
              return "vendor-genai";
            }
            if (id.includes("/lucide-react/")) {
              return "vendor-icons";
            }
            return undefined;
          },
        },
      },
    },
  };
});
