import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const deriveKey = promisify(scrypt);
const app = express();

const PORT = Number(process.env.PORT) || 3001;
const BASE_URL = (
  process.env.BASE_URL || `http://localhost:${PORT}`
).replace(/\/$/, "");
const FRONTEND_URL = (
  process.env.FRONTEND_URL || "http://localhost:5173"
).replace(/\/$/, "");

// Temporary storage: all records are lost when this process restarts.
const records = new Map();
const clone = value => value ? structuredClone(value) : null;
const links = {
  find(query) {
    let sortSpec = null;
    let limitValue = Infinity;
    const cursor = {
      sort(spec) { sortSpec = spec; return cursor; },
      limit(value) { limitValue = value; return cursor; },
      async toArray() {
        let rows = [...records.values()].filter(row => row.owner === query.owner);
        if (sortSpec?.created === -1) rows.sort((a,b) => b.created-a.created);
        return rows.slice(0,limitValue).map(clone);
      }
    };
    return cursor;
  },
  async findOne({alias}) { return clone(records.get(alias)); },
  async insertOne(link) {
    if (records.has(link.alias)) throw Object.assign(new Error("Alias already taken"),{code:11000});
    const insertedId = randomBytes(12).toString("hex");
    records.set(link.alias,clone({...link,_id:insertedId}));
    return {insertedId};
  },
  async findOneAndUpdate(filter,update) {
    const row = records.get(filter.alias);
    const now = new Date();
    if (!row || unavailable(row,now)) return null;
    // No await between checking and updating: atomic within one Node process.
    row.accesses += update.$inc?.accesses || 0;
    Object.assign(row,update.$set || {});
    return clone(row);
  }
};
console.log("Storage mode: temporary memory. Links reset on restart.");

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: "12kb" }));
app.use(express.urlencoded({ extended: false, limit: "2kb" }));

// Anonymous browser session for private link history.
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");

  const cookie = req.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("sw_session="))
    ?.slice(11);

  req.session = /^[a-f0-9]{48}$/.test(cookie || "")
    ? cookie
    : randomBytes(24).toString("hex");

  if (req.session !== cookie) {
    res.cookie("sw_session", req.session, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: 365 * 24 * 60 * 60 * 1000,
      path: "/",
    });
  }

  next();
});

app.use(
  "/api",
  rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests. Try again in a minute." },
  }),
);

const accessLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

// Custom header + origin check protects API writes from cross-site forms.
app.use("/api", (req, res, next) => {
  if (req.method !== "POST") return next();

  if (req.get("X-Shortwave-Client") !== "web") {
    return res.status(403).json({
      error: "Include the X-Shortwave-Client: web header.",
    });
  }

  const origin = req.get("Origin");

  if (origin && ![FRONTEND_URL, BASE_URL].includes(origin)) {
    return res.status(403).json({ error: "Origin not allowed." });
  }

  next();
});

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function validateUrl(value) {
  if (typeof value !== "string" || value.length > 4096) {
    fail("Enter a URL under 4,096 characters.");
  }

  let url;

  try {
    url = new URL(value.trim());
  } catch {
    fail("Enter a complete URL starting with https:// or http://.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    fail("Only HTTP and HTTPS URLs are allowed.");
  }

  if (url.username || url.password) {
    fail("URLs containing login credentials are not allowed.");
  }

  const host = url.hostname.toLowerCase();

  if (
    !host.includes(".") ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    host.startsWith("[")
  ) {
    fail("Use a public domain name, not a local address or IP.");
  }

  return url.href;
}

function parseInteger(value, name, max, optional = false) {
  if (optional && (value == null || value === "")) return null;

  if (!["string", "number"].includes(typeof value)) {
    fail(`${name} must be a whole number.`);
  }

  const number = Number(value);
  const min = optional ? 1 : 0;

  if (!Number.isSafeInteger(number) || number < min || number > max) {
    fail(`${name} must be between ${min} and ${max}.`);
  }

  return number;
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await deriveKey(password, salt, 64);
  return `${salt}:${hash.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  if (!storedHash) return true;

  if (typeof password !== "string" || password.length > 128) {
    return false;
  }

  const [salt, hex] = storedHash.split(":");
  const expected = Buffer.from(hex, "hex");
  const actual = await deriveKey(password, salt, 64);

  return (
    expected.length === actual.length &&
    timingSafeEqual(expected, actual)
  );
}

function unavailable(link, now = new Date()) {
  if (link.expires && link.expires <= now) {
    return { message: "This link has expired.", status: 410 };
  }

  if (link.maxAccesses && link.accesses >= link.maxAccesses) {
    return { message: "Access limit reached.", status: 410 };
  }

  if (link.nextAccessAt && link.nextAccessAt > now) {
    return {
      message: "Cooldown active. Please try again later.",
      status: 429,
    };
  }

  return null;
}

async function checkReputation(url) {
  if (!process.env.REPUTATION_API_URL) return "basic";

  let result;

  try {
    const response = await fetch(process.env.REPUTATION_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.REPUTATION_API_KEY
          ? { Authorization: `Bearer ${process.env.REPUTATION_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) throw new Error();
    result = await response.json();
  } catch {
    fail("Reputation service unavailable. Try again later.", 503);
  }

  if (result.safe === false) fail("This URL was flagged as unsafe.");
  if (result.safe !== true) fail("Invalid reputation response.", 503);

  return "verified";
}

function serialize(link) {
  return {
    id: link._id.toString(),
    alias: link.alias,
    url: link.url,
    shortUrl: `${BASE_URL}/s/${link.alias}`,
    created: link.created,
    expires: link.expires,
    accesses: link.accesses,
    maxAccesses: link.maxAccesses,
    cooldownSeconds: link.cooldownSeconds,
    nextAccessAt: link.nextAccessAt,
    passwordProtected: Boolean(link.passwordHash),
    status: unavailable(link)?.message || "available",
    safety: link.safety,
  };
}

// Startup health.
app.get("/api/health", (req,res) => {
  res.json({status:"ok",server:"running",storage:"memory",persistent:false});
});

// Current browser's history. Password hashes are never returned.
app.get("/api/links", async (req, res) => {
  const records = await links
    .find({ owner: req.session })
    .sort({ created: -1 })
    .limit(100)
    .toArray();

  res.json(records.map(serialize));
});

// Basic validation + optional reputation provider.
app.post("/api/check", async (req, res) => {
  const url = validateUrl(req.body?.url);
  const safety = await checkReputation(url);

  res.json({
    url,
    safety,
    message:
      safety === "verified"
        ? "Reputation provider approved this URL."
        : "Basic validation passed. Reputation has not been checked.",
  });
});

// Create a persistent short link.
app.post("/api/links", async (req, res) => {
  const body = req.body || {};
  const url = validateUrl(body.url);

  const alias =
    body.alias == null || body.alias === ""
      ? randomBytes(8).toString("base64url")
      : body.alias;

  if (
    typeof alias !== "string" ||
    !/^[A-Za-z0-9_-]{3,48}$/.test(alias)
  ) {
    fail("Alias must contain 3–48 letters, numbers, - or _.");
  }

  const maxAccesses = parseInteger(
    body.maxAccesses,
    "Access limit",
    1_000_000,
    true,
  );

  const cooldownSeconds = parseInteger(
    body.cooldownSeconds ?? 0,
    "Cooldown",
    86_400,
  );

  let expires = null;

  if (body.expires) {
    if (typeof body.expires !== "string") {
      fail("Expiry must be an ISO date string.");
    }

    expires = new Date(body.expires);

    if (!Number.isFinite(expires.getTime()) || expires <= new Date()) {
      fail("Choose a valid future expiry date.");
    }
  }

  const password = body.password ?? "";

  if (
    typeof password !== "string" ||
    (password && (password.length < 8 || password.length > 128))
  ) {
    fail("Password must contain 8–128 characters.");
  }

  const safety = await checkReputation(url);

  const link = {
    owner: req.session,
    alias,
    url,
    created: new Date(),
    expires,
    maxAccesses,
    cooldownSeconds,
    accesses: 0,
    nextAccessAt: null,
    passwordHash: password ? await hashPassword(password) : null,
    safety,
  };

  const result = await links.insertOne(link);
  link._id = result.insertedId;

  res.status(201).json(serialize(link));
});

// Atomically count a successful access.
// Expiry, limit and cooldown are checked again after password verification.
async function consumeAccess(alias, password) {
  const link = await links.findOne({ alias });

  if (!link) fail("Link not found.", 404);

  const blocked = unavailable(link);
  if (blocked) fail(blocked.message, blocked.status);

  if (!(await verifyPassword(password, link.passwordHash))) {
    fail("Incorrect password.", 401);
  }

  const now = new Date();

  const updated = await links.findOneAndUpdate(
    {
      alias,
      $and: [
        { $or: [{ expires: null }, { expires: { $gt: now } }] },
        {
          $or: [
            { maxAccesses: null },
            { $expr: { $lt: ["$accesses", "$maxAccesses"] } },
          ],
        },
        {
          $or: [
            { nextAccessAt: null },
            { nextAccessAt: { $lte: now } },
          ],
        },
      ],
    },
    {
      $inc: { accesses: 1 },
      $set: {
        lastAccess: now,
        nextAccessAt: new Date(
          now.getTime() + link.cooldownSeconds * 1000,
        ),
      },
    },
    { returnDocument: "after" },
  );

  if (!updated) {
    fail("Access is no longer available. Try again.", 409);
  }

  return updated;
}

// For a React password form. This endpoint consumes one access.
app.post(
  "/api/links/:alias/access",
  accessLimiter,
  async (req, res) => {
    const link = await consumeAccess(
      req.params.alias,
      req.body?.password,
    );

    res.json({ url: link.url, accesses: link.accesses });
  },
);

function escapeHtml(value) {
  const replacements = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  return String(value).replace(
    /[&<>"']/g,
    (character) => replacements[character],
  );
}

function renderPage(res, title, content, status = 200) {
  const nonce = randomBytes(16).toString("base64");

  res.set(
    "Content-Security-Policy",
    `default-src 'none'; style-src 'nonce-${nonce}'; ` +
      "form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );

  res.status(status).type("html").send(`
    <!doctype html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>${escapeHtml(title)} · Shortwave</title>
      <style nonce="${nonce}">
        body {
          margin: 0; min-height: 100vh; display: grid;
          place-items: center; background: #f5f8f7;
          color: #203645; font-family: system-ui;
        }
        main {
          width: min(380px, 80vw); padding: 32px;
          background: white; border-radius: 18px;
          border: 1px solid #dfe9e3;
        }
        h1 { font-size: 26px; }
        p { color: #72847a; line-height: 1.6; }
        input, button {
          box-sizing: border-box; width: 100%; padding: 13px;
          margin-top: 12px; border-radius: 7px;
          border: 1px solid #d8e3dd; font: inherit;
        }
        button { background: #188269; color: white; cursor: pointer; }
        a, small { color: #188269; }
      </style>
    </head>
    <body>
      <main>
        <small>SHORTWAVE</small>
        <h1>${escapeHtml(title)}</h1>
        ${content}
      </main>
    </body>
    </html>
  `);
}

// Public short URL: redirect immediately or show a password gate.
app.get("/s/:alias", accessLimiter, async (req, res) => {
  const link = await links.findOne({ alias: req.params.alias });

  if (!link) {
    return renderPage(
      res,
      "Link not found",
      "<p>Check the address and try again.</p>",
      404,
    );
  }

  const blocked = unavailable(link);

  if (blocked) {
    return renderPage(
      res,
      "Link unavailable",
      `<p>${escapeHtml(blocked.message)}</p>`,
      blocked.status,
    );
  }

  if (link.passwordHash) {
    return renderPage(
      res,
      "This link is protected",
      `
        <p>Enter the password shared by the sender.</p>
        <form method="POST" action="/s/${escapeHtml(link.alias)}">
          <input type="hidden" name="token" value="${req.session}">
          <label for="password">Password</label>
          <input id="password" name="password" type="password"
            maxlength="128" required autofocus autocomplete="off">
          <button type="submit">Unlock link</button>
        </form>
      `,
    );
  }

  try {
    const accessed = await consumeAccess(link.alias, "");
    res.redirect(302, accessed.url);
  } catch (error) {
    if (!error.status) throw error;

    renderPage(
      res,
      "Link unavailable",
      `<p>${escapeHtml(error.message)}</p>`,
      error.status,
    );
  }
});

// Password gate submission.
app.post("/s/:alias", accessLimiter, async (req, res) => {
  if (req.body?.token !== req.session) {
    return renderPage(
      res,
      "Please try again",
      "<p>Open the short link again to start a fresh attempt.</p>",
      403,
    );
  }

  try {
    const link = await consumeAccess(
      req.params.alias,
      req.body?.password,
    );

    res.redirect(303, link.url);
  } catch (error) {
    if (!error.status) throw error;

    renderPage(
      res,
      "Access denied",
      `<p>${escapeHtml(error.message)}</p>
       <a href="/s/${escapeHtml(req.params.alias)}">Try again</a>`,
      error.status,
    );
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "Route not found." });
});

app.use((error, req, res, next) => {
  if (error.code === 11000) {
    return res.status(409).json({
      error: "That alias is already taken.",
    });
  }

  if (error.status && error.status < 500) {
    return res.status(error.status).json({ error: error.message });
  }

  console.error("Request failed:", error.name);

  res.status(error.status || 500).json({
    error: "Service unavailable. Please try again later.",
  });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log("Backend listening on port", PORT);
  console.log("Health URL:", "http://localhost:" + PORT + "/api/health");
  console.log("Short-link base URL:", BASE_URL);

});
server.on("error", (error) => {
  console.error("Server could not start:", error.code);
  process.exit(1);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);