# Privacy Blur for WhatsApp Web

A Chrome extension that blurs your WhatsApp Web content — messages, previews,
media, names, profile pictures and the composer — until you hover over it.

Peek at a message by moving the mouse over it; everything else stays out of
sight. Useful on a shared screen, in an open office, or whenever someone walks
behind you.

- **Manifest V3**, vanilla JS + CSS, **no build step, no dependencies**
- Runs **only** on `https://web.whatsapp.com/*`
- Makes **no network requests** — nothing you type or read ever leaves the browser
- Settings sync across your Chrome profile via `chrome.storage.sync`

Current version: **1.0.0** · Chrome 105+

---

## Install

The extension is not on the Chrome Web Store yet, so you load it unpacked.

### Option A — clone the repo

```bash
git clone https://github.com/wafaulhimam/whatsapp-toggle.git
```

### Option B — build the ZIP first

`dist/` is not tracked in git, so if you only want the packaged build, make it:

```bash
python3 tools/package.py
```

Then unzip `dist/privacy-blur-whatsapp-web-v1.0.0.zip` anywhere and load the
unzipped folder.

### Load it into Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the **repository root** (the folder containing `manifest.json`) — or
   the folder you unzipped
5. Pin the extension to the toolbar for easy access

Open `web.whatsapp.com` — the blur is on by default.

---

## How to use

| Action | How |
|---|---|
| Turn everything on/off | **Toggle** switch at the top of the popup |
| Same, without opening the popup | Press **`Alt+X`** anywhere |
| Turn a single feature on/off | Its switch in the popup's **Settings** list |
| Change blur strength | Click the **gear** on that row, set *Blur amount* |
| Read a blurred item | Hover it |
| Rebind the shortcut | `chrome://extensions/shortcuts` |

Changes apply **instantly** — no page reload needed.

### Features

| Feature | Default | What it does |
|---|:---:|---|
| All messages in chat | on | Blurs message bubbles in the open conversation (0–40 px) |
| Last messages preview | on | Blurs the message snippet in the left chat list (0–40 px) |
| Media preview | on | Blurs inline images, video and stickers in a chat (0–60 px) |
| Media gallery | on | Blurs thumbnails in the media viewer (0–60 px) |
| Text input | on | Fades what you have typed in the composer |
| Profile pictures | off | Blurs avatars everywhere (0–40 px) |
| Group/Users names | off | Blurs names in the sidebar and chat header (0–40 px) |
| No transition delay | off | Sets the reveal delay to `0s` (default 0.1 s) — hover reveals instantly |
| Unblur all on app hover | off | Hovering anywhere in WhatsApp reveals everything at once |
| Blur WhatsApp on Idle | off | Re-blurs the whole app after 5–600 s without input (default 15 s, 24 px) |

Every row with a gear stores its own blur radius, so you can blur media hard and
messages lightly.

---

## Privacy

- **No analytics, no telemetry, no network calls of any kind.**
- The only host it can touch is `https://web.whatsapp.com/*`.
- The only thing stored is your own toggle preferences, in `chrome.storage.sync`.
- Message content is never read, stored or transmitted.

Details in [`NOTICE.md`](NOTICE.md).

---

## Troubleshooting

**Blur stopped working after WhatsApp updated.**
WhatsApp Web ships obfuscated class names that change on every release, so a
selector can silently stop matching. Reload the tab first
(`chrome://extensions` → refresh the extension → refresh WhatsApp). If a single
feature is dead and the others work, that feature's stylesheet is the one to fix
— see [`css/`](css/) and the notes in [`PLAN.md`](PLAN.md).

**Nothing blurs.**
Check that the master **Toggle** in the popup is on, and that `Alt+X` has not
toggled it off.

**Wrong shortcut / shortcut does nothing.**
Rebind it at `chrome://extensions/shortcuts`. Some system-level shortcuts
intercept `Alt+X` on certain keyboard layouts.

**Settings look wrong or half-applied.**
Every read runs through `PFWA.normalize()`, which fills in missing or invalid
values from the defaults — reload the extension from `chrome://extensions` and
the popup will show a complete, valid state again.

---

## Development

Everything is plain files — load the repo root unpacked and edit.

```
whatsapp-toggle/
├── manifest.json          MV3 manifest
├── background.js          service worker: defaults on install, Alt+X handler
├── shared/settings.js     THE feature schema — single source of truth
├── popup/                 popup UI (html / css / js)
├── scripts/contentScript.js   injects & removes stylesheets on storage change
├── css/                   one stylesheet per feature
├── images/                icons
├── _locales/en/           English strings
└── tools/                 checks, tests, packaging, icon generator
```

### Architecture in one paragraph

The popup writes to `chrome.storage.sync`; the content script listens to
`chrome.storage.onChanged` and adds or removes a `<link>` per enabled feature.
There is **no message passing**, so the MV3 service worker can be suspended at
any time without losing state. All blur values go through CSS custom properties
(`--pfwa-*`), which is what lets `noDelay` and `unblurActive` be a handful of
lines instead of copies of every selector. One stylesheet per feature means a
broken selector only takes down its own feature.

**Adding a feature:** add one entry to `PFWA.FEATURES` in
`shared/settings.js` plus one `css/<id>.css`. The popup builds its rows from
that list automatically, and `tools/review.py` enforces that every feature id
has a matching stylesheet (and vice versa).

### Checks

```bash
# Static: manifest paths, JSON, JS syntax, CSS custom-property resolution,
# popup id/asset references. Exits non-zero on failure.
python3 tools/review.py

# End-to-end: launches a real Chromium with the extension loaded, drives the
# popup, and serves a stand-in WhatsApp page to prove stylesheets really inject.
# Requires playwright-core.
NODE_PATH=<path-to>/node_modules node tools/e2e.js
```

`tools/e2e.js` accepts `PFWA_EXT` to test any build:

```bash
PFWA_EXT=/path/to/extracted-zip NODE_PATH=<path-to>/node_modules node tools/e2e.js
```

> **Note:** branded Chrome 137+ ignores `--load-extension`, so Playwright must
> be pointed at a *Chrome for Testing* binary. The harness auto-detects one from
> `~/Library/Caches/ms-playwright`; falling back to `channel: "chrome"` silently
> loads no extension.

Current status: **41/41 checks pass**, 0 console errors.

### Build the ZIP

```bash
python3 tools/package.py
```

Produces `dist/privacy-blur-whatsapp-web-v1.0.0.zip` using an explicit
allowlist (dev files can never leak in) with fixed timestamps, so the same
source always yields a byte-identical archive.

### Regenerate icons

```bash
python3 tools/make_icons.py
```

Pure Python stdlib, no PIL required.

---

## Roadmap

- [ ] Firefox variant (`manifest_firefox.json`) — the code only uses
      `chrome.*` APIs that Firefox also provides, but nothing has been tested
      there
- [ ] Locales beyond English
- [ ] Chrome Web Store listing (screenshots, privacy policy, copy)

---

## Credits & legal

Selector lists in [`css/`](css/) are derived from
[Privacy Extension For WhatsApp™ Web](https://github.com/LukasLen/Privacy-Extension-For-WhatsApp-Web)
by Lukas Lenhardt and its maintained fork by
[aryomuzakki](https://github.com/aryomuzakki/privacy-whatsapp-web-auto-blur),
both MIT licensed. The popup UI, settings schema, injection engine, icon
generator and test harness are original work. Full attribution in
[`NOTICE.md`](NOTICE.md).

**WhatsApp** is a trademark of WhatsApp LLC, a Meta company. This is an
independent project, not affiliated with, endorsed by or connected to WhatsApp
LLC or Meta in any way.

Made by **[@wafaulh](https://github.com/wafaulh)**.
