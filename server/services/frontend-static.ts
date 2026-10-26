import express, { type Express } from "express";
import path from "node:path";

/** Only versioned build assets can be reused indefinitely; HTML must revalidate. */
export function serveFrontend(app: Express, directory: string) {
  app.use(express.static(directory, {
    setHeaders(res, filename) {
      if (/-[A-Za-z0-9_-]{8}\.(js|css|woff2?)$/.test(path.basename(filename))) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (filename.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    }
  }));
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api/") && req.path !== "/api" && req.accepts("html")) {
      res.set("Cache-Control", "no-cache");
      return res.sendFile(path.join(directory, "index.html"));
    }
    next();
  });
}
