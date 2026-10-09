/*
 * Privacy Blur for WhatsApp Web
 * Shared settings schema - single source of truth for the popup, the content
 * script and the service worker.
 *
 * Loaded three different ways, all of which end up exposing `PFWA` on the
 * global object:
 *   - popup:          <script src="../shared/settings.js">
 *   - content script: listed before contentScript.js in manifest.json
 *   - service worker: importScripts("shared/settings.js")
 */
(function (root) {
  "use strict";

  var SETTINGS_KEY = "settings";

  /*
   * Feature order here drives the order of the rows in the popup, so keep it
   * matching the reference UI.
   *
   * `gear` is a list of advanced fields. Each field declares where its value is
   * persisted:
   *   store: "varStyles" -> settings.varStyles[key]   (a CSS length, e.g. "8px")
   *   store: "idle"      -> settings.idle[key]        (a plain number, seconds)
   * A feature without `gear` has no cog button.
   */
  var FEATURES = [
    {
      id: "messages",
      label: "All messages in chat",
      defaultOn: true,
      gear: [{ store: "varStyles", key: "msBlur", label: "Blur amount", min: 0, max: 40, step: 1, unit: "px", def: 8 }]
    },
    {
      id: "messagesPreview",
      label: "Last messages preview",
      defaultOn: true,
      gear: [{ store: "varStyles", key: "mspBlur", label: "Blur amount", min: 0, max: 40, step: 1, unit: "px", def: 8 }]
    },
    {
      id: "mediaPreview",
      label: "Media preview",
      defaultOn: true,
      gear: [{ store: "varStyles", key: "mdpBlur", label: "Blur amount", min: 0, max: 60, step: 1, unit: "px", def: 20 }]
    },
    {
      id: "mediaGallery",
      label: "Media gallery",
      defaultOn: true,
      gear: [{ store: "varStyles", key: "mdgBlur", label: "Blur amount", min: 0, max: 60, step: 1, unit: "px", def: 20 }]
    },
    {
      id: "textInput",
      label: "Text input",
      defaultOn: true
    },
    {
      id: "profilePic",
      label: "Profile pictures",
      defaultOn: false,
      gear: [{ store: "varStyles", key: "ppBlur", label: "Blur amount", min: 0, max: 40, step: 1, unit: "px", def: 8 }]
    },
    {
      id: "name",
      label: "Group/Users names",
      defaultOn: false,
      gear: [{ store: "varStyles", key: "nmBlur", label: "Blur amount", min: 0, max: 40, step: 1, unit: "px", def: 8 }]
    },
    {
      id: "noDelay",
      label: "No transition delay",
      defaultOn: false
    },
    {
      id: "unblurActive",
      label: "Unblur all on app hover",
      defaultOn: false
    },
    {
      id: "blurOnIdle",
      label: "Blur WhatsApp on Idle",
      defaultOn: false,
      gear: [
        { store: "idle", key: "timeout", label: "Idle timeout", min: 5, max: 600, step: 5, unit: "s", def: 15 },
        { store: "varStyles", key: "idleBlur", label: "Blur amount", min: 4, max: 60, step: 1, unit: "px", def: 24 }
      ]
    }
  ];

  /* Every varStyles key referenced by any gear, in declaration order. */
  var VAR_KEYS = [];
  FEATURES.forEach(function (feature) {
    (feature.gear || []).forEach(function (field) {
      if (field.store === "varStyles" && VAR_KEYS.indexOf(field.key) === -1) {
        VAR_KEYS.push(field.key);
      }
    });
  });

  var IDLE_KEYS = [];
  FEATURES.forEach(function (feature) {
    (feature.gear || []).forEach(function (field) {
      if (field.store === "idle" && IDLE_KEYS.indexOf(field.key) === -1) {
        IDLE_KEYS.push(field.key);
      }
    });
  });

  /*
   * Storage is user-writable in principle, so every value is coerced back into
   * a known-good shape. This also means a hostile value in storage can never
   * smuggle arbitrary CSS into the page through a CSS custom property.
   */
  function clampNumber(value, min, max, fallback) {
    var safeFallback = isFinite(fallback) ? fallback : min;
    var n = typeof value === "number" ? value : parseFloat(String(value).replace(/[^0-9.\-]/g, ""));
    if (!isFinite(n)) return safeFallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  /*
   * Coerces a value against the bounds of the specific field it belongs to, not
   * against the global limits - a blur field capped at 40px must not accept 60
   * just because some other field allows it. Returns a "Npx" string for blur
   * fields and a whole number of seconds for idle fields.
   */
  function sanitizeField(field, value) {
    var clamped = clampNumber(value, field.min, field.max, field.def);
    return field.store === "idle" ? Math.round(clamped) : clamped + "px";
  }

  /* Renders a sanitised field value for display in a number input. */
  function fieldDisplayValue(field, sanitized) {
    return field.store === "idle" ? String(sanitized) : String(parseFloat(sanitized));
  }

  function defaults() {
    var styles = {};
    var varStyles = {};
    var idle = {};

    FEATURES.forEach(function (feature) {
      styles[feature.id] = feature.defaultOn;
      (feature.gear || []).forEach(function (field) {
        if (field.store === "varStyles") varStyles[field.key] = field.def + "px";
        if (field.store === "idle") idle[field.key] = field.def;
      });
    });

    return { on: true, styles: styles, varStyles: varStyles, idle: idle };
  }

  /*
   * Always returns a complete, valid settings object. Missing keys are filled
   * from defaults, so a user upgrading from an older version - or with cleared
   * sync storage - never sees a broken popup or a half-applied state.
   */
  function normalize(raw) {
    var base = defaults();
    if (!raw || typeof raw !== "object") return base;

    var out = {
      on: typeof raw.on === "boolean" ? raw.on : base.on,
      styles: {},
      varStyles: {},
      idle: {}
    };

    FEATURES.forEach(function (feature) {
      var stored = raw.styles && raw.styles[feature.id];
      out.styles[feature.id] = typeof stored === "boolean" ? stored : base.styles[feature.id];

      (feature.gear || []).forEach(function (field) {
        var rawValue = field.store === "idle"
          ? raw.idle && raw.idle[field.key]
          : raw.varStyles && raw.varStyles[field.key];
        var sanitized = sanitizeField(field, rawValue);
        if (field.store === "idle") out.idle[field.key] = sanitized;
        else out.varStyles[field.key] = sanitized;
      });
    });

    return out;
  }

  /* "msBlur" -> "ms-blur", so the CSS variable reads --pfwa-ms-blur. */
  function kebab(name) {
    return String(name).replace(/[A-Z]+(?![a-z])|[A-Z]/g, function (s, offset) {
      return (offset ? "-" : "") + s.toLowerCase();
    });
  }

  function cssVarName(key) {
    return "--pfwa-" + kebab(key);
  }

  function featureById(id) {
    for (var i = 0; i < FEATURES.length; i++) {
      if (FEATURES[i].id === id) return FEATURES[i];
    }
    return null;
  }

  root.PFWA = {
    SETTINGS_KEY: SETTINGS_KEY,
    FEATURES: FEATURES,
    VAR_KEYS: VAR_KEYS,
    IDLE_KEYS: IDLE_KEYS,
    defaults: defaults,
    normalize: normalize,
    sanitizeField: sanitizeField,
    fieldDisplayValue: fieldDisplayValue,
    clampNumber: clampNumber,
    kebab: kebab,
    cssVarName: cssVarName,
    featureById: featureById
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
