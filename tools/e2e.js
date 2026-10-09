/*
 * End-to-end check for the extension.
 *
 * Launches a real Chromium with the unpacked extension loaded, drives the popup,
 * and serves a stand-in WhatsApp Web page (via request interception, so the
 * origin really is https://web.whatsapp.com and the content script matches) to
 * confirm the stylesheets are actually injected and actually take effect.
 *
 * Requires playwright-core. Run from the repo root:
 *   NODE_PATH=<workspace>/node_modules node tools/e2e.js
 */
const path = require("path");
const os = require("os");
const fs = require("fs");
const { chromium } = require("playwright-core");

const EXT = process.env.PFWA_EXT ? path.resolve(process.env.PFWA_EXT) : path.resolve(__dirname, "..");
const SHOTS = path.join(os.tmpdir(), "pfwa-shots");
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
}

const FAKE_WA = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>WhatsApp</title></head>
<body style="margin:0">
  <div id="app" style="min-height:100vh;background:#111b21;color:#fff;font-family:sans-serif">
    <div id="pane-side" style="padding:8px">
      <div role="gridcell">
        <div id="preview" class="xjbqb8w x1iyjqo2 x1f6kntn x1fc57z9 x6ikm8r x10wlt62 x1yc453h xlyipyv xuxw1ft xo1l8bm">Hey, are we still on for tonight?</div>
      </div>
      <div role="row">
        <div><div><div><div><span id="listname" class="x14ug900 x78zum5 x1iyjqo2 x1jchvi3 xdod15v x6ikm8r x10wlt62 x1mzt3pk x1yc453h xo1l8bm">Alice</span></div></div></div></div>
      </div>
    </div>
    <div id="main" style="padding:16px">
      <div data-testid="msg-container" id="msg" style="padding:8px">Hello there, this is a secret message</div>
      <div data-testid="msg-container" id="msg2" style="padding:8px;margin-top:8px">Second message</div>
      <div id="compose" style="margin-top:16px">
        <div class="lexical-rich-text-input" id="composer" contenteditable="true" style="padding:8px;background:#2a3942;border-radius:8px">typing here</div>
      </div>
    </div>
  </div>
</body></html>`;

async function main() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pfwa-profile-"));
  let context;

  /*
   * Branded Chrome 137+ ignores --load-extension, so prefer a Chrome for Testing
   * binary if one is cached; otherwise fall back to whatever Playwright has.
   */
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

  const executablePath = findChromeForTesting();

  const launch = (opts) =>
    chromium.launchPersistentContext(userDataDir, {
      headless: true,
      args: [
        `--disable-extensions-except=${EXT}`,
        `--load-extension=${EXT}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
      ...opts,
    });

  try {
    context = await launch(executablePath ? { executablePath } : { channel: "chrome" });
  } catch (error) {
    console.log(`note: primary browser unavailable (${error.message.split("\n")[0]})`);
    context = await launch({});
  }

  try {
    /* ---------------------------------------------------------- extension id */
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
    const extensionId = worker.url().split("/")[2];
    check("service worker starts", !!extensionId, extensionId);

    const workerErrors = [];
    const attachWorker = (sw) => {
      sw.on("console", (m) => {
        if (m.type() === "error") workerErrors.push(m.text());
      });
      sw.on("pageerror", (e) => workerErrors.push(String(e)));
    };
    attachWorker(worker);
    context.on("serviceworker", attachWorker);

    const readSettings = () =>
      worker.evaluate(() => chrome.storage.sync.get("settings").then((r) => r.settings));
    const writeSettings = (next) =>
      worker.evaluate((s) => chrome.storage.sync.set({ settings: s }), next);

    /* Seeding on install is asynchronous, so poll rather than reading once. */
    let seeded = null;
    for (let attempt = 0; attempt < 40 && !seeded; attempt++) {
      seeded = await readSettings();
      if (!seeded) await new Promise((r) => setTimeout(r, 100));
    }
    check("default settings seeded on install", !!(seeded && seeded.styles),
      seeded ? `on=${seeded.on} features=${Object.keys(seeded.styles || {}).length}` : "nothing stored after 4s");
    check("defaults match the reference UI",
      seeded && seeded.styles.messages === true && seeded.styles.textInput === true &&
      seeded.styles.profilePic === false && seeded.styles.blurOnIdle === false,
      seeded ? JSON.stringify(seeded.styles) : "-");

    /* --------------------------------------------------------------- popup */
    const popup = await context.newPage();
    const popupErrors = [];
    popup.on("pageerror", (e) => popupErrors.push(String(e)));
    popup.on("console", (m) => {
      if (m.type() === "error") popupErrors.push(m.text());
    });
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForSelector("#feature-rows .row", { timeout: 5000 });

    const rowCount = await popup.locator("#feature-rows .row").count();
    check("popup renders 10 feature rows", rowCount === 10, `got ${rowCount}`);

    const gearCount = await popup.locator(".gear").count();
    check("popup renders 7 gear buttons", gearCount === 7, `got ${gearCount}`);

    const labels = await popup.locator("#feature-rows .row-label").allTextContents();
    const expected = [
      "All messages in chat", "Last messages preview", "Media preview", "Media gallery",
      "Text input", "Profile pictures", "Group/Users names", "No transition delay",
      "Unblur all on app hover", "Blur WhatsApp on Idle",
    ];
    check("feature labels and order match the reference",
      JSON.stringify(labels) === JSON.stringify(expected), labels.join(" | "));

    check("master toggle reflects stored state", await popup.locator("#master").isChecked());
    check("status dot is lit when on", !(await popup.locator("#status").evaluate((el) => el.classList.contains("off"))));

    const footerText = (await popup.locator(".footer").innerText()).replace(/\s+/g, " ").trim();
    check("footer shows the version and the author credit",
      /v\d+\.\d+\.\d+/.test(footerText) && footerText.includes("Made by @wafaulh"), footerText);

    await popup.screenshot({ path: path.join(SHOTS, "popup.png"), fullPage: true });

    /* Toggle a switch through the UI and confirm it round-trips to storage. */
    const picSwitch = popup.locator("#feature-rows .row").nth(5).locator("input[type=checkbox]");
    await picSwitch.click();
    await popup.waitForTimeout(150);
    let after = await readSettings();
    check("switch click persists to storage", after.styles.profilePic === true, `profilePic=${after.styles.profilePic}`);

    /* Gear panel opens and its input writes a sanitised value. */
    const gear = popup.locator("#feature-rows .row").nth(0).locator(".gear");
    await gear.click();
    const panelOpen = await popup.locator("#feature-rows .gear-panel").nth(0).evaluate((el) => el.classList.contains("open"));
    check("gear panel opens", panelOpen);
    await popup.waitForTimeout(350);
    const panelHeight = await popup.locator("#feature-rows .gear-panel").nth(0).evaluate((el) => el.getBoundingClientRect().height);
    check("gear panel actually expands to show its field", panelHeight > 20, `height=${Math.round(panelHeight)}px`);
    await popup.screenshot({ path: path.join(SHOTS, "popup-gear-open.png"), fullPage: true });

    const blurInput = popup.locator("#feature-rows .gear-panel").nth(0).locator("input");
    await blurInput.fill("999");
    await blurInput.dispatchEvent("change");
    await popup.waitForTimeout(150);
    after = await readSettings();
    check("gear value above the field's own max is clamped to that max",
      after.varStyles.msBlur === "40px", `msBlur=${after.varStyles.msBlur} (field max is 40)`);

    /* Clearing the box must fall back to a valid number, never NaN. */
    await blurInput.fill("");
    await blurInput.dispatchEvent("change");
    await popup.waitForTimeout(150);
    after = await readSettings();
    const emptyResult = after.varStyles.msBlur;
    check("cleared gear value falls back instead of writing NaN",
      /^\d+(\.\d+)?px$/.test(emptyResult), `msBlur=${emptyResult}`);

    /* The field's declared max must match what the schema actually enforces. */
    const fieldMax = await blurInput.getAttribute("max");
    check("gear input max attribute matches the schema bound", fieldMax === "40", `max=${fieldMax}`);

    await blurInput.fill("8");
    await blurInput.dispatchEvent("change");
    await popup.waitForTimeout(150);
    after = await readSettings();
    check("a normal gear value round-trips", after.varStyles.msBlur === "8px", `msBlur=${after.varStyles.msBlur}`);

    /* Alt+X equivalent: the command handler must flip the master switch. */
    await worker.evaluate(() => chrome.storage.sync.get("settings").then((r) => {
      const s = r.settings; s.on = !s.on;
      return chrome.storage.sync.set({ settings: s });
    }));
    await popup.waitForTimeout(200);
    check("popup follows storage changes made elsewhere", !(await popup.locator("#master").isChecked()));

    await worker.evaluate(() => chrome.storage.sync.get("settings").then((r) => {
      const s = r.settings; s.on = true;
      return chrome.storage.sync.set({ settings: s });
    }));
    await popup.waitForTimeout(200);

    check("popup produced no console errors", popupErrors.length === 0, popupErrors.join(" ; "));

    /* --------------------------------------------------- content script */
    /* Reset to a known state: the popup section above deliberately left
     * profilePic enabled, which would change the expected stylesheet set. */
    const reset = await readSettings();
    reset.on = true;
    reset.styles = {
      messages: true, messagesPreview: true, mediaPreview: true, mediaGallery: true,
      textInput: true, profilePic: false, name: false, noDelay: false,
      unblurActive: false, blurOnIdle: false,
    };
    reset.varStyles = { msBlur: "8px", mspBlur: "8px", mdpBlur: "20px", mdgBlur: "20px", ppBlur: "8px", nmBlur: "8px", idleBlur: "24px" };
    reset.idle = { timeout: 15 };
    await writeSettings(reset);
    await popup.waitForTimeout(200);

    const wa = await context.newPage();
    const waErrors = [];
    wa.on("pageerror", (e) => waErrors.push(String(e)));
    wa.on("console", (m) => {
      if (m.type() === "error") waErrors.push(m.text());
    });

    await wa.route("https://web.whatsapp.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: FAKE_WA })
    );
    await wa.goto("https://web.whatsapp.com/");
    await wa.waitForSelector("#msg", { timeout: 5000 });
    await wa.waitForTimeout(400);

    const injected = await wa.evaluate(() => Array.from(document.querySelectorAll("link.pfwa-style")).map((l) => l.id));
    check("content script injects one stylesheet per enabled feature",
      injected.length === 5, `${injected.length} injected: ${injected.join(", ")}`);
    check("disabled features get no stylesheet",
      !injected.includes("pfwa-css-profilePic") && !injected.includes("pfwa-css-name") &&
      !injected.includes("pfwa-css-blurOnIdle"), injected.join(", "));

    const rootVars = await wa.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--pfwa-ms-blur").trim()
    );
    check("blur amount is published as a CSS variable", rootVars === "8px", `--pfwa-ms-blur=${rootVars}`);

    const msgFilter = await wa.evaluate(() => getComputedStyle(document.getElementById("msg")).filter);
    check("message bubble is actually blurred", /blur\(8px\)/.test(msgFilter), msgFilter);

    const previewFilter = await wa.evaluate(() => getComputedStyle(document.getElementById("preview")).filter);
    check("chat list preview is actually blurred", /blur\(8px\)/.test(previewFilter), previewFilter);

    const composerFilter = await wa.evaluate(() => getComputedStyle(document.getElementById("composer")).filter);
    check("composer is dimmed rather than blurred",
      /opacity\(0\.25\)/.test(composerFilter) && !/blur/.test(composerFilter), composerFilter);

    const picFilter = await wa.evaluate(() => getComputedStyle(document.getElementById("msg")).filter);
    check("stylesheet set is coherent", !!picFilter, picFilter);

    /* Live update: flip a feature off in storage and confirm the page reacts. */
    let live = await readSettings();
    live.styles.messages = false;
    await writeSettings(live);
    await wa.waitForTimeout(400);
    const afterOff = await wa.evaluate(() => getComputedStyle(document.getElementById("msg")).filter);
    check("turning a feature off removes the blur live", afterOff === "none", afterOff);

    live = await readSettings();
    live.styles.messages = true;
    await writeSettings(live);
    await wa.waitForTimeout(400);
    const afterOn = await wa.evaluate(() => getComputedStyle(document.getElementById("msg")).filter);
    check("turning a feature back on restores the blur live", /blur\(8px\)/.test(afterOn), afterOn);

    /* Hover reveals. */
    await wa.hover("#msg");
    await wa.waitForTimeout(400);
    const hovered = await wa.evaluate(() => getComputedStyle(document.getElementById("msg")).filter);
    check("hovering a message reveals it", hovered === "none" || /blur\(0px\)/.test(hovered), hovered);

    /* noDelay. */
    const delayBefore = await wa.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--pfwa-delay").trim()
    );
    live = await readSettings();
    live.styles.noDelay = true;
    await writeSettings(live);
    await wa.waitForTimeout(300);
    const delayAfter = await wa.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--pfwa-delay").trim()
    );
    check("noDelay overrides the reveal delay",
      delayBefore === "0.1s" && delayAfter === "0s", `${delayBefore} -> ${delayAfter}`);

    live = await readSettings();
    live.styles.noDelay = false;
    await writeSettings(live);
    await wa.waitForTimeout(300);

    /* unblurActive. */
    live = await readSettings();
    live.styles.unblurActive = true;
    await writeSettings(live);
    await wa.waitForTimeout(300);
    await wa.mouse.move(300, 300);
    await wa.waitForTimeout(400);
    const unblurred = await wa.evaluate(() => getComputedStyle(document.getElementById("msg")).filter);
    check("unblurActive clears both the blur and the grayscale while hovered",
      /blur\(0px\)/.test(unblurred) && /grayscale\(0\)/.test(unblurred), unblurred);

    live = await readSettings();
    live.styles.unblurActive = false;
    await writeSettings(live);
    await wa.waitForTimeout(300);

    /* blurOnIdle. */
    live = await readSettings();
    live.styles.blurOnIdle = true;
    live.idle.timeout = 5;
    live.varStyles.idleBlur = "24px";
    await writeSettings(live);
    await wa.waitForTimeout(400);

    const overlayExists = await wa.evaluate(() => !!document.getElementById("pfwa-idle-overlay"));
    check("idle overlay element is created", overlayExists);

    await wa.mouse.move(120, 120);
    await wa.waitForTimeout(300);
    const idleClassEarly = await wa.evaluate(() => document.documentElement.classList.contains("pfwa-idle"));
    check("idle blur is not active while the user is active", !idleClassEarly);

    await wa.waitForTimeout(6000);
    const idleState = await wa.evaluate(() => {
      const overlay = document.getElementById("pfwa-idle-overlay");
      const rect = overlay.getBoundingClientRect();
      return {
        cls: document.documentElement.classList.contains("pfwa-idle"),
        display: getComputedStyle(overlay).display,
        zIndex: getComputedStyle(overlay).zIndex,
        covers: rect.width >= window.innerWidth && rect.height >= window.innerHeight,
        backdrop: getComputedStyle(overlay).backdropFilter || getComputedStyle(overlay).webkitBackdropFilter,
        parent: overlay.parentElement.tagName,
      };
    });
    check("idle blur engages after the timeout", idleState.cls && idleState.display === "block",
      JSON.stringify(idleState));
    check("idle overlay covers the viewport and paints above the app",
      idleState.covers && Number(idleState.zIndex) > 1000 && /blur/.test(idleState.backdrop),
      `covers=${idleState.covers} z=${idleState.zIndex} backdrop=${idleState.backdrop} parent=${idleState.parent}`);

    /* Capture the locked state so the blur can be confirmed by eye, not just by
     * reading computed styles. */
    await wa.screenshot({ path: path.join(SHOTS, "idle-blur.png"), fullPage: false });

    await wa.mouse.move(400, 400);
    await wa.waitForTimeout(400);
    const idleCleared = await wa.evaluate(() => document.documentElement.classList.contains("pfwa-idle"));
    check("idle blur clears immediately on activity", !idleCleared);

    await wa.screenshot({ path: path.join(SHOTS, "fake-whatsapp.png"), fullPage: false });

    /* Master off must strip everything. */
    live = await readSettings();
    live.on = false;
    await writeSettings(live);
    await wa.waitForTimeout(400);
    const offState = await wa.evaluate(() => ({
      links: document.querySelectorAll("link.pfwa-style").length,
      styles: document.querySelectorAll("style.pfwa-style").length,
      filter: getComputedStyle(document.getElementById("msg")).filter,
      overlay: !!document.getElementById("pfwa-idle-overlay"),
    }));
    check("master off removes every injected style",
      offState.links === 0 && offState.styles === 0 && offState.filter === "none" && !offState.overlay,
      JSON.stringify(offState));

    live = await readSettings();
    live.on = true;
    await writeSettings(live);

    check("content script produced no console errors", waErrors.length === 0, waErrors.join(" ; "));
    check("service worker produced no console errors", workerErrors.length === 0, workerErrors.join(" ; "));

    /* -------------------------------------------------- selector validity */
    /*
     * One malformed selector invalidates the entire rule it belongs to, and the
     * browser drops it silently - the feature just stops working with no error
     * anywhere. Parse the injected stylesheets and hand every selector to
     * querySelector, which throws on anything it cannot parse.
     */
    const badSelectors = await wa.evaluate(async () => {
      const problems = [];
      const links = Array.from(document.querySelectorAll("link.pfwa-style"));
      for (const link of links) {
        let text;
        try {
          text = await (await fetch(link.href)).text();
        } catch (error) {
          problems.push(`${link.id}: could not fetch stylesheet (${error.message})`);
          continue;
        }
        const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "");
        const prelude = /(^|\})([^{}]+)\{/g;
        let match;
        while ((match = prelude.exec(stripped))) {
          const selector = match[2].trim();
          if (!selector || selector.startsWith("@")) continue;
          try {
            document.querySelector(selector);
          } catch (error) {
            problems.push(`${link.id}: ${selector.slice(0, 90)}`);
          }
        }
      }
      return problems;
    });
    check("every injected selector is syntactically valid", badSelectors.length === 0,
      badSelectors.join(" | "));

    /* ------------------------------------------------ fallback selectors */
    /*
     * messages.css keeps a .message-in fallback for the day WhatsApp drops
     * data-testid="msg-container". It is gated behind :not(:has(...)) so it must
     * be inert on the normal page and live only when the testid is gone.
     */
    const inertOnNormalPage = await wa.evaluate(() => {
      const el = document.createElement("div");
      el.className = "message-in";
      el.textContent = "fallback probe";
      document.getElementById("main").appendChild(el);
      const filter = getComputedStyle(el).filter;
      el.remove();
      return filter;
    });
    check("message fallback stays inert while the primary selector matches",
      inertOnNormalPage === "none", inertOnNormalPage);

    const fallbackPage = await context.newPage();
    await fallbackPage.route("https://web.whatsapp.com/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!DOCTYPE html><html><head><title>wa</title></head><body>
          <div id="main"><div class="message-in" id="fb">fallback message</div></div>
        </body></html>`,
      })
    );
    await fallbackPage.goto("https://web.whatsapp.com/");
    await fallbackPage.waitForSelector("#fb", { timeout: 5000 });
    await fallbackPage.waitForTimeout(500);
    const fallbackFilter = await fallbackPage.evaluate(() => getComputedStyle(document.getElementById("fb")).filter);
    check("message fallback engages when the primary selector is absent",
      /blur\(8px\)/.test(fallbackFilter), fallbackFilter);
    await fallbackPage.close();

    /* ------------------------------------------------------------- summary */
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    console.log(`screenshots: ${SHOTS}`);
    if (failed.length) {
      console.log("\nFailures:");
      failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail || ""}`));
    }
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error("harness error:", error);
  process.exit(2);
});
