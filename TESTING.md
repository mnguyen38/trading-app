# Local Testing

How to see the app running while developing — on laptop, in a simulated iPhone, or on a real iPhone over WiFi.

## Start the dev server

```powershell
npm run dev
```

You'll see output like:

```
   - Local:        http://localhost:3000
   - Network:      http://192.168.1.21:3000
```

- **Local** — open from this same machine
- **Network** — open from any device on the same WiFi (your iPhone)

The dev server hot-reloads: edit a file, every connected browser refreshes within ~1 second.

To stop: `Ctrl+C` in the terminal running it.

---

## Option 1 — Chrome / Edge DevTools (best for daily dev)

This is a built-in mobile simulator. Works on Windows, no install.

1. Open http://localhost:3000 in Chrome or Edge.
2. Press `F12` (or `Ctrl+Shift+I`) → DevTools opens.
3. Press `Ctrl+Shift+M` → mobile device toolbar appears at the top of the page.
4. From the dropdown at the top of the simulated viewport, pick **iPhone 14 Pro** (or any iPhone preset).
5. Optional: set the network throttle to **Fast 4G** to test on realistic mobile speeds.

What you get:
- Correct screen dimensions (390x844 for iPhone 14)
- Touch event simulation (clicks become taps)
- Mobile user-agent string
- Device-pixel-ratio for crisp screenshots

Limits:
- Not actual Safari — it's Chromium pretending to be a phone. CSS/JS behaves the same 95% of the time, but the last 5% (smooth scrolling, viewport quirks, font rendering) only shows up on a real iPhone.

---

## Option 2 — Your real iPhone over WiFi (best for "does it actually feel right")

1. Make sure your iPhone is on the same WiFi as your laptop.
2. Open Safari on the iPhone.
3. Type the **Network** URL from the dev server output (e.g. `http://192.168.1.21:3000`).
4. The site loads. Tap around as a real user would.

### Make it feel like a real app

After loading the site in Safari:

1. Tap the share button (the square with the up-arrow).
2. Scroll down → **Add to Home Screen**.
3. Name it "Trading Lab" (or whatever).
4. Tap it from your home screen → full-screen, no Safari chrome.

This is the closest thing to a native app without actually building one.

### If the iPhone can't reach the URL

- Confirm same WiFi (not laptop on Ethernet + phone on WiFi from a different router).
- Run `ipconfig` in PowerShell. The IP under "Wireless LAN adapter Wi-Fi → IPv4 Address" is what the dev server should be using. If the IP in the dev server output is different, your laptop has multiple network interfaces and Next.js picked the wrong one.
- Windows Firewall sometimes blocks inbound connections on port 3000. If the iPhone times out, run this once in an **Administrator** PowerShell:
  ```powershell
  New-NetFirewallRule -DisplayName "Next.js dev 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
  ```

---

## Option 3 — VS Code Simple Browser (glance while coding)

For when you want a quick peek without alt-tabbing.

1. `Ctrl+Shift+P` → type "Simple Browser: Show" → enter.
2. Paste `http://localhost:3000` → opens in a VS Code pane.

Useful for verifying small changes. Not great for clicking around (it's a stripped-down webview).

---

## Recommended workflow

1. Terminal pane 1: `npm run dev` running.
2. Chrome window in Device Mode set to iPhone 14 — this is your "what does this look like on a phone" preview.
3. Regular laptop browser tab open at `http://localhost:3000` — for testing the desktop layout side-by-side.
4. When a feature is close to done: pull it up on the **real iPhone** and tap through it.

If you make a change and a connected browser doesn't refresh:
- Check the terminal — there's likely a compile error.
- Hard-refresh the browser: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (iPhone Safari can't hard-refresh; force-quit Safari instead).

---

## Smoke-test the API integrations separately

Before debugging UI issues, sanity-check that Alpaca itself is reachable:

```powershell
npm run test:trading       # Full smoke test against all configured paper accounts
npm run probe:features     # Probe every order type, options, crypto, market data
```

These run from the terminal without the Next.js server. If they pass, the keys are good and the issue (if any) is in the UI code.

---

## Troubleshooting

| Symptom | Likely fix |
|---|---|
| `Error: listen EADDRINUSE :::3000` | Another process is using port 3000. Kill it or run `npm run dev -- -p 3001`. |
| Page loads but trader cards show "Missing ALPACA_TRADING_KEY_ID_ACCOUNT_X" | The named env var isn't in `.env`. Check spelling. |
| `npm run dev` fails on a fresh checkout | `npm install` first. |
| iPhone shows "Safari cannot open the page" | Firewall (see Option 2 above) or wrong IP. |
| Page renders but no styles | Tailwind didn't compile. Stop the server (`Ctrl+C`) and restart. |
