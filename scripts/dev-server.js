// Local stand-in for Vercel: serves dashboard/ and mounts api/*.js with the same (req, res) shape.
//   npm run dev   ->  http://localhost:3000
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const TYPES = { ".html": "text/html", ".json": "application/json", ".js": "text/javascript", ".css": "text/css" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const api = url.pathname.match(/^\/api\/(\w+)$/);
  if (api) {
    let body = "";
    for await (const chunk of req) body += chunk;
    req.query = Object.fromEntries(url.searchParams);
    req.body = body;
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
    try {
      await (await import(pathToFileURL(join(root, "api", `${api[1]}.js`)).href)).default(req, res);
    } catch (e) {
      if (e.code === "ERR_MODULE_NOT_FOUND" && String(e.message).includes(`${api[1]}.js`)) return res.status(404).json({ error: "no such endpoint" });
      console.error(e); res.status(500).json({ error: String(e.message) });
    }
    return;
  }
  const file = join(root, "dashboard", normalize(url.pathname === "/" ? "/index.html" : url.pathname));
  try {
    res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end("not found"); }
}).listen(3000, () => console.log("http://localhost:3000"));
