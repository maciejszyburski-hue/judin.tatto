const http = require("http");
const fs = require("fs");
const path = require("path");

const port = process.env.PORT || 4335;
const baseDir = __dirname;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
};

const server = http.createServer((req, res) => {
  const requestPath = req.url.split("?")[0];
  let target = requestPath === "/" ? "/index.html" : requestPath;

  if (target === "/admin" || target === "/admin/") {
    target = "/admin/index.html";
  }

  const safePath = decodeURIComponent(target).replace(/^[/\\]+/, "");
  let filePath = path.resolve(baseDir, safePath);
  const basePath = path.resolve(baseDir);

  if (filePath !== basePath && !filePath.startsWith(basePath + path.sep)) {
    res.writeHead(403, {"Content-Type": "text/plain; charset=utf-8"});
    res.end("Forbidden");
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(error.code === "ENOENT" ? 404 : 500, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    });
    res.end(content);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Judin preview running on port ${port}`);
});
