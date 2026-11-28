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

function localIgdbApiDevPlugin(env) {
  return {
    name: "local-igdb-api-dev",
    configureServer(server) {
      server.middlewares.use("/api/igdb", async (req, res, next) => {
        if (req.url && req.url !== "/" && !req.url.startsWith("/?") && !req.url.startsWith("?")) {
          return next();
        }
        // Populate server-side IGDB env vars for local Vite dev (never exposed via VITE_*)
        for (const k of ["IGDB_CLIENT_ID", "IGDB_CLIENT_SECRET", "TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"]) {
          if (!process.env[k] && env[k]) {
            process.env[k] = env[k];
          }
        }
        try {
          const rawChunks = [];
          for await (const chunk of req) {
            rawChunks.push(chunk);
          }
          const rawBody = Buffer.concat(rawChunks).toString("utf8");
          const parsedUrl = new URL(req.url || "/", "http://localhost");
          const query = Object.fromEntries(parsedUrl.searchParams.entries());
          const mockReq = {
            method: req.method,
            headers: { ...req.headers, origin: req.headers.origin || "http://localhost:3000" },
            query,
            body: rawBody ? JSON.parse(rawBody) : {},
            socket: req.socket,
          };
          let statusCode = 200;
          const mockRes = {
            setHeader: (k, v) => res.setHeader(k, v),
            status(code) {
              statusCode = code;
              return this;
            },
            json(payload) {
              res.statusCode = statusCode;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify(payload));
              return this;
            },
          };
          const { default: igdbHandler } = await import("./api/igdb.js");
          await igdbHandler(mockReq, mockRes);
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: String(err?.message || "Local IGDB dev proxy error") }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  return {
    plugins: [react(), tailwindcss(), htmlSiteUrlPlugin(env), localIgdbApiDevPlugin(env)],
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
