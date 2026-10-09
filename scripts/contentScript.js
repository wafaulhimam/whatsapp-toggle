/*
 * Privacy Blur for WhatsApp Web - content script.
 *
 * This is the whole runtime. It never inspects or mutates WhatsApp's own
 * elements; it only appends <link>/<style> nodes to <head> and toggles one class
 * on <html>. All the actual hiding is done by the stylesheets in css/.
 *
 * Settings flow: the popup and the service worker write to chrome.storage.sync,
 * and this script reconciles the injected stylesheets whenever storage changes.
 * There is no message passing and no state that survives a page reload.
 */
(function () {
  "use strict";

  var STYLE_CLASS = "pfwa-style";
  var VAR_STYLE_ID = "pfwa-variables";
  var IDLE_CLASS = "pfwa-idle";
  var OVERLAY_ID = "pfwa-idle-overlay";
  var LINK_PREFIX = "pfwa-css-";

  /* Any of these means "the user is here", which cancels the idle blur. */
  var ACTIVITY_EVENTS = ["mousemove", "mousedown", "pointerdown", "keydown", "wheel", "touchstart"];
  var IDLE_THROTTLE_MS = 1000;

  var settings = PFWA.normalize(null);
  var idleTimer = null;
  var lastActivityAt = 0;
  var activityBound = false;

  function head() {
    return document.head || document.documentElement;
  }

  function removeNodeById(id) {
    var el = document.getElementById(id);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function removeAllStyles() {
    var nodes = document.querySelectorAll("." + STYLE_CLASS);
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
    }
  }

  /*
   * Each feature owns exactly one stylesheet. Injecting them individually means
   * a selector that WhatsApp breaks only takes down its own feature instead of
   * the whole extension.
   */
  function addStyleById(id) {
    if (document.getElementById(LINK_PREFIX + id)) return;

    var link = document.createElement("link");
    link.id = LINK_PREFIX + id;
    link.className = STYLE_CLASS;
    link.rel = "stylesheet";
    link.type = "text/css";
    link.href = chrome.runtime.getURL("css/" + id + ".css");
    head().appendChild(link);
  }

  function removeStyleById(id) {
    removeNodeById(LINK_PREFIX + id);
  }

  /*
   * Writes the tunable values into a single <style> block on :root. Defining the
   * custom properties on :root rather than on a WhatsApp-owned element means we
   * do not depend on any of their markup existing.
   */
  function applyVarStyles(varStyles) {
    var lines = [];

    PFWA.VAR_KEYS.forEach(function (key) {
      var value = varStyles[key];
      if (typeof value === "string" && value) {
        lines.push("  " + PFWA.cssVarName(key) + ": " + value + ";");
      }
    });

    /* Reveal delay. The "No transition delay" stylesheet overrides this one
     * variable, which is why that feature needs no selector list of its own. */
    lines.push("  --pfwa-delay: 0.1s;");

    var el = document.getElementById(VAR_STYLE_ID);
    if (!el) {
      el = document.createElement("style");
      el.id = VAR_STYLE_ID;
      el.className = STYLE_CLASS;
      head().appendChild(el);
    }
    el.textContent = ":root {\n" + lines.join("\n") + "\n}\n";
  }

  /* ---------------------------------------------------------------- idle blur */

  function ensureOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;
    var el = document.createElement("div");
    el.id = OVERLAY_ID;
    /* Purely decorative: screen readers should not announce it. */
    el.setAttribute("aria-hidden", "true");
    /* High z-index keeps the overlay above WhatsApp's own root regardless of
     * where in the document it ends up. */
    (document.body || document.documentElement).appendChild(el);
  }

  function clearIdleTimer() {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function armIdleTimer() {
    clearIdleTimer();
    document.documentElement.classList.remove(IDLE_CLASS);
    idleTimer = setTimeout(function () {
      idleTimer = null;
      document.documentElement.classList.add(IDLE_CLASS);
    }, settings.idle.timeout * 1000);
  }

  function onActivity() {
    if (!settings.on || !settings.styles.blurOnIdle) return;

    var isIdle = document.documentElement.classList.contains(IDLE_CLASS);
    var now = Date.now();

    /* Coming out of idle must be immediate, but while the user is simply moving
     * the mouse there is no point tearing down and rebuilding a timer 60 times a
     * second - once a second is plenty against a 5s minimum timeout. */
    if (!isIdle && now - lastActivityAt < IDLE_THROTTLE_MS) return;

    lastActivityAt = now;
    armIdleTimer();
  }

  function startIdle() {
    ensureOverlay();
    if (!activityBound) {
      ACTIVITY_EVENTS.forEach(function (name) {
        window.addEventListener(name, onActivity, { passive: true, capture: true });
      });
      activityBound = true;
    }
    armIdleTimer();
  }

  function stopIdle() {
    clearIdleTimer();
    document.documentElement.classList.remove(IDLE_CLASS);
    if (activityBound) {
      ACTIVITY_EVENTS.forEach(function (name) {
        window.removeEventListener(name, onActivity, { capture: true });
      });
      activityBound = false;
    }
    removeNodeById(OVERLAY_ID);
  }

  /* -------------------------------------------------------------- reconcile */

  function reconcile(next) {
    settings = next;

    if (!settings.on) {
      removeAllStyles();
      stopIdle();
      return;
    }

    applyVarStyles(settings.varStyles);

    PFWA.FEATURES.forEach(function (feature) {
      if (settings.styles[feature.id]) addStyleById(feature.id);
      else removeStyleById(feature.id);
    });

    if (settings.styles.blurOnIdle) startIdle();
    else stopIdle();
  }

  function load() {
    chrome.storage.sync.get(PFWA.SETTINGS_KEY).then(function (stored) {
      reconcile(PFWA.normalize(stored[PFWA.SETTINGS_KEY]));
    }).catch(function (error) {
      /* Storage unavailable: fall back to defaults rather than showing nothing. */
      console.error("[PFWA] could not read settings, using defaults", error);
      reconcile(PFWA.defaults());
    });
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "sync" || !changes[PFWA.SETTINGS_KEY]) return;
    reconcile(PFWA.normalize(changes[PFWA.SETTINGS_KEY].newValue));
  });

  /*
   * run_at is document_start so the blur is in place before WhatsApp paints.
   * document.head may not exist yet at that point, hence the wait.
   */
  if (document.head) {
    load();
  } else {
    var observer = new MutationObserver(function () {
      if (document.head) {
        observer.disconnect();
        load();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
