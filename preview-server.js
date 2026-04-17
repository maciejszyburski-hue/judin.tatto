const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

loadDotEnv(path.join(__dirname, ".env"));

const port = process.env.PORT || 4335;
const baseDir = __dirname;
const basePath = path.resolve(baseDir);
const sessionCookieName = "judin_admin_session";
const sessionLifetimeMs = 1000 * 60 * 60 * 8;
const adminLogin = process.env.ADMINPANEL_LOGIN || "";
const adminPassword = process.env.ADMINPANEL_PASSWORD || "";
const recaptchaSiteKey = process.env.RECAPTCHA_SITE_KEY || "";
const recaptchaSecretKey = process.env.RECAPTCHA_SECRET_KEY || "";
const resendApiKey = process.env.RESEND_API_KEY || "";
const mailFrom = process.env.MAIL_FROM || "";
const mailTo = process.env.MAIL_TO || "";
const mailReplyTo = process.env.MAIL_REPLY_TO || "";
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

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

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

function emailDeliveryConfigured() {
  return Boolean(resendApiKey && mailFrom && mailTo);
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
  fs.stat(filePath, (statError, stats) => {
    if (statError) {
      sendText(res, statError.code === "ENOENT" ? 404 : 500, statError.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || "application/octet-stream";
    const baseHeaders = {
      "Content-Type": contentType,
      "Cache-Control": options.noStore ? "no-store" : "public, max-age=300",
      "Accept-Ranges": "bytes",
    };

    const rangeHeader = options.req && options.req.headers ? options.req.headers.range : "";
    if (rangeHeader && /^bytes=/.test(rangeHeader)) {
      const [rawStart, rawEnd] = rangeHeader.replace(/bytes=/, "").split("-");
      const start = rawStart ? Number(rawStart) : 0;
      const end = rawEnd ? Number(rawEnd) : stats.size - 1;

      if (
        Number.isNaN(start) ||
        Number.isNaN(end) ||
        start < 0 ||
        end < start ||
        start >= stats.size
      ) {
        writeHead(res, 416, {
          ...baseHeaders,
          "Content-Range": `bytes */${stats.size}`,
        });
        res.end();
        return;
      }

      writeHead(res, 206, {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${stats.size}`,
        "Content-Length": end - start + 1,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    writeHead(res, 200, {
      ...baseHeaders,
      "Content-Length": stats.size,
    });
    fs.createReadStream(filePath).pipe(res);
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

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateForEmail(dateValue) {
  if (!dateValue) return "Nie podano";
  const date = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateValue;
  return date.toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function normalizeEmailRecipients(value) {
  return String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function bookingSummaryLines(booking) {
  return [
    ["Imię", booking.name],
    ["Telefon", booking.phone],
    ["Email", booking.email],
    ["Usługa", booking.service || "Konsultacja"],
    ["Instagram", booking.instagram || "Nie podano"],
    ["Data", formatDateForEmail(booking.date)],
    ["Godzina", booking.time],
    ["Opis", booking.notes || "Brak dodatkowych informacji"],
  ];
}

function createOwnerEmailHtml(booking) {
  const rows = bookingSummaryLines(booking)
    .map(([label, value]) => `<tr><td style="padding:8px 12px 8px 0;color:#7f7b73;font-size:13px;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:8px 0;color:#111;font-size:15px;vertical-align:top;">${escapeHtml(value)}</td></tr>`)
    .join("");

  return `<!doctype html>
<html lang="pl">
  <body style="margin:0;padding:24px;background:#f5f1ea;font-family:Arial,sans-serif;color:#111;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#7f7b73;">Nowe zgłoszenie</p>
      <h1 style="margin:0 0 24px;font-size:28px;line-height:1.1;">Rezerwacja z formularza Judin Tattoo</h1>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
    </div>
  </body>
</html>`;
}

function createOwnerEmailText(booking) {
  return `Nowe zgłoszenie z formularza Judin Tattoo

Imię: ${booking.name}
Telefon: ${booking.phone}
Email: ${booking.email}
Usługa: ${booking.service || "Konsultacja"}
Instagram: ${booking.instagram || "Nie podano"}
Data: ${formatDateForEmail(booking.date)}
Godzina: ${booking.time}
Opis: ${booking.notes || "Brak dodatkowych informacji"}`;
}

function createClientEmailHtml(booking) {
  return `<!doctype html>
<html lang="pl">
  <body style="margin:0;padding:24px;background:#0e0d10;font-family:Arial,sans-serif;color:#f5f1ea;">
    <div style="max-width:640px;margin:0 auto;background:#17161a;border-radius:12px;padding:32px;">
      <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#b8b2a6;">Judin Tattoo</p>
      <h1 style="margin:0 0 18px;font-size:28px;line-height:1.15;color:#ffffff;">Dziękujemy za wysłanie zgłoszenia</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:#e9e2d6;">Cześć ${escapeHtml(booking.name)}, otrzymaliśmy Twoją prośbę o rezerwację terminu.</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:#e9e2d6;">Wybrany termin: <strong>${escapeHtml(formatDateForEmail(booking.date))}</strong> o <strong>${escapeHtml(booking.time)}</strong>.</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:#e9e2d6;">Skontaktujemy się z Tobą, aby potwierdzić wizytę i omówić szczegóły projektu.</p>
      <p style="margin:0;font-size:14px;line-height:1.7;color:#b8b2a6;">Jeśli chcesz coś doprecyzować, odpisz na tę wiadomość albo napisz bezpośrednio do studia.</p>
    </div>
  </body>
</html>`;
}

function createClientEmailText(booking) {
  return `Dziękujemy za wysłanie zgłoszenia.

Cześć ${booking.name},
otrzymaliśmy Twoją prośbę o rezerwację terminu:
${formatDateForEmail(booking.date)} o ${booking.time}

Skontaktujemy się z Tobą, aby potwierdzić wizytę i omówić szczegóły projektu.

Judin Tattoo`;
}

async function sendResendEmail(payload) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "judin-tattoo/1.0",
    },
    body: JSON.stringify(payload),
  });

  let result = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }

  if (!response.ok) {
    const message = result && typeof result.message === "string" ? result.message : "resend-request-failed";
    throw new Error(message);
  }

  return result;
}

async function sendBookingEmails(booking) {
  const recipients = normalizeEmailRecipients(mailTo);
  const replyTo = mailReplyTo || undefined;

  await sendResendEmail({
    from: mailFrom,
    to: recipients,
    subject: `Nowe zgłoszenie: ${booking.name} - ${formatDateForEmail(booking.date)} ${booking.time}`,
    html: createOwnerEmailHtml(booking),
    text: createOwnerEmailText(booking),
    replyTo,
  });

  await sendResendEmail({
    from: mailFrom,
    to: [booking.email],
    subject: "Potwierdzenie otrzymania zgłoszenia - Judin Tattoo",
    html: createClientEmailHtml(booking),
    text: createClientEmailText(booking),
    replyTo,
  });
}

/* ── Rate limiting: max 3 zgłoszeń / godzinę per IP ── */
const ipSubmissions = new Map();
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 3;

function isRateLimited(ip) {
  const now = Date.now();
  const times = (ipSubmissions.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (times.length >= RATE_MAX) return true;
  times.push(now);
  ipSubmissions.set(ip, times);
  return false;
}

/* Czyść starą mapę co godzinę żeby nie zajmowała pamięci */
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  for (const [ip, times] of ipSubmissions) {
    const filtered = times.filter(t => t > cutoff);
    if (filtered.length === 0) ipSubmissions.delete(ip);
    else ipSubmissions.set(ip, filtered);
  }
}, RATE_WINDOW_MS);



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

    if (requestPath === "/api/recaptcha/config") {
      sendJson(res, 200, {
        enabled: Boolean(recaptchaSiteKey && recaptchaSecretKey),
        siteKey: recaptchaSiteKey || null,
      });
      return;
    }

    if (requestPath === "/api/recaptcha/verify") {
      if (req.method !== "POST") {
        sendJson(res, 405, { success: false, error: "method-not-allowed" });
        return;
      }

      if (!recaptchaSiteKey || !recaptchaSecretKey) {
        sendJson(res, 503, { success: false, error: "recaptcha-not-configured" });
        return;
      }

      let token = "";
      try {
        const rawBody = await readBody(req);
        const body = JSON.parse(rawBody || "{}");
        token = typeof body.token === "string" ? body.token : "";
      } catch {
        sendJson(res, 400, { success: false, error: "invalid-json" });
        return;
      }

      if (!token) {
        sendJson(res, 400, { success: false, error: "missing-token" });
        return;
      }

      const result = await verifyRecaptchaToken(token, req);
      sendJson(res, result.success ? 200 : 400, result);
      return;
    }

    if (requestPath === "/api/bookings") {
      if (req.method !== "POST") {
        sendJson(res, 405, { success: false, error: "method-not-allowed" });
        return;
      }

      if (!emailDeliveryConfigured()) {
        sendJson(res, 503, { success: false, error: "email-not-configured" });
        return;
      }

      let body = null;
      try {
        const rawBody = await readBody(req);
        body = JSON.parse(rawBody || "{}");
      } catch {
        sendJson(res, 400, { success: false, error: "invalid-json" });
        return;
      }

      /* ── Honeypot: boty wypełniają ukryte pole ── */
      const honeypot = typeof body.hp === "string" ? body.hp : "";
      if (honeypot) {
        sendJson(res, 200, { success: true }); /* cicho udajemy sukces */
        return;
      }

      /* ── Timing: zbyt szybkie wysłanie = bot ── */
      const elapsed = typeof body.elapsed === "number" ? body.elapsed : 9999;
      if (elapsed < 3000) {
        sendJson(res, 200, { success: true }); /* j.w. */
        return;
      }

      /* ── Rate limiting: max 3 / godzinę per IP ── */
      const senderIp = getRemoteIp(req);
      if (isRateLimited(senderIp)) {
        sendJson(res, 429, { success: false, error: "rate-limited" });
        return;
      }

      const booking = {
        name:      typeof body.name      === "string" ? body.name.trim()      : "",
        phone:     typeof body.phone     === "string" ? body.phone.trim()     : "",
        email:     typeof body.email     === "string" ? body.email.trim()     : "",
        service:   typeof body.service   === "string" ? body.service.trim()   : "",
        instagram: typeof body.instagram === "string" ? body.instagram.trim() : "",
        notes:     typeof body.notes     === "string" ? body.notes.trim()     : "",
        date:      typeof body.date      === "string" ? body.date.trim()      : "",
        time:      typeof body.time      === "string" ? body.time.trim()      : "",
      };

      if (!booking.name || !booking.phone || !booking.email || !booking.date || !booking.time) {
        sendJson(res, 400, { success: false, error: "missing-fields" });
        return;
      }

      if (!isValidEmail(booking.email)) {
        sendJson(res, 400, { success: false, error: "invalid-email" });
        return;
      }

      try {
        await sendBookingEmails(booking);
      } catch (error) {
        console.error("Email delivery failed:", error);
        sendJson(res, 502, { success: false, error: "email-delivery-failed" });
        return;
      }

      sendJson(res, 200, { success: true });
      return;
    }

    if (requestPath === "/admin" || requestPath === "/admin/") {
      redirect(res, "/admin/login");
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
        redirect(res, "/admin/index.html");
        return;
      }

      serveFile(res, path.join(baseDir, "admin", "login.html"), {noStore: true, req});
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
    serveFile(res, filePath, {noStore: requestPath.startsWith("/admin/"), req});
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

