# README Screenshots Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Generate real, reproducible screenshots of the extension and embed them in
`README.md`, so the repo presents well now that it is public.

**Architecture:** Add `tools/screenshots.js`, a purpose-built sibling of `tools/e2e.js`.
It reuses the existing launch pattern — a real Chromium with the unpacked extension
loaded — opens the *real* popup at `chrome-extension://<id>/popup/popup.html`, and serves
a stand-in WhatsApp page at `https://web.whatsapp.com/` through `page.route()`, so the real
content script injects the real stylesheets. Images land in `docs/screenshots/` and are
referenced from `README.md` by relative path.

**Tech Stack:** Node 22 (CommonJS), `playwright-core`, plain CSS. No new runtime or build
dependencies, and no new dependency for post-processing.

## Command conventions

Every command below runs **from the repository root**. Two placeholders are used, matching
the style already used in `README.md`:

- `<node>` — any Node 22 binary.
- `<workspace>/node_modules` — a `node_modules` directory containing `playwright-core`.

---

## 1. Why this is a small job, not a project

`tools/e2e.js` already does the hard part. It:

- launches Chromium with `--load-extension` (falling back to a Chrome for Testing binary,
  because branded Chrome 137+ silently ignores `--load-extension`),
- derives the extension id from the service worker and opens the real popup page
  (`tools/e2e.js:95-135`),
- serves a stand-in WhatsApp page at the real origin via `page.route()`
  (`tools/e2e.js:244`), so the content script matches and injects for real,
- and **already writes four screenshots** to `os.tmpdir()/pfwa-shots`:
  `popup.png`, `popup-gear-open.png`, `idle-blur.png`, `fake-whatsapp.png`
  (`tools/e2e.js:160,177,369,376`).

So the gap is not "capture screenshots". The gap is that those captures are
**test byproducts, not documentation assets**:

| Problem | Consequence |
|---|---|
| Written to a temp dir | Never reachable from README |
| No viewport set for the popup page | Playwright's default 1280px viewport is used, so `popup.png` is a 1280px-wide canvas with the 320px popup hugging the left edge |
| No `deviceScaleFactor` | 1x output, soft on retina displays |
| State is whatever the test left behind | Switches are mid-test, not the state we want to advertise |
| `FAKE_WA` markup is bare | Background `#111b21` with unstyled divs — reads as a wireframe, not as WhatsApp |

Hence: a dedicated tool, a curated state, a presentable demo page.

## 2. Constraints that dictate the design

These are load-bearing. Violating any one of them breaks an existing check or ships junk
to users.

1. **Screenshots must NOT go in `images/`.** `tools/package.py` ships an explicit allowlist
   (`SHIPPED`, `tools/package.py:23-33`) that includes the whole `images` directory and
   `os.walk()`s it recursively. Anything dropped in `images/` is packaged into the
   extension ZIP. Use `docs/screenshots/`, which is not in the allowlist.
2. **`tools/screenshots.js` must be CommonJS.** `tools/review.py:check_js_syntax()` walks
   the entire repo and runs `node --check` on every `.js` file. `node --check` treats `.js`
   as CommonJS, so an ESM `import` statement is a syntax error. Use `require()`, exactly as
   `tools/e2e.js` does.
3. **GitHub strips the `style` attribute in README HTML.** `width`, `height` and `align`
   attributes survive; `style` does not. A border or rounded corners must therefore be
   part of the rendered page, not added by CSS in the README.
4. **The demo page is a reproduction, and must be labelled as one.** We cannot log into a
   real WhatsApp account, so the blur screenshots come from a stand-in page. The caption
   has to say so, and the content must be obviously fictional. Do not let a mock read as a
   screenshot of someone's real chats.
5. **The demo page must keep the exact selector hooks the CSS targets.** The extension
   blurs via selectors like `div[data-testid="msg-container"]`,
   `div.lexical-rich-text-input`, and long generated class chains. A prettier demo page that
   drops those hooks will screenshot as an unblurred page.

## 3. Non-goals (YAGNI)

- No animated GIF or video. Static PNGs only.
- No light-mode screenshot variants.
- No CI job to regenerate screenshots. Run it by hand, like `make_icons.py`.
- No Chrome Web Store assets (1280x800). That is a different aspect ratio and belongs to
  the store-listing task in the roadmap; this tool can be extended for it later.

## 4. Deliverable files

| Path | Role |
|---|---|
| `tools/screenshots.js` | New. Generates every README image. |
| `docs/screenshots/popup.png` | Hero — popup in the advertised state |
| `docs/screenshots/popup-advanced.png` | Popup with a gear panel expanded |
| `docs/screenshots/blur-before.png` | Demo page, master toggle off |
| `docs/screenshots/blur-after.png` | Demo page, master toggle on |
| `docs/screenshots/blur-hover.png` | Demo page, one bubble hovered (the "peek") |
| `README.md` | Modified — hero + before/after + honest caption |
| `PLAN.md` | Modified — roadmap note |

---

## Task 1: Confirm the existing harness still runs

Nothing else is trustworthy until we know the launch path works on this machine.

**Files:** none (verification only)

**Step 1: Run the end-to-end suite**

```bash
NODE_PATH=<workspace>/node_modules <node> tools/e2e.js
```

Expected: `41/41` checks pass, and a final line printing the screenshots directory.

**Step 2: Inspect the byproduct screenshots**

```bash
ls -la "${TMPDIR%/}/pfwa-shots"
```

Expected: four PNGs. Look at `popup.png` specifically — confirm it is the wide-canvas
problem described in section 1. This is the "before" evidence that justifies the new tool.

**Step 3: Do not commit.** Nothing changed on disk.

---

## Task 2: Scaffold the tool and capture the popup hero

**Files:**
- Create: `tools/screenshots.js`

**Step 1: Write the tool**

```js
/*
 * Screenshot generator for the README.
 *
 * Reuses the launch pattern from tools/e2e.js: a real Chromium with the unpacked
 * extension loaded, the real popup page, and a stand-in WhatsApp page served at
 * https://web.whatsapp.com/ through request interception, so the real content
 * script injects the real stylesheets.
 *
 * Run from the repo root:
 *   NODE_PATH=<workspace>/node_modules node tools/screenshots.js
 */
const path = require("path");
const os = require("os");
const fs = require("fs");
const { chromium } = require("playwright-core");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "docs", "screenshots");
const SCALE = 2;

/* The exact state the hero shot should advertise. Keys mirror PFWA.defaults()
 * in shared/settings.js - keep them in sync if the schema gains a feature. */
const SHOWCASE = {
  on: true,
  styles: {
    messages: true, messagesPreview: true, mediaPreview: true, mediaGallery: true,
    textInput: true, profilePic: true, name: true,
    noDelay: false, unblurActive: false, blurOnIdle: false,
  },
  varStyles: {
    msBlur: "8px", mspBlur: "8px", mdpBlur: "20px", mdgBlur: "20px",
    ppBlur: "8px", nmBlur: "8px", idleBlur: "24px",
  },
  idle: { timeout: 15 },
};

const OFF = Object.assign({}, SHOWCASE, { on: false });

function findChromeForTesting() {
  const cache = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  if (!fs.existsSync(cache)) return null;
  const candidates = [];
  for (const entry of fs.readdirSync(cache)) {
    if (!entry.startsWith("chromium-")) continue;
    candidates.push(
      path.join(cache, entry, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
      path.join(cache, entry, "chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
      path.join(cache, entry, "chrome-linux", "chrome")
    );
  }
  return candidates.find((c) => fs.existsSync(c)) || null;
}

/* Writes settings through the real chrome.storage.sync, so the popup re-renders
 * via its own onChanged listener. This exercises production code instead of
 * poking the DOM. */
function applySettings(page, settings) {
  return page.evaluate(
    (value) =>
      new Promise((resolve, reject) => {
        chrome.storage.sync.set({ settings: value }, () => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve();
        });
      }),
    settings
  );
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pfwa-shots-profile-"));
  const executablePath = findChromeForTesting();
  const args = [
    `--disable-extensions-except=${ROOT}`,
    `--load-extension=${ROOT}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--force-color-profile=srgb",
    "--font-render-hinting=none",
  ];

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    deviceScaleFactor: SCALE,
    args,
    ...(executablePath ? { executablePath } : { channel: "chrome" }),
  });

  try {
    const worker = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
    const extensionId = worker.url().split("/")[2];
    if (!extensionId) throw new Error("could not resolve the extension id");

    /* ------------------------------------------------------------- popup hero */
    const popup = await context.newPage();
    /* body is 320px wide (popup/popup.css:22). Match the viewport to it so the
     * capture is the popup and nothing else. */
    await popup.setViewportSize({ width: 320, height: 900 });
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForSelector("#feature-rows .row");

    await applySettings(popup, SHOWCASE);
    await popup.waitForTimeout(250);

    /* The popup body has no radius of its own, but Chrome renders the popup as a
     * rounded panel. Adding the radius here is more accurate, not less, and with
     * omitBackground it yields transparent corners that sit on any README theme. */
    await popup.addStyleTag({
      content: "html{background:transparent}body{border-radius:10px;overflow:hidden}",
    });

    await popup.screenshot({
      path: path.join(OUT, "popup.png"),
      fullPage: true,
      omitBackground: true,
    });

    /* ------------------------------------------------- popup, gear panel open */
    await popup.locator("#feature-rows .row").nth(0).locator(".gear").click();
    await popup.waitForTimeout(350);
    await popup.screenshot({
      path: path.join(OUT, "popup-advanced.png"),
      fullPage: true,
      omitBackground: true,
    });
  } finally {
    await context.close();
  }

  for (const name of fs.readdirSync(OUT).sort()) {
    console.log(`  ${name}  ${(fs.statSync(path.join(OUT, name)).size / 1024).toFixed(0)} KB`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

**Step 2: Run it**

```bash
NODE_PATH=<workspace>/node_modules <node> tools/screenshots.js
```

Expected: two PNGs listed in `docs/screenshots/`, each well under 250 KB.

**Step 3: Verify the geometry**

```bash
python3 - <<'PY'
import struct
for p in ("docs/screenshots/popup.png", "docs/screenshots/popup-advanced.png"):
    d = open(p, "rb").read()
    w, h = struct.unpack(">II", d[16:24])
    print(f"{p}: {w}x{h} px (expected width 640)")
PY
```

Expected: width is exactly `640` (320 CSS px at 2x). A width of `2560` means the viewport
was not applied — fix before continuing.

**Step 4: Confirm the static checks still pass**

`review.py` runs `node --check` over the new file, so this proves the CommonJS choice was right.

```bash
python3 tools/review.py
```

Expected: `All checks passed.`

**Step 5: Commit**

```bash
git add tools/screenshots.js docs/screenshots/popup.png docs/screenshots/popup-advanced.png
git commit -m "tools: add reproducible screenshot generator for the popup"
```

---

## Task 3: Build the demo page and capture the blur states

**Files:**
- Modify: `tools/screenshots.js` (add the demo page constant and its capture block)

**Step 1: Add a presentable demo page**

It must look like WhatsApp Web while preserving every selector hook the CSS needs. The
hooks are non-negotiable — these are the ones that actually match:

| Feature | Required hook | Source |
|---|---|---|
| All messages in chat | `div[data-testid="msg-container"]` | `css/messages.css:15` |
| Last messages preview | `div.xjbqb8w.x1iyjqo2.x1f6kntn.x1fc57z9.x6ikm8r.x10wlt62.x1yc453h.xlyipyv.xuxw1ft.xo1l8bm` | `css/messagesPreview.css:14` |
| Group/Users names | `div[role="gridcell"] div.x14ug900.x78zum5.x1iyjqo2.x1jchvi3.xdod15v.x6ikm8r.x10wlt62.x1mzt3pk.x1yc453h.xo1l8bm` | `css/name.css:19` |
| Profile pictures | `div.x1okw0bk.xbelrpt > div.x1n2onr6.x1c9tyrk.xeusxvb.x1pahc9y.x1ertn4p` | `css/profilePic.css:39` |
| Text input | `div.lexical-rich-text-input` | `css/textInput.css:15` |
| Media preview | `div.x78zum5.x1iyjqo2.xs83m0k.x1r8uery.xdt5ytf.x6s0dn4 > span` | `css/mediaPreview.css:35` |

Build the page as a template literal in `tools/screenshots.js`, modelled on `FAKE_WA`
(`tools/e2e.js:23-48`) but laid out like the real app: a 340px left sidebar with three chat
rows, and a right pane with a header, four message bubbles, an inline image bubble and a
composer. Content must be plainly fictional (generic names, "Hey, are we still on for
tonight?"). Give the outermost element `border:1px solid #2a3942; border-radius:12px` so the
frame is baked into the capture — README CSS cannot supply it (constraint 3).

**Step 2: Capture before / after / hover**

Serve the page at the real origin and drive it through `chrome.storage.sync`, the same way
`tools/e2e.js:244` does:

```js
    const demo = await context.newPage();
    await demo.setViewportSize({ width: 900, height: 620 });
    await demo.route("https://web.whatsapp.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: DEMO_PAGE })
    );
    await demo.goto("https://web.whatsapp.com/");
    await demo.waitForTimeout(400);

    await applySettings(demo, OFF);
    await demo.waitForTimeout(300);
    await demo.screenshot({ path: path.join(OUT, "blur-before.png") });

    await applySettings(demo, SHOWCASE);
    await demo.waitForTimeout(300);
    await demo.screenshot({ path: path.join(OUT, "blur-after.png") });

    /* Hovering one bubble is the whole point of the extension - show the peek. */
    await demo.locator('[data-testid="msg-container"]').nth(1).hover();
    await demo.waitForTimeout(300);
    await demo.screenshot({ path: path.join(OUT, "blur-hover.png") });
```

**Step 3: Run and eyeball all five images**

```bash
NODE_PATH=<workspace>/node_modules <node> tools/screenshots.js
open docs/screenshots/
```

Expected, checked by eye:
- `blur-before.png` — everything legible.
- `blur-after.png` — bubbles, sidebar preview, name, avatar and composer all blurred.
- `blur-hover.png` — exactly one bubble sharp, the rest blurred.

If `blur-after.png` looks identical to `blur-before.png`, the demo page lost a selector hook.
Re-check the table in Step 1 before touching anything else.

**Step 4: Verify the total size stays sane**

```bash
du -ch docs/screenshots/*.png | tail -1
```

Expected: under 800 KB total. If over, drop the demo captures to `deviceScaleFactor: 1`
(the popup, being small, is worth keeping at 2x).

**Step 5: Commit**

```bash
git add tools/screenshots.js docs/screenshots/
git commit -m "tools: capture blur before/after screenshots from the demo page"
```

---

## Task 4: Prove the screenshots cannot leak into the extension ZIP

This is the check that keeps a documentation asset out of the shipped artifact.

**Files:** none (verification only)

**Step 1: Rebuild the package**

```bash
python3 tools/package.py
```

Expected: `packaged 23 files`, and the printed file list contains **no** `docs/` entries.

**Step 2: Assert it mechanically**

```bash
python3 -c "
import zipfile, glob, sys
z = zipfile.ZipFile(sorted(glob.glob('dist/*.zip'))[-1])
bad = [n for n in z.namelist() if n.startswith(('docs/', 'tools/')) or n.endswith('.md') and n != 'NOTICE.md']
print('leaked:', bad or 'none')
sys.exit(1 if bad else 0)
"
```

Expected: `leaked: none`, exit code 0.

**Step 3: Do not commit.** `dist/` is gitignored.

---

## Task 5: Embed in README.md

**Files:**
- Modify: `README.md` (hero after the intro, before `## Install`; before/after in `## How to use`)

**Step 1: Add the hero**

Insert after the `Current version: **1.0.0** · Chrome 105+` line and before the first `---`:

```html
<p align="center">
  <img src="docs/screenshots/popup.png" width="320" alt="The extension popup: a master toggle and ten per-feature switches">
</p>
```

**Step 2: Add before/after under `## How to use`**

Immediately after the intro sentence of that section:

```html
<p align="center">
  <img src="docs/screenshots/blur-before.png" width="49%" alt="WhatsApp Web with the blur switched off">
  <img src="docs/screenshots/blur-after.png" width="49%" alt="The same layout with every blur feature on">
</p>

<p align="center"><sub>Effect demo on a stand-in page that reproduces WhatsApp Web's markup — not a screenshot of a real account.</sub></p>
```

Then reference `blur-hover.png` in the Actions table's "Read a blurred item" row, or add one
line under the pair: hover reveals a single item while the rest stay hidden.

**Step 3: Verify every referenced path resolves**

```bash
grep -o 'docs/screenshots/[a-z-]*\.png' README.md | sort -u | while read -r p; do
  [ -f "$p" ] && echo "ok   $p" || echo "MISS $p"
done
```

Expected: five `ok` lines, no `MISS`.

**Step 4: Verify GitHub will render the HTML**

`style` attributes are stripped by GitHub's sanitiser; `width`, `align` and `<sub>` are not.
Re-read the inserted blocks and confirm no `style=` slipped in.

**Step 5: Commit**

```bash
git add README.md
git commit -m "docs: add popup and blur-effect screenshots to the README"
```

---

## Task 6: Document the tool and update the roadmap

**Files:**
- Modify: `README.md` (the `### Checks` block in `## Development`)
- Modify: `PLAN.md` (roadmap)

**Step 1: Add the command to the Development section**

Alongside the existing `python3 tools/review.py` and `node tools/e2e.js` blocks:

```bash
# Regenerate the README screenshots into docs/screenshots/.
# Requires playwright-core, same as the e2e harness.
NODE_PATH=<path-to>/node_modules node tools/screenshots.js
```

Note in one line that the blur screenshots come from a stand-in page, so the caption in the
README stays truthful.

**Step 2: Update the PLAN.md roadmap**

Add a line recording that README screenshots are done via `tools/screenshots.js`, and note
that the Chrome Web Store item still needs separate 1280x800 assets.

**Step 3: Commit**

```bash
git add README.md PLAN.md
git commit -m "docs: document the screenshot tool and update the roadmap"
```

---

## Task 7: Final verification

**Files:** none

**Step 1: Full check sweep**

```bash
python3 tools/review.py
NODE_PATH=<workspace>/node_modules <node> tools/e2e.js
python3 tools/package.py
```

Expected: `All checks passed.`, `41/41` pass, `packaged 23 files` with no `docs/` entries.

**Step 2: Confirm nothing unintended is staged**

```bash
git status --short
git ls-files docs/
```

Expected: clean tree; `docs/` tracks only the five PNGs and the plan document. Confirm
`.workbuddy-ai/` and `dist/` remain untracked.

**Step 3: Push and check the rendered page**

```bash
git push origin main
```

Then open the repository on GitHub and confirm the images render in both light and dark
themes — the popup's transparent corners are the thing to check.

---

## 5. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Screenshots land in `images/` and ship inside the extension ZIP | Medium — it is the obvious-looking location | `docs/screenshots/` only; Task 4 asserts it mechanically |
| New tool breaks `review.py` via `node --check` | Medium | CommonJS `require()`, same as `tools/e2e.js`; Task 2 Step 4 |
| A mock screenshot is read as a real WhatsApp account | Medium | Explicit `<sub>` caption; obviously fictional content only |
| Demo page silently stops blurring after a selector change | Low | Task 3 Step 3 diffs before/after by eye; the hooks table lists what to check |
| Repo size grows uncomfortably | Low | 800 KB budget in Task 3 Step 4; drop demo captures to 1x if needed |
| Branded Chrome ignores `--load-extension` | Low | Same Chrome-for-Testing fallback as `tools/e2e.js` |
