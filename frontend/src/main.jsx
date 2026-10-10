import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { getLinks, createLink, accessLink } from "./api/api.js";
import { parseLimit } from "./access.js";
import { validateUrl } from "./validation.js";
import QRCode from "qrcode";
import {
  ArrowUpRight,
  ArrowRight,
  Link2,
  ShieldCheck,
  Clock,
  Copy,
  Check,
  QrCode,
  Download,
  Share2,
  X,
  Activity,
  Layers,
  Zap,
  Plus,
} from "lucide-react";
import "./style.css";

function statusLabel(status) {
  if (status === "available") return "Active";
  if (/expir/i.test(status || "")) return "Expired";
  if (/limit/i.test(status || "")) return "Limit reached";
  if (/cool/i.test(status || "")) return "Cooldown";
  return "Unavailable";
}

function App() {
  const [links, setLinks] = useState([]);
  const [url, setUrl] = useState("");
  const [alias, setAlias] = useState("");
  const [expires, setExpires] = useState("");
  const [password, setPassword] = useState("");
  const [maxAccesses, setMaxAccesses] = useState("");
  const [cooldown, setCooldown] = useState("0");

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState(null);
  const [qr, setQr] = useState(null);
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const [preview, setPreview] = useState(null);
  const [enteredPassword, setEnteredPassword] = useState("");
  const [accessMessage, setAccessMessage] = useState("");
  const [accessBusy, setAccessBusy] = useState(false);

  // Load history from the backend, not localStorage.
  useEffect(() => {
    let cancelled = false;
    let refreshing = false;

    async function refresh() {
      if (refreshing) return;
      refreshing = true;

      try {
        const records = await getLinks();

        if (!cancelled) {
          setLinks(records);
        }
      } catch (error) {
        if (!cancelled) {
          setError(error.message);
        }
      } finally {
        refreshing = false;

        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    refresh();

    const timer = setInterval(refresh, 15000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;

    setError("");
    setNotice("");
    setBusy(true);

    try {
      const target = validateUrl(url);
      const slug = alias.trim();

      if (slug && !/^[a-zA-Z0-9_-]{3,48}$/.test(slug)) {
        throw new Error(
          "Alias must contain 3–48 letters, numbers, hyphens or underscores."
        );
      }

      if (expires && Date.parse(expires) <= Date.now()) {
        throw new Error("Choose a future expiry date.");
      }

      const limit = parseLimit(maxAccesses);
      const seconds = Number(cooldown);

      if (
        !Number.isInteger(seconds) ||
        seconds < 0 ||
        seconds > 86400
      ) {
        throw new Error(
          "Cooldown must be between 0 and 86,400 seconds."
        );
      }

      if (
        password &&
        (password.length < 8 || password.length > 128)
      ) {
        throw new Error(
          "Password must contain 8–128 characters."
        );
      }

      // Backend generates the real short URL and hashes the password.
      const link = await createLink({
        url: target,
        alias: slug,
        password,
        expires: expires
          ? new Date(expires).toISOString()
          : null,
        maxAccesses: limit,
        cooldownSeconds: seconds,
      });

      setLinks((previous) =>
        [
          link,
          ...previous.filter((item) => item.id !== link.id),
        ].slice(0, 100)
      );

      setResult(link);
      setNotice("Link created and saved successfully.");

      setUrl("");
      setAlias("");
      setExpires("");
      setPassword("");
      setMaxAccesses("");
      setCooldown("0");
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function tryAccess(e) {
    e.preventDefault();
    if (accessBusy) return;

    setAccessBusy(true);
    setAccessMessage("");

    try {
      const link = links.find((item) => item.id === preview);

      if (!link) {
        throw new Error("Link not found.");
      }

      // Server checks password, expiry, limit and cooldown.
      const response = await accessLink(
        link.alias,
        enteredPassword
      );

      // A visit was already counted by the API.
      // Open the destination directly to avoid counting twice.
      window.location.assign(response.url);
  } catch (error) {
  setAccessMessage(error.message);
} finally {
  setAccessBusy(false);
}
  }

  async function copy(link) {
    try {
      setError("");
      await navigator.clipboard.writeText(link.shortUrl);
      setCopied(link.id);
      setNotice("Link copied to clipboard.");
      setTimeout(() => setCopied(""), 2000);
    } catch {
      setError(
        "Copy failed. Select and copy the link manually."
      );
    }
  }

  async function showQr(link) {
    try {
      setError("");

      const image = await QRCode.toDataURL(link.shortUrl, {
        width: 720,
        margin: 2,
        color: {
          dark: "#17243a",
          light: "#ffffff",
        },
      });

      setQr({ link, image });
    } catch {
      setError("Unable to generate QR code.");
    }
  }

  async function share(link) {
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Shortwave link",
          url: link.shortUrl,
        });
      } else {
        await copy(link);
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        setError("Sharing failed. Try copying the link.");
      }
    }
  }

  function openAccess(link) {
    setPreview(link.id);
    setEnteredPassword("");
    setAccessMessage("");
    setAccessBusy(false);
  }

  const active = links.filter(
    (link) => link.status === "available"
  ).length;

  const previewLink = links.find(
    (link) => link.id === preview
  );

  return (
    <div className="shell">
      <aside>
        <a className="brand" href="#">
          <span className="brand-icon">
            <Link2 size={23} />
          </span>
          shortwave
          <span className="brand-dot">.</span>
        </a>

        <span className="nav-label">WORKSPACE</span>

        <a className="nav active" href="#create">
          <Layers size={18} />
          Overview
          <span className="nav-dot" />
        </a>

        <a className="nav" href="#history">
          <Link2 size={18} />
          My links
          <span className="count">{links.length}</span>
        </a>

        <a
          className="nav"
          href="#create"
          onClick={() =>
            document.getElementById("long-url")?.focus()
          }
        >
          <Plus size={18} />
          Create a link
        </a>

        <div className="aside-card">
          <span className="spark">
            <Zap size={20} />
          </span>
          <h3>Little links. Big impact.</h3>
          <p>Make every connection a little simpler.</p>
          <a href="#create">
            Create a link <ArrowRight size={15} />
          </a>
        </div>

        <div className="profile">
          <span className="avatar">Y</span>
          <div>
            <strong>Your workspace</strong>
            <small>Personal link history</small>
          </div>
        </div>
      </aside>

      <div className="main">
        <header>
          <span>
            Workspace <span className="slash">/</span>
            <strong>Overview</strong>
          </span>
          <span className="demo-badge">
            Server-backed links
          </span>
        </header>

        <main>
          <div className="heading">
            <div>
              <span className="eyebrow">
                LESS LENGTH. MORE POSSIBILITY.
              </span>
              <h1>
                Small links, <em>big ideas.</em>
              </h1>
              <p>
                Give your URLs a fresh start. Shorten,
                customize, and share.
              </p>
            </div>

            <span className="heading-art">
              <Link2 size={46} />
              <span>↗</span>
            </span>
          </div>

          <div className="stats">
            <Stat
              icon={<Link2 />}
              label="Recent links"
              value={links.length}
              detail="Up to 100 recent connections"
            />
            <Stat
              icon={<Activity />}
              label="Available links"
              value={active}
              detail="Updated every 15 seconds"
            />
            <Stat
              icon={<ShieldCheck />}
              label="URL validation"
              value="On"
              detail="HTTP & HTTPS only"
            />
          </div>

          <section className="create-card" id="create">
            <div className="section-heading">
              <span className="section-icon">
                <Zap size={21} />
              </span>
              <div>
                <h2>Make a new connection</h2>
                <p>
                  A long URL, a simpler way to share.
                </p>
              </div>
              <span className="pill">
                LET’S SHORTEN IT
              </span>
            </div>

            <form onSubmit={submit}>
              <label htmlFor="long-url">
                Destination URL <span>*</span>
              </label>

              <div className="input-wrap">
                <Link2 size={19} />
                <input
                  id="long-url"
                  required
                  type="text"
                  placeholder="https://example.com/your-long-link"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>

              <div className="form-grid">
                <div>
                  <label htmlFor="alias">
                    Custom alias <small>optional</small>
                  </label>
                  <input
                    id="alias"
                    placeholder="your-name"
                    value={alias}
                    onChange={(e) => setAlias(e.target.value)}
                    maxLength={48}
                  />
                </div>

                <div>
                  <label htmlFor="expiry">
                    Expiry date & time
                    <small>optional</small>
                  </label>
                  <input
                    id="expiry"
                    type="datetime-local"
                    value={expires}
                    onChange={(e) =>
                      setExpires(e.target.value)
                    }
                  />
                </div>
              </div>

              <div className="access-settings">
                <h3>Access controls</h3>

                <div className="form-grid">
                  <div>
                    <label htmlFor="password">
                      Link password <small>optional</small>
                    </label>
                    <input
                      id="password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={128}
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={(e) =>
                        setPassword(e.target.value)
                      }
                    />
                  </div>

                  <div>
                    <label htmlFor="access-limit">
                      Maximum successful accesses
                      <small>optional</small>
                    </label>
                    <input
                      id="access-limit"
                      type="number"
                      min="1"
                      max="1000000"
                      step="1"
                      placeholder="Unlimited"
                      value={maxAccesses}
                      onChange={(e) =>
                        setMaxAccesses(e.target.value)
                      }
                    />
                  </div>

                  <div>
                    <label htmlFor="cooldown">
                      Repeat-access cooldown (seconds)
                    </label>
                    <input
                      id="cooldown"
                      type="number"
                      min="0"
                      max="86400"
                      step="1"
                      value={cooldown}
                      onChange={(e) =>
                        setCooldown(e.target.value)
                      }
                    />
                  </div>

                  <p className="access-help">
                    Only successful accesses count.
                    Cooldown applies to everyone using
                    the link. Set 0 for no waiting time.
                  </p>
                </div>
              </div>

              <div className="form-bottom">
                <span>
                  <ShieldCheck size={17} />
                  Every URL gets a basic validation check
                </span>
                <button
                  className="primary"
                  disabled={busy}
                  type="submit"
                >
                  {busy ? "Creating…" : "Create short link"}
                  <ArrowRight size={18} />
                </button>
              </div>
            </form>

            {error && (
              <div className="message error" role="alert">
                {error}
              </div>
            )}

            {notice && (
              <div
                className="message success"
                role="status"
              >
                <Check size={17} />
                {notice}
              </div>
            )}

            {result && (
              <div className="result">
                <div>
                  <small>YOUR NEW SHORT LINK</small>
                  <p>{result.shortUrl}</p>
                </div>

                <button
                  className="icon-button"
                  aria-label="Open new link"
                  onClick={() => openAccess(result)}
                >
                  <ArrowUpRight size={18} />
                </button>

                <button
                  className="icon-button"
                  aria-label="Copy new link"
                  onClick={() => copy(result)}
                >
                  <Copy size={18} />
                </button>

                <button
                  className="icon-button"
                  aria-label="Generate QR code"
                  onClick={() => showQr(result)}
                >
                  <QrCode size={18} />
                </button>
              </div>
            )}

            <div className="demo-note">
              Links are saved on the server. Passwords,
              expiry, limits and cooldowns are checked
              before access. Basic validation does not
              guarantee that a website is safe.
            </div>
          </section>

          <section className="history" id="history">
            <div className="history-heading">
              <div>
                <h2>
                  Your recent links
                  <span>{links.length}</span>
                </h2>
                <p>
                  Good things come in short packages.
                </p>
              </div>
              <span className="history-tag">
                <Clock size={15} />
                Link history
              </span>
            </div>

            {loading ? (
              <div className="empty" role="status">
                Loading your links…
              </div>
            ) : links.length === 0 ? (
              <div className="empty">
                <span>
                  <Link2 size={27} />
                </span>
                <h3>No links to show yet</h3>
                <p>
                  Create a link above to get started.
                </p>
                <a href="#create">
                  Make a link
                  <ArrowUpRight size={16} />
                </a>
              </div>
            ) : (
              <div className="link-list">
                {links.map((link) => (
                  <article key={link.id}>
                    <span className="link-symbol">
                      <Link2 size={20} />
                    </span>

                    <div className="link-info">
                      <strong>{link.shortUrl}</strong>
                      <p title={link.url}>{link.url}</p>

                      <small>
                        {new Date(
                          link.created
                        ).toLocaleDateString()}
                        <span>·</span>
                        {link.expires
                          ? `Expires ${new Date(
                              link.expires
                            ).toLocaleString()}`
                          : "No expiry"}
                      </small>

                      <div className="access-meta">
                        {link.passwordProtected
                          ? "Password protected · "
                          : ""}
                        {link.accesses || 0} /{" "}
                        {link.maxAccesses ?? "Unlimited"}{" "}
                        successful accesses
                        {link.cooldownSeconds
                          ? ` · ${link.cooldownSeconds}s cooldown`
                          : ""}
                      </div>
                    </div>

                    <span
                      className={
                        "status " +
                        (link.status !== "available"
                          ? "expired"
                          : "")
                      }
                      title={link.status}
                    >
                      {statusLabel(link.status)}
                    </span>

                    <div className="actions">
                      <button
                        title="Open link"
                        aria-label={`Open ${link.alias}`}
                        onClick={() => openAccess(link)}
                      >
                        <ArrowUpRight size={17} />
                      </button>

                      <button
                        title="Copy link"
                        aria-label={`Copy ${link.alias}`}
                        onClick={() => copy(link)}
                      >
                        {copied === link.id ? (
                          <Check size={17} />
                        ) : (
                          <Copy size={17} />
                        )}
                      </button>

                      <button
                        title="QR code"
                        aria-label={`QR code for ${link.alias}`}
                        onClick={() => showQr(link)}
                      >
                        <QrCode size={17} />
                      </button>

                      <button
                        title="Share link"
                        aria-label={`Share ${link.alias}`}
                        onClick={() => share(link)}
                      >
                        <Share2 size={17} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <footer>
            <span>
              <span className="footer-dot" />
              Made for a more connected web.
            </span>
            <span>
              Shortwave © {new Date().getFullYear()}
            </span>
          </footer>
        </main>
      </div>

      {previewLink && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!accessBusy) setPreview(null);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Open short link"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close icon-button"
              aria-label="Close"
            
              onClick={() => setPreview(null)}
            >
              <X size={20} />
            </button>

            <span className="eyebrow">
              YOUR NEXT CONNECTION
            </span>

            <h2>
              {previewLink.passwordProtected
                ? "Unlock your link"
                : "Open your link"}
            </h2>

            <p>{previewLink.shortUrl}</p>

            <p>
              {previewLink.accesses || 0} of{" "}
              {previewLink.maxAccesses ?? "unlimited"}{" "}
              successful accesses used
            </p>

            <form onSubmit={tryAccess}>
              {previewLink.passwordProtected && (
                <>
                  <label htmlFor="unlock-password">
                    Password
                  </label>
                  <input
                    autoFocus
                    id="unlock-password"
                    type="password"
                    autoComplete="off"
                    required
                    maxLength={128}
                    value={enteredPassword}
                    onChange={(e) =>
                      setEnteredPassword(e.target.value)
                    }
                  />
                </>
              )}

              <button
                className="primary"
                type="submit"
                disabled={accessBusy}
              >
                {accessBusy
                  ? "Checking…"
                  : "Continue to destination"}
              </button>
            </form>

            {accessMessage && (
              <div className="message" role="alert">
                {accessMessage}
              </div>
            )}

            <small>
              Successful access opens the destination
              and counts one visit.
            </small>
          </div>
        </div>
      )}

      {qr && (
        <div
          className="modal-backdrop"
          onClick={() => setQr(null)}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="QR code"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close icon-button"
              aria-label="Close QR code"
              autoFocus
              onClick={() => setQr(null)}
            >
              <X size={20} />
            </button>

            <span className="eyebrow">
              SCAN. CONNECT. GO.
            </span>
            <h2>Your link, in a square.</h2>

            <img
              src={qr.image}
              alt={`QR code for ${qr.link.shortUrl}`}
            />

            <p>{qr.link.shortUrl}</p>

            <a
              className="primary"
              download={`shortwave-${qr.link.alias}.png`}
              href={qr.image}
            >
              <Download size={18} />
              Download PNG
            </a>

            <small>
              Scan to open this short link.
            </small>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value, detail }) {
  return (
    <div className="stat">
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <App />
);