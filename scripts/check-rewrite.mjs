import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(scriptDir, "..", "public");
const config = JSON.parse(fs.readFileSync(path.join(publicRoot, "vercel.json"), "utf8"));
const rewrites = Array.isArray(config.rewrites) ? config.rewrites : [];
const redirects = Array.isArray(config.redirects) ? config.redirects : [];

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

function matchRedirect(pathname) {
  for (const redirect of redirects) {
    const source = String(redirect.source || "");
    const { regex, names } = compileSource(source);
    const match = pathname.match(regex);
    if (!match) continue;

    const params = Object.fromEntries(names.map((name, index) => [name, match[index + 1]]));
    const destination = String(redirect.destination || "").replace(
      /:([A-Za-z0-9_]+)/g,
      (token, name) => params[name] ?? token
    );
    return {
      source,
      destination,
      status: redirect.permanent ? 308 : 307,
    };
  }
  return null;
}

const server = http.createServer((request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    let pathname = decodeURIComponent(url.pathname);

    const redirect = matchRedirect(pathname);
    if (redirect) {
      response.writeHead(redirect.status, {
        location: redirect.destination,
        "cache-control": "no-store",
      });
      response.end();
      return;
    }

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

  const ticketResponse = await fetch(`${base}/t/ABC123`, { redirect: "manual" });
  const ticketLocation = ticketResponse.headers.get("location") || "";
  assert.ok(
    ticketResponse.status === 307 || ticketResponse.status === 308,
    "/t/ABC123 did not return a redirect"
  );
  assert.equal(
    new URL(ticketLocation, base).pathname,
    "/checkin",
    "/t/ABC123 did not redirect to /checkin"
  );

  const adminResponse = await fetch(`${base}/admin`);
  const adminBody = await adminResponse.text();
  assert.equal(adminResponse.status, 200, "/admin did not return 200");
  assert.ok(adminBody.includes('id="adminApp"'), "admin.html was not served");

  const checkinResponse = await fetch(`${base}/checkin`);
  const checkinBody = await checkinResponse.text();
  assert.equal(checkinResponse.status, 200, "/checkin did not return 200");
  assert.ok(checkinBody.includes('id="gate"'), "checkin.html gate is missing");
  assert.ok(checkinBody.includes('id="checkinApp"'), "checkin.html app is missing");
  assert.ok(checkinBody.includes('id="scanVideo"'), "checkin.html scanner is missing");

  console.log(`ok /t/ABC123 -> ${ticketResponse.status} /checkin`);
  console.log("ok /admin -> admin.html");
  console.log("ok /checkin -> checkin.html");
} catch (error) {
  exitCode = 1;
  console.log(`failed: ${error && error.message ? error.message : "unknown"}`);
} finally {
  if (server.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
  process.exitCode = exitCode;
}
