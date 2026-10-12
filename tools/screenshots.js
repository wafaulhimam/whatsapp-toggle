/*
 * Screenshot generator for the README.
 *
 * Reuses the launch pattern from tools/e2e.js: a real Chromium with the unpacked
 * extension loaded, and the real popup page served from the extension origin.
 * Settings are written through chrome.storage.sync rather than by poking the DOM,
 * so the popup renders itself through its normal code path.
 *
 * Images land in docs/screenshots/ and are referenced from README.md by relative
 * path. They are deliberately NOT in images/, because tools/package.py ships the
 * whole images/ directory inside the extension ZIP.
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

/* popup/popup.css pins the body to 320px and sets no min-height, so the body box
 * is exactly the popup content. Matching the viewport to it avoids the 1280px
 * canvas the e2e harness produces, where the popup hugs the left edge. */
const POPUP_WIDTH = 320;

/*
 * The state the hero shot should advertise. Keys mirror PFWA.defaults() in
 * shared/settings.js - keep them in sync if the schema gains a feature.
 */
const SHOWCASE = {
  on: true,
  styles: {
    messages: true,
    messagesPreview: true,
    mediaPreview: true,
    mediaGallery: true,
    textInput: true,
    profilePic: true,
    name: true,
    noDelay: false,
    unblurActive: false,
    blurOnIdle: false,
  },
  varStyles: {
    msBlur: "8px",
    mspBlur: "8px",
    mdpBlur: "20px",
    mdgBlur: "20px",
    ppBlur: "8px",
    nmBlur: "8px",
    idleBlur: "24px",
  },
  idle: { timeout: 15 },
};

/* Same shape, master switch off - the "before" state for the demo page. */
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
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

/*
 * Writes settings through the real chrome.storage.sync. The popup and the content
 * script both react to storage.onChanged, so this drives production code paths
 * instead of mutating the DOM.
 */
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

/*
 * The popup body has no radius of its own, but Chrome renders the popup as a
 * rounded panel, so a radius is more accurate rather than less.
 *
 * Getting transparent corners out of Chromium needs care. A background on <html>
 * paints the entire canvas as a rectangle, and a background on <body> propagates
 * to the canvas for the same reason - either one defeats omitBackground and the
 * PNG comes out RGB with no alpha at all. So both are cleared and the surface is
 * moved onto a wrapper element, whose radius is the only thing that gets clipped.
 */
async function frameBody(page) {
  await page.evaluate(() => {
    const wrap = document.createElement("div");
    wrap.id = "pfwa-shot-frame";
    while (document.body.firstChild) wrap.appendChild(document.body.firstChild);
    document.body.appendChild(wrap);
  });
  await page.addStyleTag({
    content: [
      "html,body{background:transparent}",
      "#pfwa-shot-frame{background:var(--pfwa-bg,#0b141a);border-radius:10px;overflow:hidden}",
    ].join(""),
  });
}

async function capturePopup(page, file) {
  const height = await page.evaluate(() =>
    Math.ceil(document.body.getBoundingClientRect().height)
  );
  await page.setViewportSize({ width: POPUP_WIDTH, height });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, file), omitBackground: true });
}

function report() {
  let total = 0;
  for (const name of fs.readdirSync(OUT).sort()) {
    const size = fs.statSync(path.join(OUT, name)).size;
    total += size;
    console.log(`  ${name.padEnd(24)} ${(size / 1024).toFixed(0)} KB`);
  }
  console.log(`  ${"total".padEnd(24)} ${(total / 1024).toFixed(0)} KB`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pfwa-shots-profile-"));
  const executablePath = findChromeForTesting();

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    deviceScaleFactor: SCALE,
    args: [
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--force-color-profile=srgb",
    ],
    ...(executablePath ? { executablePath } : { channel: "chrome" }),
  });

  try {
    const worker = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
    const extensionId = worker.url().split("/")[2];
    if (!extensionId) throw new Error("could not resolve the extension id");

    /* ------------------------------------------------------------- popup hero */
    const popup = await context.newPage();
    await popup.setViewportSize({ width: POPUP_WIDTH, height: 900 });
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForSelector("#feature-rows .row");

    await applySettings(popup, SHOWCASE);
    await popup.waitForTimeout(250);
    await frameBody(popup);
    await capturePopup(popup, "popup.png");

    /* ------------------------------------------------- popup, gear panel open */
    await popup.locator("#feature-rows .row").nth(0).locator(".gear").click();
    await popup.waitForTimeout(350);
    await capturePopup(popup, "popup-advanced.png");

    if (popup) await popup.close();
  } finally {
    await context.close();
  }

  report();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
