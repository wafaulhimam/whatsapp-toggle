/*
 * Privacy Blur for WhatsApp Web - popup logic.
 *
 * The rows are generated from PFWA.FEATURES so the popup and the content script
 * can never disagree about which features exist or where a value is stored.
 */
(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";
  var GEAR_TEETH = 8;

  var rowsEl = document.getElementById("feature-rows");
  var masterEl = document.getElementById("master");
  var statusEl = document.getElementById("status");
  var versionEl = document.getElementById("version");

  var settings = PFWA.normalize(null);
  var controls = {};

  /* --------------------------------------------------------------- helpers */

  function persist() {
    return chrome.storage.sync.set({ [PFWA.SETTINGS_KEY]: settings });
  }

  function buildGearIcon() {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "3");
    svg.setAttribute("stroke-linecap", "round");

    /* Short, thick radial teeth read as a cog at 16px; long thin ones just look
     * like a starburst. */
    for (var i = 0; i < GEAR_TEETH; i++) {
      var angle = (i * 2 * Math.PI) / GEAR_TEETH;
      var tooth = document.createElementNS(SVG_NS, "line");
      tooth.setAttribute("x1", String(12 + Math.cos(angle) * 6.2));
      tooth.setAttribute("y1", String(12 + Math.sin(angle) * 6.2));
      tooth.setAttribute("x2", String(12 + Math.cos(angle) * 10.4));
      tooth.setAttribute("y2", String(12 + Math.sin(angle) * 10.4));
      svg.appendChild(tooth);
    }

    var ring = document.createElementNS(SVG_NS, "circle");
    ring.setAttribute("cx", "12");
    ring.setAttribute("cy", "12");
    ring.setAttribute("r", "5.4");
    svg.appendChild(ring);

    return svg;
  }

  /* ---------------------------------------------------------------- build */

  function buildGearPanel(feature, onCommit) {
    var panel = document.createElement("div");
    panel.className = "gear-panel";
    panel.id = "gear-panel-" + feature.id;
    var inputs = [];

    feature.gear.forEach(function (field) {
      var row = document.createElement("label");
      row.className = "gear-field";

      var caption = document.createElement("span");
      caption.textContent = field.label;

      var input = document.createElement("input");
      input.type = "number";
      input.min = String(field.min);
      input.max = String(field.max);
      input.step = String(field.step);

      /* Clamp against this field's own bounds, then write the result back into
       * the box so the user sees what was actually stored. */
      input.addEventListener("change", function () {
        var sanitized = PFWA.sanitizeField(field, input.value);
        if (field.store === "idle") settings.idle[field.key] = sanitized;
        else settings.varStyles[field.key] = sanitized;
        input.value = PFWA.fieldDisplayValue(field, sanitized);
        onCommit();
      });

      var unit = document.createElement("span");
      unit.className = "unit";
      unit.textContent = field.unit;

      row.appendChild(caption);
      row.appendChild(input);
      row.appendChild(unit);
      panel.appendChild(row);
      inputs.push(input);
    });

    return { panel: panel, inputs: inputs };
  }

  function buildRow(feature) {
    var group = document.createElement("div");
    group.className = "row-group";

    var row = document.createElement("div");
    row.className = "row";

    var label = document.createElement("span");
    label.className = "row-label";
    label.textContent = feature.label;

    var controlsEl = document.createElement("div");
    controlsEl.className = "controls";

    var gearButton = null;
    var gearPanel = null;
    var gearInputs = [];

    if (feature.gear) {
      var built = buildGearPanel(feature, persist);
      gearPanel = built.panel;
      gearInputs = built.inputs;

      gearButton = document.createElement("button");
      gearButton.type = "button";
      gearButton.className = "gear";
      gearButton.setAttribute("aria-expanded", "false");
      gearButton.setAttribute("aria-controls", gearPanel.id);
      gearButton.setAttribute("aria-label", "Advanced settings for " + feature.label);
      gearButton.appendChild(buildGearIcon());

      gearButton.addEventListener("click", function () {
        var open = gearPanel.classList.toggle("open");
        gearButton.classList.toggle("active", open);
        gearButton.setAttribute("aria-expanded", String(open));
      });

      controlsEl.appendChild(gearButton);
    }

    var switchEl = document.createElement("label");
    switchEl.className = "switch";

    var checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.setAttribute("aria-label", feature.label);

    var track = document.createElement("span");
    track.className = "track";
    var knob = document.createElement("span");
    knob.className = "knob";
    track.appendChild(knob);

    switchEl.appendChild(checkbox);
    switchEl.appendChild(track);
    controlsEl.appendChild(switchEl);

    checkbox.addEventListener("change", function () {
      settings.styles[feature.id] = checkbox.checked;
      persist();
    });

    row.appendChild(label);
    row.appendChild(controlsEl);
    group.appendChild(row);

    if (gearPanel) {
      group.appendChild(gearPanel);
    }

    rowsEl.appendChild(group);
    controls[feature.id] = { checkbox: checkbox, inputs: gearInputs };
  }

  /* ---------------------------------------------------------------- render */

  function render() {
    masterEl.checked = settings.on;
    statusEl.classList.toggle("off", !settings.on);
    statusEl.setAttribute("aria-label", settings.on ? "Blur is on" : "Blur is off");

    PFWA.FEATURES.forEach(function (feature) {
      var entry = controls[feature.id];
      if (!entry) return;

      entry.checkbox.checked = !!settings.styles[feature.id];

      (feature.gear || []).forEach(function (field, index) {
        var input = entry.inputs[index];
        if (!input) return;
        var stored = field.store === "idle" ? settings.idle[field.key] : settings.varStyles[field.key];
        input.value = PFWA.fieldDisplayValue(field, stored);
      });
    });
  }

  /* ------------------------------------------------------------------ init */

  masterEl.addEventListener("change", function () {
    settings.on = masterEl.checked;
    render();
    persist();
  });

  PFWA.FEATURES.forEach(buildRow);

  versionEl.textContent = "v" + chrome.runtime.getManifest().version;

  chrome.storage.sync.get(PFWA.SETTINGS_KEY).then(function (stored) {
    var raw = stored[PFWA.SETTINGS_KEY];
    settings = PFWA.normalize(raw);
    render();
    /* Storage was empty or unreadable - write the defaults back so the content
     * script and the service worker see the same thing. */
    if (!raw) persist();
  }).catch(function (error) {
    console.error("[PFWA] could not read settings", error);
    render();
  });

  /* Keep the popup in sync when the master toggle is flipped by Alt+X while the
   * popup happens to be open. */
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "sync" || !changes[PFWA.SETTINGS_KEY]) return;
    settings = PFWA.normalize(changes[PFWA.SETTINGS_KEY].newValue);
    render();
  });
})();
