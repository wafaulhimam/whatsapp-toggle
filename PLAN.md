# Plan — WhatsApp Web Privacy Blur Extension (Chrome, MV3)

Goal: a Chrome extension that blurs WhatsApp Web content (messages, previews, media,
names, avatars, composer text) until the user hovers over it, with a per-feature
toggle panel matching the reference UI.

Target: `https://web.whatsapp.com/*` only. Chrome Manifest V3. Vanilla JS + CSS,
no build step — loadable directly via "Load unpacked".

---

## 1. Scope

### In scope (v1)
- Master toggle (on/off) + keyboard shortcut `Alt+X`
- 9 blur features, each independently toggleable
- Per-feature "gear" advanced setting (blur radius in px, collapsible panel)
- Settings persisted and synced via `chrome.storage.sync`
- Live reaction: toggling in the popup applies instantly without page reload
- Dark-themed popup matching the reference screenshot

### Out of scope (v1, listed for later)
- Firefox build (`manifest_firefox.json` variant)
- Idle auto-blur with configurable timeout (v1.1 — see Phase 6)
- Onboarding page, release-notes fetch, i18n beyond English
- Chrome Web Store packaging/publishing

---

## 2. Feature matrix

| # | Feature | Target on WhatsApp Web | Technique |
|---|---------|------------------------|-----------|
| 1 | All messages in chat | Message bubbles in the open conversation | `filter: blur()` on bubble, `:hover` clears |
| 2 | Last messages preview | Left sidebar chat list rows | Blur the preview snippet text node |
| 3 | Media preview | Inline images / video / stickers in chat | Blur the media container, keep text sharp |
| 4 | Media gallery | Thumbnail strip in the media viewer | Blur thumbnail images |
| 5 | Text input | Composer contenteditable | Desaturate / lighten text color (not blur) |
| 6 | Profile pictures | All avatars (sidebar, header, bubbles) | Blur `img` inside avatar containers |
| 7 | Group / Users names | Sidebar + chat header titles | Blur name text nodes |
| 8 | No transition delay | — | Removes the reveal `transition-delay` (0.3s → 0s) |
| 9 | Unblur all on app hover | Whole app root | `#app:hover` clears all blur rules |
| 10 | Blur on idle *(v1.1)* | Whole app root | Timer → add blur class; any input resets |

All blur features share one CSS variable `--blur-amount` so the gear control
changes radius globally; per-feature overrides are a stretch goal.

---

## 3. Architecture

```
Popup UI / Alt+X  ->  chrome.storage.sync  ->  contentScript.js  ->  injected <link> CSS  ->  WA DOM
```

- **No runtime messaging needed for settings.** The popup writes to `storage.sync`;
  the content script subscribes to `storage.onChanged` and adds/removes stylesheets.
  This survives service-worker suspension and keeps the design stateless.
- **One stylesheet per feature.** `css/messages.css`, `css/name.css`, … Each is
  injected/removed independently, so a broken selector in one feature cannot break
  the others.
- **CSS-only blur.** No DOM mutation of WhatsApp's own elements beyond adding
  `<link>` and `<style>` tags into `<head>`. Lowest possible breakage risk.
- **CSS variables** for tunable values, written into a single `<style>` tag scoped to
  `#whatsapp-web body`.

---

## 4. File structure

```
whatsapp-toggle/
├── manifest.json              MV3 manifest
├── background.js              service worker: default settings on install, Alt+X handler
├── popup/
│   ├── popup.html             toggle list UI
│   ├── popup.css              dark theme styling
│   └── popup.js               read/write settings, gear collapsibles
├── scripts/
│   └── contentScript.js       injects/removes CSS links on storage change
├── css/
│   ├── messages.css
│   ├── messagesPreview.css
│   ├── mediaPreview.css
│   ├── mediaGallery.css
│   ├── textInput.css
│   ├── profilePic.css
│   ├── name.css
│   ├── noDelay.css
│   └── unblurActive.css
├── images/                    icon16/32/48/128.png, statusOn.png, statusOff.png
├── _locales/en/messages.json  English strings
└── PLAN.md                    this file
```

---

## 5. Settings shape

```js
{
  on: true,                          // master toggle
  styles: {
    messages: true,
    messagesPreview: true,
    mediaPreview: true,
    mediaGallery: true,
    textInput: true,
    profilePic: false,
    name: false,
    noDelay: false,
    unblurActive: false
  },
  blurOnIdle: { isEnabled: false, idleTimeout: 15 },   // v1.1
  varStyles: { blurAmount: "8px" }                     // gear-controlled radius
}
```

Defaults are written by `background.js` on `runtime.onInstalled` so the popup never
has to handle a missing settings object.

---

## 6. Implementation phases

### Phase 1 — Scaffold (foundation)
- Create folder tree, `manifest.json` (MV3, `storage` permission,
  `host_permissions: https://web.whatsapp.com/*`, content script at `document_idle`,
  `web_accessible_resources` for all CSS + status images, `commands.toggle` = Alt+X).
- Generate placeholder icons at 16/32/48/128.
- `background.js`: seed defaults on install; `commands.onCommand` flips `settings.on`.
- **Done when:** extension loads unpacked with no manifest errors.

### Phase 2 — Popup UI (match the screenshot)
- Dark surface (`#1f2c33`-ish), green accent (`#00a884`).
- Header: icon + "Privacy Extension For WhatsApp Web" + status glyph.
- `Toggle` master switch, then a `Settings` section header, then the feature rows.
- Each row: label, optional gear button, switch.
- Gear toggles a collapsible `<form>` with a number input for blur radius.
- **Done when:** UI visually matches the reference; switches reflect stored state.

### Phase 3 — Injection engine
- `contentScript.js`:
  - `addStyleById(id)` — appends `<link rel=stylesheet>` pointing at
    `chrome.runtime.getURL('css/<id>.css')` with a shared class for bulk removal.
  - `removeAllStyles()` / `removeStyleById(id)`.
  - `addVarStyle()` — writes `--blur-amount` into a `<style>` tag.
  - `updateStyles()` — reads settings, reconciles injected links with enabled flags.
  - Subscribes to `chrome.storage.onChanged` → `updateStyles()`.
  - Runs once on `DOMContentLoaded` for the initial paint.
- **Done when:** toggling any switch in the popup changes the page immediately.

### Phase 4 — CSS rules per feature (the bulk of the work)
For each feature: write selectors, verify against the live WhatsApp Web DOM,
then apply `filter: blur(var(--blur-amount)) grayscale(1)` plus a `:hover` reset.
- Use `!important` where WhatsApp's own specificity wins.
- Keep every selector commented with the WhatsApp Web build version it was verified on.
- Prefer stable hooks in this order: `[data-testid]` / `aria-label` / `role` →
  structural selectors → obfuscated class names (last resort).
- Add a `.wa-version-*` scoping comment block so future breakage is easy to bisect.
- **Done when:** all 9 features verified by hand on a logged-in session.

### Phase 5 — Shortcut + status feedback
- Verify `Alt+X` toggles via `chrome://extensions/shortcuts`.
- Popup header glyph (statusOn/statusOff) reflects master state.
- **Done when:** shortcut works without the popup open and survives page reload.

### Phase 6 — v1.1 extras (only after v1 is solid)
- Blur on idle: `setTimeout` on activity listeners, configurable timeout.
- Second locale, Firefox manifest variant.
- Optional: per-feature blur amount overrides.

---

## 7. Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| WhatsApp Web obfuscated class names (`_amk4`, `_amk6`) change on every release | Selectors silently stop matching; blur "just stops working" | One CSS file per feature (isolated failure), prefer `data-testid`/`aria-label`, version-comment each selector, add a selector-health debug flag |
| WhatsApp's own CSS wins on specificity | Blur never applies | `!important` + higher-specificity ancestor chains |
| Page CSP blocks inline styles | Injection fails | Inject via `<link>` from `web_accessible_resources`; the one `<style>` tag for variables is inserted by the content script (isolated world), which is permitted |
| MV3 service worker suspended | Shortcut handler / defaults lost | No persistent state in the worker; all state in `storage.sync` |
| `storage.sync` quota (8KB/item) | Settings fail to save | Settings object stays tiny; use `storage.local` fallback if it ever grows |
| Hovering a bubble to read one message reveals the whole row | Weak privacy in practice | `unblurActive` and `noDelay` give the user control; document the trade-off |

---

## 8. Test checklist

- [ ] Loads unpacked in `chrome://extensions` with zero warnings
- [ ] Popup opens, all switches render, state matches `storage.sync`
- [ ] Each of the 9 features toggles on/off live on `web.whatsapp.com`
- [ ] Hover reveals blurred element; moving away re-blurs
- [ ] `noDelay` removes the reveal delay
- [ ] `unblurActive` clears everything while hovering the app
- [ ] `Alt+X` toggles master switch from the page
- [ ] Master off → every blur removed instantly
- [ ] Settings persist across page reload and browser restart
- [ ] Gear blur-radius input changes blur strength
- [ ] No console errors on WhatsApp Web; no visible layout shift
- [ ] Extension does not touch any host other than `web.whatsapp.com`

---

## 9. Legal / naming notes

- "WhatsApp" is a WhatsApp LLC trademark. Ship with a disclaimer: independent
  project, not affiliated with or endorsed by WhatsApp or Meta.
- Do not copy the reference project's code or assets verbatim — it is MIT licensed,
  so attribution is required if any portion is reused. Clean-room implementation
  recommended; keep the disclaimer and use an original name/icon.
- No telemetry, no network calls, no message content leaves the browser.
