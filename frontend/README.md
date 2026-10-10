# Shortwave — frontend

A responsive React + Tailwind CSS URL shortener interface with custom aliases, optional expiry, local history, copy/share controls and downloadable QR codes.

## Run

Use Node.js 24 or later and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite (normally http://localhost:5173).

```sh
npm test
npm run build
npm run preview
```

The production frontend is built into `dist/`. Deploy that directory to any static host. No environment variables are required for this demo.

## Frontend scope

- Links are illustrative `https://shortwave.example/s/alias` addresses. The reserved example domain does not redirect. Copy, share and QR codes encode those demo addresses.
- History is stored only in localStorage in the current browser, capped at 100 links. It is not account storage. Clearing browser data deletes it.
- Custom aliases are validated and checked for collisions against local history only.
- Expiry input uses the browser's local timezone and stores UTC. Expired status is evaluated when the UI renders; no server enforcement or automatic redirect exists.
- URL validation blocks unsupported schemes (including javascript/data/file), malformed URLs, embedded credentials and basic local hostnames. It is not a malware scan or reputation check.
- Clipboard and native sharing depend on browser support and a secure context (HTTPS or localhost). Sharing falls back to copying.

## Connect a backend later

Replace creation and history state updates in `src/main.jsx` with your API calls. The server must validate URLs again, allocate globally unique aliases, persist links, return actual short URLs and enforce expiry on every redirect. Run reputation checks on the server using a trusted provider, keeping its API key secret. Never put secret keys into `VITE_` variables, which are visible to users. The `.env.example` describes an optional public API URL for a future integration; the current UI does not use it.

## Source

`src/main.jsx` contains the UI and browser-local interaction; `src/style.css` includes Tailwind v4 and the responsive visual styling; `src/validation.js` contains basic URL validation; `test/` includes validation tests. QR generation uses the `qrcode` package. Icons use Lucide. No external font or image requests are required.

## Password and smart access controls

Set an optional password (8–128 characters), maximum successful accesses (1–1,000,000; blank means unlimited), and repeat-access cooldown (0–86,400 seconds). Use the arrow button on a history row to open the access preview. Wrong passwords do not count. Successful attempts increment the local counter. Expiry, exhausted limits and cooldowns block preview access. Status refreshes every 15 seconds and is checked again at access time.

Passwords are stored as salted PBKDF2 SHA-256 digests, not plaintext. This is a local simulation, not secure link protection: destinations and rules are visible and editable in browser storage, counters are browser-local, and clearing storage resets everything. Do not use sensitive passwords. Real password protection, cross-device limits and abuse prevention must be implemented on a backend. Existing history remains compatible with unlimited access and no password.

