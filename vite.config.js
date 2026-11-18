import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolveSiteUrl } from "./scripts/siteUrl.mjs";

function htmlSiteUrlPlugin() {
  return {
    name: "html-site-url",
    transformIndexHtml(html) {
      return html.replaceAll("__SITE_URL__", resolveSiteUrl(process.env));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), htmlSiteUrlPlugin()],
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: "build",
    emptyOutDir: true,
  },
});
