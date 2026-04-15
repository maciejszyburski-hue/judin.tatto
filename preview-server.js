const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const port = process.env.PORT || 4335;
const baseDir = __dirname;
const basePath = path.resolve(baseDir);
const sessionCookieName = "judin_admin_session";
const sessionLifetimeMs = 1000 * 60 * 60 * 8;
const adminLogin = process.env.ADMINPANEL_LOGIN || "";
const adminPassword = process.env.ADMINPANEL_PASSWORD || "";
const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY || "";
const turnstileSecretKey = process.env.TURNSTILE_SECRET_KEY || "";
const sessionSecret =
  process.env.ADMIN_SESSION_SECRET ||
  `${adminLogin}:${adminPassword}:${process.env.RAILWAY_STATIC_URL || "judin-admin"}`;

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

function parseCookies(headerValue) {
  if (!headerValue) return {};
  return headerValue.split(";").reduce((cookies, chunk) => {
    try {
      const index = chunk.indexOf("=");
      if (index === -1) return cookies;
      const key = chunk.slice(0, index).trim();
      const value = chunk.slice(index + 1).trim();
      cookies[key] = decodeURIComponent(value);
    } catch {
      return cookies;
    }
    return cookies;
  }, {});
}

function createSignature(payload) {
  return crypto.createHmac("sha256", sessionSecret).update(payload).digest("hex");
}

function createSessionValue() {
  const expiresAt = String(Date.now() + sessionLifetimeMs);
  return `${expiresAt}.${createSignature(expiresAt)}`;
}

function isValidSession(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const raw = cookies[sessionCookieName];
  if (!raw) return false;
  const [expiresAt, signature] = raw.split(".");
  if (!expiresAt || !signature) return false;
  if (!/^\d+$/.test(expiresAt)) return false;
  if (Number(expiresAt) < Date.now()) return false;
  const expected = createSignature(expiresAt);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function credentialsConfigured() {
  return Boolean(adminLogin && adminPassword);
}

function safeEquals(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isSecureRequest(req) {
  return req.headers["x-forwarded-proto"] === "https" || Boolean(req.socket.encrypted);
}

function writeHead(res, statusCode, headers = {}) {
  res.writeHead(statusCode, {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
}

function redirect(res, location, extraHeaders = {}) {
  writeHead(res, 302, {
    Location: location,
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end();
}

function sendText(res, statusCode, message) {
  writeHead(res, statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(message);
}

function sendJson(res, statusCode, payload) {
  writeHead(res, statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function buildSessionCookie(req) {
  const parts = [
    `${sessionCookieName}=${encodeURIComponent(createSessionValue())}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(sessionLifetimeMs / 1000)}`,
  ];
  if (isSecureRequest(req)) parts.push("Secure");
  return parts.join("; ");
}

function buildExpiredSessionCookie(req) {
  const parts = [
    `${sessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (isSecureRequest(req)) parts.push("Secure");
  return parts.join("; ");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk.toString("utf8");
      if (body.length > 10000) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function serveFile(res, filePath, options = {}) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendText(res, error.code === "ENOENT" ? 404 : 500, error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    writeHead(res, 200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": options.noStore ? "no-store" : "public, max-age=300",
    });
    res.end(content);
  });
}

function getRemoteIp(req) {
  return (
    req.headers["cf-connecting-ip"] ||
    req.headers["x-forwarded-for"] ||
    req.socket.remoteAddress ||
    ""
  );
}

async function verifyTurnstileToken(token, req) {
  if (!turnstileSecretKey) {
    return {success: false, "error-codes": ["missing-input-secret"]};
  }

  const formData = new FormData();
  formData.append("secret", turnstileSecretKey);
  formData.append("response", token);

  const remoteIp = getRemoteIp(req);
  if (remoteIp) formData.append("remoteip", remoteIp);

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData,
    });
    return await response.json();
  } catch {
    return {success: false, "error-codes": ["internal-error"]};
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    let requestPath = decodeURIComponent(url.pathname);
    const authenticated = isValidSession(req);

    if (/(^|\/)(index\.html|galeria\.html)\/admin\/?$/.test(requestPath)) {
      redirect(res, "/admin");
      return;
    }

    if (/(^|\/)(index\.html|galeria\.html)\/admin\/login\/?$/.test(requestPath)) {
      redirect(res, "/admin/login");
      return;
    }

    if (requestPath === "/api/turnstile/config") {
      sendJson(res, 200, {
        enabled: Boolean(turnstileSiteKey && turnstileSecretKey),
        siteKey: turnstileSiteKey || null,
      });
      return;
    }

    if (requestPath === "/api/turnstile/verify") {
      if (req.method !== "POST") {
        sendJson(res, 405, {success: false, error: "method-not-allowed"});
        return;
      }

      if (!turnstileSiteKey || !turnstileSecretKey) {
        sendJson(res, 503, {success: false, error: "turnstile-not-configured"});
        return;
      }

      let token = "";
      try {
        const rawBody = await readBody(req);
        const body = JSON.parse(rawBody || "{}");
        token = typeof body.token === "string" ? body.token : "";
      } catch {
        sendJson(res, 400, {success: false, error: "invalid-json"});
        return;
      }

      if (!token) {
        sendJson(res, 400, {success: false, error: "missing-token"});
        return;
      }

      const result = await verifyTurnstileToken(token, req);
      sendJson(res, result.success ? 200 : 400, result);
      return;
    }

    if (requestPath === "/admin" || requestPath === "/admin/") {
      redirect(res, authenticated ? "/admin/index.html" : "/admin/login");
      return;
    }

    if (requestPath === "/admin/login" || requestPath === "/admin/login.html") {
      if (req.method === "POST") {
        if (!credentialsConfigured()) {
          sendText(res, 503, "Admin credentials are not configured.");
          return;
        }

        try {
          const rawBody = await readBody(req);
          const form = new URLSearchParams(rawBody);
          const login = form.get("login") || "";
          const password = form.get("password") || "";
          if (safeEquals(login, adminLogin) && safeEquals(password, adminPassword)) {
            redirect(res, "/admin", {
              "Set-Cookie": buildSessionCookie(req),
            });
            return;
          }
        } catch {
          redirect(res, "/admin/login?error=1");
          return;
        }

        redirect(res, "/admin/login?error=1");
        return;
      }

      if (authenticated) {
        redirect(res, "/admin");
        return;
      }

      serveFile(res, path.join(baseDir, "admin", "login.html"), {noStore: true});
      return;
    }

    if (requestPath === "/admin/logout") {
      redirect(res, "/admin/login", {
        "Set-Cookie": buildExpiredSessionCookie(req),
      });
      return;
    }

    if (requestPath.startsWith("/admin/") && !authenticated) {
      redirect(res, "/admin/login");
      return;
    }

    const target = requestPath === "/" ? "index.html" : requestPath.replace(/^[/\\]+/, "");
    let filePath = path.resolve(baseDir, target);

    if (filePath !== basePath && !filePath.startsWith(basePath + path.sep)) {
      sendText(res, 403, "Forbidden");
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
    serveFile(res, filePath, {noStore: requestPath.startsWith("/admin/")});
  } catch (error) {
    console.error("Request error:", error);
    if (!res.headersSent) {
      sendText(res, 500, "Server error");
    } else {
      res.end();
    }
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Judin preview running on port ${port}`);
});
