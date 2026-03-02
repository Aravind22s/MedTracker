import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Instant health check
  app.get("/api/health", (req, res) => res.json({ status: "ok" }));

  // Pre-load API routes in background
  let cachedApiRouter: any = null;
  const apiPromise = import("./src/server/api").then(m => {
    cachedApiRouter = m.apiRouter;
    console.log("API Router pre-loaded");
  }).catch(e => console.error("API Pre-load Error:", e));

  app.use("/api", async (req, res, next) => {
    try {
      if (!cachedApiRouter) {
        await apiPromise;
      }
      if (cachedApiRouter) {
        cachedApiRouter(req, res, next);
      } else {
        res.status(503).send("API initializing...");
      }
    } catch (e) {
      console.error("API Error:", e);
      res.status(500).send("API Error");
    }
  });

  // Start listening immediately
  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);

    // Vite middleware (initialized after port is bound)
    if (process.env.NODE_ENV !== "production") {
      try {
        const vite = await createViteServer({
          server: { middlewareMode: true },
          appType: "spa",
        });
        app.use(vite.middlewares);
        console.log("Vite middleware initialized");
      } catch (e) {
        console.error("Vite Init Error:", e);
      }
    } else {
      app.use(express.static(path.join(__dirname, "dist")));
      app.get("*", (req, res) => res.sendFile(path.join(__dirname, "dist", "index.html")));
    }
  });
}

startServer().catch(console.error);
