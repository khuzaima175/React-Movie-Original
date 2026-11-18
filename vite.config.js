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
    },
  };
});
