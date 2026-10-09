/*
 * Privacy Blur for WhatsApp Web - service worker.
 *
 * Deliberately stateless: every handler re-reads chrome.storage.sync. MV3 can
 * tear this worker down at any moment, so nothing may be cached in a module
 * variable.
 */
importScripts("shared/settings.js");

/* Write defaults on first install, and backfill any newly added keys on
 * upgrade without clobbering the user's existing choices. */
chrome.runtime.onInstalled.addListener(function (details) {
  chrome.storage.sync.get(PFWA.SETTINGS_KEY).then(function (stored) {
    var existing = stored[PFWA.SETTINGS_KEY];
    var next = details.reason === "install" || !existing ? PFWA.defaults() : PFWA.normalize(existing);
    return chrome.storage.sync.set({ [PFWA.SETTINGS_KEY]: next });
  }).catch(function (error) {
    console.error("[PFWA] failed to seed settings", error);
  });
});

/* Alt+X (rebindable at chrome://extensions/shortcuts). */
chrome.commands.onCommand.addListener(function (command) {
  if (command !== "toggle") return;

  chrome.storage.sync.get(PFWA.SETTINGS_KEY).then(function (stored) {
    var settings = PFWA.normalize(stored[PFWA.SETTINGS_KEY]);
    settings.on = !settings.on;
    return chrome.storage.sync.set({ [PFWA.SETTINGS_KEY]: settings });
  }).catch(function (error) {
    console.error("[PFWA] failed to toggle", error);
  });
});
