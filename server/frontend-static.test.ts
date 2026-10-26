import { afterAll, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serveFrontend } from "./services/frontend-static.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ifop-static-"));
fs.mkdirSync(path.join(root, "assets"));
fs.writeFileSync(path.join(root, "index.html"), "<html>Versión de prueba</html>");
fs.writeFileSync(path.join(root, "assets/index-Ab12_34-.js"), "export const version=1;");
fs.writeFileSync(path.join(root, "assets/logo.svg"), "<svg/>");
const app = express();
app.get("/api/private", (_req, res) => res.status(401).json({message:"Inicia sesión"}));
serveFrontend(app, root);
app.use((_req,res) => res.status(404).json({message:"Ruta no encontrada"}));
afterAll(() => fs.rmSync(root, {recursive:true,force:true}));

it("reuses hashed assets while HTML and mutable logos remain revalidatable", async () => {
  const asset = await request(app).get("/assets/index-Ab12_34-.js").expect(200);
  expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  for (const url of ["/", "/mis-calificaciones"]) {
    const html = await request(app).get(url).set("Accept", "text/html").expect(200);
    expect(html.headers["cache-control"]).toBe("no-cache");
  }
  const logo = await request(app).get("/assets/logo.svg").expect(200);
  expect(logo.headers["cache-control"]).not.toContain("immutable");
  expect(logo.headers["cache-control"]).toContain("max-age=0");
  fs.writeFileSync(path.join(root,"index.html"), "<html>Versión actualizada</html>");
  expect((await request(app).get("/mis-calificaciones").expect(200)).text).toContain("actualizada");
});

it("never replaces API errors with the frontend HTML or asset cache headers", async () => {
  await request(app).get("/api/private").set("Accept","text/html").expect(401);
  const unknown = await request(app).get("/api/missing").set("Accept","text/html").expect(404);
  expect(unknown.headers["content-type"]).toContain("application/json");
  expect(unknown.headers["cache-control"] ?? "").not.toContain("immutable");
});
