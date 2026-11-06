import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(scriptDir, "..", "public");
const config = JSON.parse(fs.readFileSync(path.join(publicRoot, "vercel.json"), "utf8"));
const rewrites = Array.isArray(config.rewrites) ? config.rewrites : [];

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileSource(source) {
  const names = [];
  const pattern = source
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        names.push(segment.slice(1));
        return "([^/]+)";
      }
      return escapeRegex(segment);
    })
    .join("/");
  return { regex: new RegExp(`^${pattern}/?$`), names };
}

function matchRewrite(pathname) {
  for (const rewrite of rewrites) {
    const source = String(rewrite.source || "");
    const { regex, names } = compileSource(source);
    const match = pathname.match(regex);
    if (!match) continue;

    const params = Object.fromEntries(names.map((name, index) => [name, match[index + 1]]));
    const destination = String(rewrite.destination || "").replace(
      /:([A-Za-z0-9_]+)/g,
      (token, name) => params[name] ?? token
    );
    return { source, destination };
  }
  return null;
}

const server = http.createServer((request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    let pathname = decodeURIComponent(url.pathname);
    const rewrite = matchRewrite(pathname);
    if (rewrite) pathname = rewrite.destination;
    if (pathname === "/") pathname = "/index.html";

    const relative = pathname.replace(/^\/+/, "");
    const filePath = path.resolve(publicRoot, relative);
    const rootWithSeparator = publicRoot.endsWith(path.sep) ? publicRoot : publicRoot + path.sep;

    if (filePath !== publicRoot && !filePath.startsWith(rootWithSeparator)) {
      response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }
      const type = contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
      response.writeHead(200, { "content-type": type });
      response.end(data);
    });
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Server error");
  }
});

let exitCode = 0;

try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const ticketResponse = await fetch(`${base}/t/ABC123`);
  const ticketBody = await ticketResponse.text();
  assert.equal(ticketResponse.status, 200, "/t/ABC123 did not return 200");
  assert.ok(ticketBody.includes('id="ticketStatus"'), "tickets.html page was not served");
  assert.ok(ticketBody.includes('id="ticketContent"'), "tickets.html ticket content is missing");
  assert.ok(ticketBody.includes('fetch("/api/tickets/"'), "tickets.html API lookup is missing");

  const adminResponse = await fetch(`${base}/admin`);
  const adminBody = await adminResponse.text();
  assert.equal(adminResponse.status, 200, "/admin did not return 200");
  assert.ok(adminBody.includes('id="adminApp"'), "admin.html was not served");

  console.log("ok /t/ABC123 -> tickets.html");
  console.log("ok /admin -> admin.html");
} catch (error) {
  exitCode = 1;
  console.log(`failed: ${error && error.message ? error.message : "unknown"}`);
} finally {
  if (server.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
  process.exitCode = exitCode;
}
