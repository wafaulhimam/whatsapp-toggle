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

/*
 * A stand-in WhatsApp Web page for the effect screenshots.
 *
 * This is a reproduction, not a screenshot of a real account, and the README says
 * so. Its only job is to keep every selector hook the extension actually matches,
 * so the blur shown is produced by the real stylesheets rather than faked:
 *
 *   messages.css        div[data-testid="msg-container"]
 *   messagesPreview.css div.xjbqb8w.x1iyjqo2...xuxw1ft.xo1l8bm
 *   name.css            div[role="gridcell"] div.x14ug900...xo1l8bm
 *   profilePic.css      div.x1okw0bk.xbelrpt > div.x1n2onr6...x1ertn4p
 *                       header div[role="button"]:first-child div.x1n2onr6.x16ye13r.x5lhr3w
 *   mediaPreview.css    div[data-testid="msg-container"] :is(div,button)[role="button"][class]
 *   textInput.css       div.lexical-rich-text-input
 *
 * Dropping any of those class chains makes that feature silently stop blurring.
 * If a future WhatsApp release changes a selector in css/, change it here too.
 */
const DEMO_PAGE = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>WhatsApp</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%;background:transparent}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
  #frame{width:100%;height:100%;display:flex;background:#0b141a;border:1px solid #2a3942;border-radius:12px;overflow:hidden}
  #pane-side{width:340px;flex:0 0 340px;background:#111b21;border-right:1px solid #2a3942;display:flex;flex-direction:column}
  .side-head{height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid #2a3942}
  .side-head .t{color:#e9edef;font-size:15px;font-weight:500}
  .chat{display:flex;gap:12px;align-items:center;padding:11px 16px;border-bottom:1px solid rgba(255,255,255,.05)}
  .chat .meta{min-width:0;flex:1}
  .nm{color:#e9edef;font-size:14.5px;margin-bottom:3px}
  .pv{color:#8696a0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .av{border-radius:50%;flex:0 0 auto}
  .av svg{width:100%;height:100%;display:block;border-radius:50%}
  #main{flex:1;display:flex;flex-direction:column;min-width:0}
  header.main-head{height:56px;display:flex;align-items:center;gap:12px;padding:0 16px;background:#202c33}
  header.main-head .t{color:#e9edef;font-size:15px;font-weight:500}
  .bubbles{flex:1;padding:20px 24px;display:flex;flex-direction:column;gap:10px}
  [data-testid="msg-container"]{max-width:74%;padding:7px 9px 8px;border-radius:8px;color:#e9edef;font-size:14.5px;line-height:1.35}
  .in{background:#202c33;align-self:flex-start}
  .out{background:#005c4b;align-self:flex-end}
  .stamp{font-size:11px;color:#8696a0;float:right;margin:6px 0 0 10px}
  .shot{padding:4px;background:#202c33;align-self:flex-start}
  .shot .ph{width:250px;height:146px;border-radius:6px;overflow:hidden;display:block}
  .shot .ph svg{width:100%;height:100%;display:block}
  .composer{margin:0 16px 16px;background:#2a3942;border-radius:8px;padding:11px 14px;color:#e9edef;font-size:14.5px}
</style></head>
<body>
<div id="frame">
  <div id="pane-side">
    <div class="side-head">
      <span class="t">Chats</span>
      <div class="av x1okw0bk xbelrpt" style="width:34px;height:34px"><div class="x1n2onr6 x1c9tyrk xeusxvb x1pahc9y x1ertn4p"><svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#7f66a0"/><circle cx="50" cy="37" r="17" fill="#f2d9bd"/><path d="M18 100c0-17.6 14.4-32 32-32s32 14.4 32 32z" fill="#f2d9bd"/></svg></div></div>
    </div>

    <div role="gridcell" class="chat">
      <div class="av x1okw0bk xbelrpt" style="width:44px;height:44px"><div class="x1n2onr6 x1c9tyrk xeusxvb x1pahc9y x1ertn4p"><svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#3f7f5c"/><circle cx="50" cy="37" r="17" fill="#f2d9bd"/><path d="M18 100c0-17.6 14.4-32 32-32s32 14.4 32 32z" fill="#f2d9bd"/></svg></div></div>
      <div class="meta">
        <div class="nm x14ug900 x78zum5 x1iyjqo2 x1jchvi3 xdod15v x6ikm8r x10wlt62 x1mzt3pk x1yc453h xo1l8bm">Alice</div>
        <div class="pv xjbqb8w x1iyjqo2 x1f6kntn x1fc57z9 x6ikm8r x10wlt62 x1yc453h xlyipyv xuxw1ft xo1l8bm">Hey, are we still on for tonight?</div>
      </div>
    </div>

    <div role="gridcell" class="chat">
      <div class="av x1okw0bk xbelrpt" style="width:44px;height:44px"><div class="x1n2onr6 x1c9tyrk xeusxvb x1pahc9y x1ertn4p"><svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#b06a3b"/><circle cx="50" cy="37" r="17" fill="#f2d9bd"/><path d="M18 100c0-17.6 14.4-32 32-32s32 14.4 32 32z" fill="#f2d9bd"/></svg></div></div>
      <div class="meta">
        <div class="nm x14ug900 x78zum5 x1iyjqo2 x1jchvi3 xdod15v x6ikm8r x10wlt62 x1mzt3pk x1yc453h xo1l8bm">Design team</div>
        <div class="pv xjbqb8w x1iyjqo2 x1f6kntn x1fc57z9 x6ikm8r x10wlt62 x1yc453h xlyipyv xuxw1ft xo1l8bm">Priya: pushed the new mockups</div>
      </div>
    </div>

    <div role="gridcell" class="chat">
      <div class="av x1okw0bk xbelrpt" style="width:44px;height:44px"><div class="x1n2onr6 x1c9tyrk xeusxvb x1pahc9y x1ertn4p"><svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#4a5f8a"/><circle cx="50" cy="37" r="17" fill="#f2d9bd"/><path d="M18 100c0-17.6 14.4-32 32-32s32 14.4 32 32z" fill="#f2d9bd"/></svg></div></div>
      <div class="meta">
        <div class="nm x14ug900 x78zum5 x1iyjqo2 x1jchvi3 xdod15v x6ikm8r x10wlt62 x1mzt3pk x1yc453h xo1l8bm">Sam</div>
        <div class="pv xjbqb8w x1iyjqo2 x1f6kntn x1fc57z9 x6ikm8r x10wlt62 x1yc453h xlyipyv xuxw1ft xo1l8bm">thanks, got it</div>
      </div>
    </div>
  </div>

  <div id="main">
    <header class="main-head">
      <div role="button"><div class="x1n2onr6 x16ye13r x5lhr3w av" style="width:38px;height:38px"><svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#3f7f5c"/><circle cx="50" cy="37" r="17" fill="#f2d9bd"/><path d="M18 100c0-17.6 14.4-32 32-32s32 14.4 32 32z" fill="#f2d9bd"/></svg></div></div>
      <div class="x6s0dn4 xhslqc4 x78zum5 x1f6kntn xd4r4e8 x1gslohp xvrgn94 x1yc453h"><span class="t">Alice</span></div>
    </header>

    <div class="bubbles">
      <div data-testid="msg-container" class="in"><div>Hey, are we still on for tonight?<span class="stamp">19:40</span></div></div>
      <div data-testid="msg-container" class="in"><div>I booked the table for 7.<span class="stamp">19:41</span></div></div>
      <div data-testid="msg-container" class="shot"><div role="button" class="x1n2onr6 x1c9tyrk"><span class="ph"><svg viewBox="0 0 250 146"><rect width="250" height="146" fill="#2f5d7c"/><circle cx="198" cy="32" r="19" fill="#f5c26b"/><path d="M0 146l68-60 50 42 42-34 90 52z" fill="#3f7f5c"/><path d="M0 146l84-44 58 32 44-26 64 38z" fill="#2c5f45"/></svg></span></div></div>
      <div data-testid="msg-container" class="out"><div>Perfect, see you there.<span class="stamp">19:42</span></div></div>
    </div>

    <div class="composer"><div class="lexical-rich-text-input">On my way, five minutes</div></div>
  </div>
</div>
</body></html>`;

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

    /* ------------------------------------------------------- effect on a page */
    /*
     * Served at the real origin through request interception, so the content
     * script matches and injects for real - the same trick tools/e2e.js uses.
     *
     * The demo page is an ordinary web page and therefore has no chrome.storage
     * of its own, so settings are written from an extension page. The popup is
     * already open on an extension origin, so it doubles as the writer.
     */
    const setSettings = (value) => applySettings(popup, value);

    const demo = await context.newPage();
    await demo.setViewportSize({ width: 900, height: 620 });
    await demo.route("https://web.whatsapp.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: DEMO_PAGE })
    );
    await demo.goto("https://web.whatsapp.com/");
    await demo.waitForSelector('[data-testid="msg-container"]');
    await demo.waitForTimeout(300);

    /* Master switch off: the content script removes every stylesheet. */
    await setSettings(OFF);
    await demo.waitForTimeout(300);
    await demo.screenshot({ path: path.join(OUT, "blur-before.png"), omitBackground: true });

    /* Master switch on: every enabled feature injects its stylesheet. */
    await setSettings(SHOWCASE);
    await demo.waitForTimeout(300);
    await demo.screenshot({ path: path.join(OUT, "blur-after.png"), omitBackground: true });

    /* Hovering one bubble is the whole point of the extension - show the peek. */
    await demo.locator('[data-testid="msg-container"]').nth(1).hover();
    await demo.waitForTimeout(300);
    await demo.screenshot({ path: path.join(OUT, "blur-hover.png"), omitBackground: true });

    await demo.close();
    await popup.close();
  } finally {
    await context.close();
  }

  report();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
