/**
 * eufy-camera-card — live picture, pan-tilt controls and presets for a eufy camera.
 *
 * Needs the ha-eufy-sdk integration, which supplies the controls this drives, and
 * webrtc-camera for the live view.
 *
 * Point it at a camera and it finds its own controls:
 *
 *   type: custom:eufy-camera-card
 *   device: Front door camera     # device name, or its id
 *
 * The lookup goes through the entity registry's `translation_key`, not the entity
 * ids, so it keeps working when Home Assistant is set to another language or the
 * entities have been renamed. Every control can still be named explicitly, which
 * also lets one card drive parts of two devices:
 *
 *   up / down / left / right: button entities
 *   select: the preset select     goto: the go-to-preset button
 *
 * The live picture can sit in the same card, above the controls:
 *
 *   camera: auto                       # work it out from the camera itself
 *   camera: camera.front_door          # HA's own live view of one entity
 *   camera:                            # or any card config, passed through
 *     type: custom:webrtc-camera
 *     url: rtsp://...
 *
 * `auto` takes the address from the camera's own `stream_url` sensor — no host or
 * serial to write down, and it follows the bridge if either changes.
 *
 * It shows the last-event still by default and opens the live view only when you
 * ask for it, because a player does not merely watch a stream, it HOLDS one: on a
 * battery camera an always-on player keeps the radio awake and flattens it in
 * hours. So the still is free, the live view is deliberate, and it closes itself
 * again after `live_timeout` seconds.
 *
 *   live: on_demand   # still until you press play, then times out (default)
 *   live: follow      # mirror binary_sensor…_streaming — mains-powered only
 *   live: never       # still only
 *
 * `fallback_delay` is how long to wait before dropping back to the still once the
 * feed stops, so a stream that stutters does not tear the player down and rebuild
 * it. Override the go2rtc address with `go2rtc:` if you republish its port.
 *
 * Four parts, each switchable, so a dashboard shows only what it needs:
 *
 *   camera: <entity or card>   # the live picture (off unless set)
 *   dpad: true       # the directional control
 *   chips: true      # one button per saved preset
 *   picker: true     # the full slot list, empty ones included
 *
 * And three shapes for the d-pad:
 *
 *   variant: joystick   # drag the stick, it follows your finger (default)
 *   variant: ring       # flat ring with chevrons, click a direction
 *   variant: cross      # four square keys in a cross
 *
 * Other options: size (px), interval (ms between steps while held), deadzone
 * (0-1 fraction of travel that sends nothing, joystick only), theme
 * (auto | dark | light).
 *
 * Every variant behaves the same way underneath: the camera moves in discrete
 * steps — eufy has no "start moving"/"stop" pair — so holding a direction repeats
 * one press every `interval` ms rather than streaming a continuous command.
 */

const VERSION = "1.0.0";
const DEFAULTS = {
  size: 180,
  interval: 350,
  deadzone: 0.28,
  fallback_delay: 8,
  live: "on_demand",
  live_timeout: 120,
  theme: "auto",
  variant: "joystick",
  dpad: true,
  chips: true,
  picker: true,
};
const DIRECTIONS = ["up", "down", "left", "right"];
const VARIANTS = ["joystick", "ring", "cross"];
const THEMES = ["auto", "dark", "light"];
/**
 * The card's own strings live in the integration's translation files, under a
 * `card` section — so adding a language means dropping in `<lang>.json`, with no
 * JavaScript to touch. They are fetched from the integration, which serves that
 * folder.
 *
 * English is kept here as well, and only here: it is what shows before the fetch
 * lands and whenever a language has no file of its own. Every other language is
 * loaded, never hard-coded.
 */
const FALLBACK = {
  pick_camera: "Pick a camera",
  no_controls:
    'No PTZ controls found for "{device}" ({missing}). ' +
    "Is the camera pan-tilt, and the integration up to date?",
  camera_failed: "Could not build the camera card: {message}",
  watch: "Watch now",
  watch_hint: "Opens the live view; it closes itself after a while",
  live: "Live",
  live_hint: "Close the live view and let the camera sleep",
  goto: "Go to preset",
};

/** Loaded translations, shared by every card on the page. */
const LOADED = new Map([["en", FALLBACK]]);

/** Fill {name} placeholders. */
function fill(template, values = {}) {
  return String(template).replace(/\{(\w+)\}/g, (whole, key) =>
    key in values ? values[key] : whole,
  );
}

/**
 * Fetch a language's strings, once per page.
 *
 * Tries the full tag then the base one, so `pt-BR` falls back to `pt` before it
 * falls back to English. A miss is remembered too, so a language without a file
 * does not re-request it on every card.
 */
async function loadStrings(language) {
  const tags = [language, language?.split("-")[0]].filter(Boolean);
  for (const tag of tags) {
    if (LOADED.has(tag)) return LOADED.get(tag);
  }
  for (const tag of tags) {
    try {
      const response = await fetch(`${HERE}translations/${tag}.json`);
      if (!response.ok) continue;
      const doc = await response.json();
      if (doc?.card) {
        const strings = { ...FALLBACK, ...doc.card };
        LOADED.set(tag, strings);
        return strings;
      }
    } catch {
      // A missing or malformed file is not worth a broken card: English stands.
    }
  }
  for (const tag of tags) LOADED.set(tag, FALLBACK);
  return FALLBACK;
}

/** Keys that are valid but have no default: entities, and Lovelace's own. */
const KNOWN_KEYS = new Set([
  "type",
  "device",
  "camera",
  "go2rtc",
  "up",
  "down",
  "left",
  "right",
  "select",
  "goto",
  "unconfigured",
  "view_layout",
  "grid_options",
  "visibility",
]);
const EMPTY_MARK = "empty";
const PLATFORM = "eufy_sdk";
// Where this module lives, so its own files are found wherever it is installed —
// /hacsfiles/… under HACS, /local/… for a manual copy. Resolved from the module
// URL rather than hard-coded, because the path depends on how it was installed.
const HERE = new URL(".", import.meta.url).href;
const BRAND = HERE;

/** Which translation_key backs each config key, for the device lookup. */
const KEY_BY_ROLE = {
  up: "tilt_up",
  down: "tilt_down",
  left: "pan_left",
  right: "pan_right",
  goto: "preset_goto",
  select: "preset",
  stream: "stream_url",
  still: "last_event",
  streaming: "streaming",
};

const CHEVRON = {
  up: "M6 15l6-6 6 6",
  down: "M6 9l6 6 6-6",
  left: "M15 6l-6 6 6 6",
  right: "M9 6l6 6-6 6",
};

/** "0 · HOME" -> "HOME";  "2" -> "2".  The number stays where there is no name. */
function chipLabel(option) {
  const parts = option.split("·").map((s) => s.trim());
  return parts[1] || option;
}

/** The device id for a name, an id, or undefined when nothing matches. */
function resolveDevice(hass, wanted) {
  if (!wanted || !hass.devices) return undefined;
  if (hass.devices[wanted]) return wanted;
  const needle = wanted.toLowerCase();
  const match = Object.values(hass.devices).find((d) =>
    [d.name_by_user, d.name].filter(Boolean).some((n) => n.toLowerCase() === needle),
  );
  return match?.id;
}

/** Map role -> entity_id for one device, by translation_key. */
function discover(hass, deviceId) {
  const found = {};
  if (!deviceId || !hass.entities) return found;
  const wanted = new Map(Object.entries(KEY_BY_ROLE).map(([role, key]) => [key, role]));
  for (const entry of Object.values(hass.entities)) {
    if (entry.device_id !== deviceId || entry.platform !== PLATFORM) continue;
    const role = wanted.get(entry.translation_key);
    if (role) found[role] = entry.entity_id;
  }
  return found;
}

/** An inline chevron, so the shapes do not depend on an icon font loading. */
function chevron(direction) {
  return `<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">
            <path d="${CHEVRON[direction]}" fill="none" stroke="currentColor"
                  stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>`;
}

class EufyCameraCard extends HTMLElement {
  /** Hands Lovelace the visual editor instead of the bare YAML box. */
  static getConfigElement() {
    return document.createElement("eufy-camera-card-editor");
  }

  /** What "add card" starts from: the picker fills in the device. */
  static getStubConfig() {
    return { device: "", variant: "joystick" };
  }

  setConfig(config) {
    const merged = { ...DEFAULTS, ...config };
    if (!VARIANTS.includes(merged.variant)) {
      throw new Error(
        `eufy-camera-card: unknown variant "${merged.variant}", pick one of ` +
          VARIANTS.join(", "),
      );
    }
    // Nothing named at all is the state a freshly added card is in — the picker
    // renders one to preview it — so that shows the brand plate rather than an
    // error. Half a configuration is a mistake and still says so.
    const named = DIRECTIONS.filter((d) => merged[d]).length;
    if (merged.dpad && !merged.device && named > 0 && named < DIRECTIONS.length) {
      throw new Error(
        "eufy-camera-card: set `device`, or name all four of " + DIRECTIONS.join(", "),
      );
    }
    merged.unconfigured = merged.dpad && !merged.device && named === 0;
    // An option this version does not know is ignored rather than refused: a
    // card written for a later release must not break a dashboard, and one
    // written for an earlier one keeps working because everything missing comes
    // from DEFAULTS. Say so in the console, so a typo is findable.
    const unknown = Object.keys(config).filter(
      (key) => !(key in DEFAULTS) && !KNOWN_KEYS.has(key),
    );
    if (unknown.length) {
      console.debug(`eufy-camera-card: ignoring unknown option(s): ${unknown.join(", ")}`);
    }

    this._config = merged;
    // English until the language's file lands; see loadStrings.
    this._t = FALLBACK;
    this._entities = null;
    this._chipSignature = null;
    this._pickerSignature = null;
    this._build();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (this._cameraCard) this._cameraCard.hass = hass; // the nested card needs it too
    // The markup is built before hass exists, so its text starts out English.
    // Fetch the language's strings once it is known, then re-label.
    if (first) {
      void loadStrings(hass?.language).then((strings) => {
        this._t = strings;
        this._localise();
      });
    }
    if (!this._config) return; // hass can arrive before setConfig
    this._resolve();
    this._syncPresets();
    // The stream comes and goes, so the picture is re-evaluated on every update;
    // it rebuilds only when the answer actually changed.
    this._syncCamera();
  }

  getCardSize() {
    const { dpad, chips, picker, size } = this._config;
    return (dpad ? Math.ceil(size / 50) : 0) + (chips ? 1 : 0) + (picker ? 1 : 0) || 1;
  }

  /** Work out which entity backs each role, once, from config or the device. */
  _resolve() {
    if (this._entities) return;
    const { device, dpad, unconfigured } = this._config;
    if (unconfigured) {
      this._entities = {};
      return; // the plate is showing; nothing to look up yet
    }
    const discovered = device
      ? discover(this._hass, resolveDevice(this._hass, device))
      : {};
    // An explicit entity always wins over what the lookup found.
    this._entities = Object.fromEntries(
      Object.keys(KEY_BY_ROLE).map((role) => [
        role,
        this._config[role] || discovered[role],
      ]),
    );

    // Only complain about what this card was asked to show.
    const missing = dpad ? DIRECTIONS.filter((d) => !this._entities[d]) : [];
    this._warn(
      missing.length
        ? fill(this._t.no_controls, { device, missing: missing.join(", ") })
        : null,
    );
  }

  /** Re-label the parts built in `_build`, which ran before the strings landed. */
  _localise() {
    const sub = this.shadowRoot.querySelector(".plate-sub");
    if (sub) sub.textContent = this._t.pick_camera;
    const go = this.shadowRoot.querySelector(".go");
    if (go) go.title = this._t.goto;
    this._renderOverlay();
    // The warning is composed from these strings, so it has to be rebuilt too.
    if (this._entities) {
      this._entities = null;
      this._resolve();
    }
  }

  _warn(message) {
    this._notice.textContent = message || "";
    this._notice.classList.toggle("hidden", !message);
    this._body.classList.toggle("hidden", Boolean(message));
  }

  // ── markup ────────────────────────────────────────────────────────────────

  /** The d-pad, in the shape the config asked for. */
  _controlHtml() {
    const { variant } = this._config;
    const keys = DIRECTIONS.map(
      (d) => `<button class="dir ${d}" data-dir="${d}">${chevron(d)}</button>`,
    ).join("");

    if (variant === "ring") {
      return `<div class="control ring">${keys}<span class="pip"></span></div>`;
    }
    if (variant === "cross") {
      return `<div class="control cross">${keys}</div>`;
    }
    return `
      <div class="control joystick">
        ${DIRECTIONS.map((d) => `<span class="hint ${d}">${chevron(d)}</span>`).join("")}
        <div class="thumb snap"></div>
      </div>`;
  }

  /**
   * Build the nested picture card, if one was asked for.
   *
   * A string is the shorthand for "HA's own live view of this camera"; anything
   * else is a card config passed through untouched, so a player like
   * webrtc-camera keeps its own options and styling. Card helpers load lazily,
   * hence the async: the controls render immediately and the picture slots in.
   */
  /**
   * Which picture to show right now.
   *
   * `auto` reads the camera's own `stream_url` sensor. That sensor is empty
   * unless something is streaming — it answers "can I watch right now?" — so an
   * empty one means a player would spin on nothing, and the last-event still is
   * the honest thing to show instead. The addresses come from the sensor's
   * attributes, which stay put even while the state is empty.
   */
  /** Which picture to show: the live player, or the last-event still. */
  _cameraConfig(live) {
    const { camera, go2rtc } = this._config;
    if (!camera) return null;
    if (typeof camera === "object") return camera;
    if (camera !== "auto" && camera !== true) {
      return {
        type: "picture-entity",
        entity: camera,
        camera_view: "live",
        show_name: false,
        show_state: false,
      };
    }

    // The address comes from the stream sensor's ATTRIBUTES, which are there
    // whether or not anything is streaming; its state is deliberately empty when
    // idle, so it would be the wrong thing to build a player from.
    const stream = this._hass.states[this._entities?.stream];
    const url = stream?.attributes?.rtsp_url;
    // webrtc-camera is what the bridge's go2rtc is for; without it installed
    // there is nothing here that can play RTSP, so show the still instead.
    if (live && url && customElements.get("webrtc-camera")) {
      return {
        type: "custom:webrtc-camera",
        url,
        server: go2rtc || stream.attributes.go2rtc_url,
      };
    }

    const still = this._entities?.still;
    return still
      ? { type: "picture-entity", entity: still, show_name: false, show_state: false }
      : null;
  }

  /**
   * Follow the camera between live and still.
   *
   * `binary_sensor…_streaming` is the signal: it says whether the feed is up
   * right now. Going live is immediate — there is a picture waiting. Going back
   * is delayed, because a feed that drops for a moment and returns would
   * otherwise tear the player down and build it again, and the flicker reads as
   * a fault.
   */
  _syncCamera() {
    if (!this._cameraSlot) return;
    const mode = this._config.live;
    const streaming = this._hass.states[this._entities?.streaming]?.state === "on";

    // `on_demand` never opens a player on its own: only the play button does,
    // and only for as long as `live_timeout`. Holding a stream open is what
    // drains a battery camera, so it has to be something you chose to do.
    const wanted = mode === "follow" ? streaming : mode !== "never" && this._asked;

    if (wanted) {
      clearTimeout(this._fallbackTimer);
      this._fallbackTimer = null;
      this._live = true;
      void this._applyCamera();
      return;
    }
    if (this._live === false || this._fallbackTimer) return; // already still, or on its way
    if (this._live === undefined) {
      this._live = false; // first pass: nothing to wind down
      void this._applyCamera();
      return;
    }
    this._fallbackTimer = setTimeout(() => {
      this._fallbackTimer = null;
      this._live = false;
      void this._applyCamera();
    }, this._config.fallback_delay * 1000);
  }

  /** Open the live view, and set it to close itself again. */
  _watchLive() {
    this._asked = true;
    clearTimeout(this._liveTimer);
    this._liveTimer = setTimeout(() => this._stopLive(), this._config.live_timeout * 1000);
    this._syncCamera();
  }

  /** Let the stream go, so the camera can sleep. */
  _stopLive() {
    clearTimeout(this._liveTimer);
    this._liveTimer = null;
    this._asked = false;
    this._syncCamera();
  }

  /** Build or rebuild the nested picture, but only when it would change. */
  async _applyCamera() {
    const config = this._cameraConfig(this._live);
    const signature = JSON.stringify(config);
    if (signature === this._cameraSignature) return;
    this._cameraSignature = signature;

    if (!config) {
      this._cameraCard = null;
      this._cameraSlot.replaceChildren(this._overlay);
      this._renderOverlay();
      return;
    }
    try {
      // Helpers load lazily, so the controls render first and the picture slots in.
      const helpers = await window.loadCardHelpers();
      const element = helpers.createCardElement(config);
      element.hass = this._hass;
      this._cameraCard = element;
      // The overlay rides on top of whichever picture is showing.
      this._cameraSlot.replaceChildren(element, this._overlay);
      this._renderOverlay();
    } catch (err) {
      this._cameraCard = null;
      this._cameraSlot.textContent = fill(this._t.camera_failed, {
        message: err.message,
      });
    }
  }

  /** Play over the still, a stop badge over the live view, nothing otherwise. */
  _renderOverlay() {
    if (!this._overlay) return;
    const mode = this._config.live;
    if (mode !== "on_demand" || typeof this._config.camera === "object") {
      this._overlay.replaceChildren();
      return;
    }

    const button = document.createElement("button");
    button.className = `live-btn ${this._live ? "stop" : "play"}`;
    if (this._live) {
      button.innerHTML = '<span class="dot"></span>';
      button.append(this._t.live);
      button.title = this._t.live_hint;
      button.addEventListener("click", () => this._stopLive());
    } else {
      button.innerHTML =
        '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      button.append(this._t.watch);
      button.title = this._t.watch_hint;
      button.addEventListener("click", () => this._watchLive());
    }
    this._overlay.replaceChildren(button);
  }

  _build() {
    const { size, theme, variant, dpad, chips, picker, camera, unconfigured } =
      this._config;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._radius = size / 2;
    this._direction = null;
    this._timer = null;

    this.shadowRoot.innerHTML = `
      <style>
        /* Follows the Home Assistant theme; the fallbacks after each comma only
           apply when a theme leaves that variable undefined. */
        :host {
          --js-surface: var(--card-background-color, #1c1f26);
          --js-well: var(--secondary-background-color, #11151b);
          --js-accent: var(--primary-color, #38bdf8);
          --js-text: var(--primary-text-color, #e7ecf2);
          --js-dim: var(--secondary-text-color, #8a93a0);
          --js-line: var(--divider-color, rgba(128,128,128,.25));
          --js-shadow: rgba(0,0,0,.45);
        }
        :host([data-theme="dark"]) {
          --js-surface: #0b1016;
          --js-well: #0e151d;
          --js-accent: #38bdf8;
          --js-text: #e7ecf2;
          --js-dim: rgba(125,211,252,.45);
          --js-line: rgba(255,255,255,.10);
          --js-shadow: rgba(0,0,0,.6);
        }
        :host([data-theme="light"]) {
          --js-surface: #ffffff;
          --js-well: #eef2f7;
          --js-accent: #0284c7;
          --js-text: #0f172a;
          --js-dim: #94a3b8;
          --js-line: rgba(15,23,42,.12);
          --js-shadow: rgba(15,23,42,.18);
        }

        ha-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 16px 14px;
          background: var(--js-surface);
          border: 1px solid var(--js-line);
          border-radius: 16px;
        }
        ha-card:has(> .body > :only-child) { gap: 0; }
        .hidden { display: none !important; }

        .notice {
          color: var(--js-text);
          font-size: 14px;
          line-height: 1.45;
          text-align: center;
          padding: 8px 4px;
        }

        /* The card picker builds its thumbnail by rendering the card. With
           nothing configured there is no picture to show, so the brand goes
           where the picture would be and the controls below are drawn for real:
           the thumbnail then looks like what you are about to add. */
        .plate {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          aspect-ratio: 16 / 9;
          width: 100%;
          background: var(--js-well);
        }
        .brand { height: 46px; width: auto; object-fit: contain; }
        .brand.dark { display: none; }
        @media (prefers-color-scheme: dark) {
          .brand.light { display: none; }
          .brand.dark { display: block; }
        }
        :host([data-theme="dark"]) .brand.light { display: none; }
        :host([data-theme="dark"]) .brand.dark { display: block; }
        :host([data-theme="light"]) .brand.light { display: block; }
        :host([data-theme="light"]) .brand.dark { display: none; }
        .plate-title {
          margin-top: 4px;
          font-size: 15px;
          font-weight: 600;
          color: var(--js-text);
        }
        .plate-sub { font-size: 13px; color: var(--js-dim); }

        .body {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          width: 100%;
        }

        /* The nested card keeps its own look, minus the frame: it is inside ours
           already, and two borders around one picture read as a mistake. */
        .camera {
          position: relative;
          width: 100%;
          border-radius: 12px;
          overflow: hidden;
        }
        /* Play over the still, and a way out of the live view. Both sit on the
           picture rather than beside it: the picture is the control. */
        .live-btn {
          position: absolute;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px 8px 11px;
          font: inherit;
          font-size: 13px;
          font-weight: 500;
          color: var(--js-text);
          background: color-mix(in srgb, var(--js-well) 78%, transparent);
          backdrop-filter: blur(6px);
          border: 1px solid var(--js-line);
          border-radius: 999px;
          cursor: pointer;
          transition: border-color .15s ease, background .15s ease;
        }
        .live-btn:hover { border-color: var(--js-accent); }
        .live-btn svg { width: 16px; height: 16px; }
        .live-btn.play {
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
        }
        .live-btn.stop {
          top: 10px;
          left: 10px;
          padding: 6px 12px 6px 10px;
          font-size: 12px;
        }
        .live-btn.stop .dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #ef4444;
          animation: pulse 1.6s ease-in-out infinite;
        }
        @keyframes pulse { 50% { opacity: .35; } }
        .camera > * {
          --ha-card-background: transparent;
          --ha-card-border-width: 0;
          --ha-card-box-shadow: none;
          display: block;
        }

        .glyph { width: 1em; height: 1em; display: block; }
        .dir {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          color: var(--js-text);
          background: none;
          border: none;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          touch-action: none;
          transition: color .12s ease, background .12s ease;
        }
        .dir.on { color: var(--js-accent); }

        /* ── joystick: drag the stick ─────────────────────────────────────── */
        .joystick {
          position: relative;
          width: ${size}px;
          height: ${size}px;
          border-radius: 50%;
          background: radial-gradient(circle at 50% 45%,
            color-mix(in srgb, var(--js-well) 82%, var(--js-text) 6%) 0%,
            var(--js-well) 72%);
          border: 1px solid var(--js-line);
          box-shadow: inset 0 2px 10px var(--js-shadow);
          touch-action: none;
          cursor: grab;
          user-select: none;
        }
        .joystick.active { cursor: grabbing; }
        .joystick .hint {
          position: absolute;
          color: var(--js-dim);
          font-size: ${Math.round(size * 0.15)}px;
          pointer-events: none;
          transition: color .15s ease;
        }
        .joystick .hint.on { color: var(--js-accent); }
        .joystick .hint.up    { top: 5%;  left: 50%; transform: translateX(-50%); }
        .joystick .hint.down  { bottom: 5%; left: 50%; transform: translateX(-50%); }
        .joystick .hint.left  { left: 5%;  top: 50%; transform: translateY(-50%); }
        .joystick .hint.right { right: 5%; top: 50%; transform: translateY(-50%); }
        .thumb {
          position: absolute;
          top: 50%;
          left: 50%;
          width: ${Math.round(size * 0.38)}px;
          height: ${Math.round(size * 0.38)}px;
          margin-left: ${-Math.round(size * 0.19)}px;
          margin-top: ${-Math.round(size * 0.19)}px;
          border-radius: 50%;
          background: linear-gradient(160deg,
            color-mix(in srgb, var(--js-accent) 38%, var(--js-surface)) 0%,
            var(--js-surface) 100%);
          border: 1px solid color-mix(in srgb, var(--js-accent) 45%, transparent);
          box-shadow: 0 4px 14px var(--js-shadow);
          pointer-events: none;
          transform: translate(0, 0);
        }
        .thumb.snap { transition: transform .18s cubic-bezier(.2,.8,.3,1); }
        .thumb.live {
          box-shadow: 0 4px 14px var(--js-shadow),
                      0 0 18px color-mix(in srgb, var(--js-accent) 45%, transparent);
        }

        /* ── ring: flat, click a direction ────────────────────────────────── */
        .ring {
          position: relative;
          width: ${size}px;
          height: ${size}px;
          border-radius: 50%;
          background: var(--js-well);
          border: 1px solid var(--js-line);
        }
        .ring .dir {
          position: absolute;
          width: ${Math.round(size * 0.3)}px;
          height: ${Math.round(size * 0.3)}px;
          font-size: ${Math.round(size * 0.2)}px;
          border-radius: 50%;
        }
        .ring .dir:hover { background: color-mix(in srgb, var(--js-text) 8%, transparent); }
        .ring .dir.up    { top: 4%;  left: 50%; transform: translateX(-50%); }
        .ring .dir.down  { bottom: 4%; left: 50%; transform: translateX(-50%); }
        .ring .dir.left  { left: 4%;  top: 50%; transform: translateY(-50%); }
        .ring .dir.right { right: 4%; top: 50%; transform: translateY(-50%); }
        .ring .pip {
          position: absolute;
          top: 50%;
          left: 50%;
          width: ${Math.round(size * 0.33)}px;
          height: ${Math.round(size * 0.33)}px;
          margin: ${-Math.round(size * 0.165)}px 0 0 ${-Math.round(size * 0.165)}px;
          border-radius: 50%;
          border: 1px solid var(--js-line);
          pointer-events: none;
        }
        .ring .pip::after {
          content: "";
          position: absolute;
          top: 50%;
          left: 50%;
          width: ${Math.max(4, Math.round(size * 0.045))}px;
          height: ${Math.max(4, Math.round(size * 0.045))}px;
          margin: ${-Math.max(2, Math.round(size * 0.0225))}px 0 0
                  ${-Math.max(2, Math.round(size * 0.0225))}px;
          border-radius: 50%;
          background: var(--js-text);
          opacity: .75;
        }

        /* ── cross: four keys ─────────────────────────────────────────────── */
        .cross {
          display: grid;
          grid-template-columns: repeat(3, ${Math.round(size * 0.3)}px);
          grid-template-rows: repeat(3, ${Math.round(size * 0.3)}px);
          gap: 6px;
        }
        .cross .dir {
          font-size: ${Math.round(size * 0.17)}px;
          background: var(--js-well);
          border: 1px solid var(--js-line);
          border-radius: 12px;
        }
        .cross .dir:hover { border-color: var(--js-accent); }
        .cross .dir.on { background: color-mix(in srgb, var(--js-accent) 16%, var(--js-well)); }
        .cross .dir.up    { grid-area: 1 / 2; }
        .cross .dir.left  { grid-area: 2 / 1; }
        .cross .dir.right { grid-area: 2 / 3; }
        .cross .dir.down  { grid-area: 3 / 2; }

        /* ── presets ──────────────────────────────────────────────────────── */
        .presets {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 8px;
          width: 100%;
        }
        .presets:empty { display: none; }
        .chip {
          font: inherit;
          font-size: 13px;
          font-weight: 500;
          letter-spacing: .02em;
          color: var(--js-text);
          background: var(--js-well);
          border: 1px solid var(--js-line);
          border-radius: 999px;
          padding: 7px 15px;
          cursor: pointer;
          transition: border-color .15s ease, background .15s ease;
        }
        /* The sample chips in the thumbnail are spans, not buttons: nothing to
           press, so nothing should invite a press. */
        span.chip { cursor: default; }
        .chip:hover { border-color: var(--js-accent); }
        span.chip:hover { border-color: var(--js-line); }
        span.chip.on:hover { border-color: var(--js-accent); }
        .chip:active { background: color-mix(in srgb, var(--js-accent) 18%, var(--js-well)); }
        .chip.on {
          border-color: var(--js-accent);
          color: var(--js-accent);
          background: color-mix(in srgb, var(--js-accent) 12%, var(--js-well));
        }

        .row {
          display: flex;
          align-items: stretch;
          gap: 8px;
          width: 100%;
        }
        .picker {
          flex: 1;
          font: inherit;
          font-size: 14px;
          color: var(--js-text);
          background: var(--js-well);
          border: 1px solid var(--js-line);
          border-radius: 10px;
          padding: 9px 12px;
          cursor: pointer;
          appearance: none;
          /* arrow drawn by hand: the native one ignores the theme */
          background-image:
            linear-gradient(45deg, transparent 50%, var(--js-dim) 50%),
            linear-gradient(135deg, var(--js-dim) 50%, transparent 50%);
          background-position: right 15px center, right 10px center;
          background-size: 5px 5px, 5px 5px;
          background-repeat: no-repeat;
        }
        .picker:focus { outline: none; border-color: var(--js-accent); }
        .go {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 44px;
          color: var(--js-accent);
          background: var(--js-well);
          border: 1px solid color-mix(in srgb, var(--js-accent) 35%, transparent);
          border-radius: 10px;
          cursor: pointer;
          transition: background .15s ease;
        }
        .go:hover { background: color-mix(in srgb, var(--js-accent) 14%, var(--js-well)); }
        .go ha-icon { --mdc-icon-size: 20px; }
      </style>
      <ha-card>
        <div class="notice hidden"></div>
        <div class="body">
          ${
            unconfigured
              ? `<div class="plate">
                   <img src="${BRAND}logo.png" alt="eufy" class="brand light">
                   <img src="${BRAND}dark_logo.png" alt="eufy" class="brand dark">
                   <div class="plate-sub">${FALLBACK.pick_camera}</div>
                 </div>`
              : ""
          }
          ${camera && !unconfigured ? '<div class="camera"><div class="overlay"></div></div>' : ""}
          ${dpad ? this._controlHtml() : ""}
          ${
            chips && unconfigured
              ? // Sample chips: the thumbnail should show what presets look like.
                `<div class="presets">
                   <span class="chip on">HOME</span><span class="chip">1</span
                   ><span class="chip">2</span>
                 </div>`
              : chips
                ? '<div class="presets"></div>'
                : ""
          }
          ${
            picker && !unconfigured
              ? `<div class="row hidden">
                   <select class="picker"></select>
                   <button class="go" title="${FALLBACK.goto}">
                     <ha-icon icon="mdi:target"></ha-icon>
                   </button>
                 </div>`
              : ""
          }
        </div>
      </ha-card>
    `;

    if (theme !== "auto") this.setAttribute("data-theme", theme);

    this._notice = this.shadowRoot.querySelector(".notice");
    this._body = this.shadowRoot.querySelector(".body");
    this._cameraSlot = this.shadowRoot.querySelector(".camera");
    this._overlay = this.shadowRoot.querySelector(".overlay");
    this._cameraSignature = null;
    this._asked = false;
    this._chips = this.shadowRoot.querySelector(".presets");
    this._row = this.shadowRoot.querySelector(".row");
    this._picker = this.shadowRoot.querySelector(".picker");

    if (dpad) {
      if (variant === "joystick") this._wireJoystick();
      else this._wireKeys();
    }
    if (this._picker) {
      // Choosing a slot only aims; the arrow is what moves the camera. Stops an
      // accidental scroll through the list from swinging the camera about.
      this._picker.addEventListener("change", () => this._select(this._picker.value));
      this.shadowRoot
        .querySelector(".go")
        .addEventListener("click", () => this._pressGoto());
    }
  }

  // ── d-pad: joystick ───────────────────────────────────────────────────────

  _wireJoystick() {
    this._base = this.shadowRoot.querySelector(".joystick");
    this._thumb = this.shadowRoot.querySelector(".thumb");
    this._hints = Object.fromEntries(
      DIRECTIONS.map((d) => [d, this.shadowRoot.querySelector(".hint." + d)]),
    );
    this._base.addEventListener("pointerdown", (e) => this._dragStart(e));
    this._base.addEventListener("pointermove", (e) => this._drag(e));
    this._base.addEventListener("pointerup", (e) => this._dragEnd(e));
    this._base.addEventListener("pointercancel", (e) => this._dragEnd(e));
  }

  _dragStart(e) {
    this._base.setPointerCapture(e.pointerId);
    this._base.classList.add("active");
    this._thumb.classList.remove("snap");
    this._thumb.classList.add("live");
    this._drag(e);
  }

  _drag(e) {
    if (!this._base.hasPointerCapture?.(e.pointerId)) return;
    const box = this._base.getBoundingClientRect();
    let dx = e.clientX - (box.left + box.width / 2);
    let dy = e.clientY - (box.top + box.height / 2);

    const travel = this._radius * 0.62;
    const distance = Math.hypot(dx, dy);
    if (distance > travel) {
      dx = (dx / distance) * travel;
      dy = (dy / distance) * travel;
    }
    this._thumb.style.transform = `translate(${dx}px, ${dy}px)`;

    const engaged = distance / travel > this._config.deadzone;
    const direction = !engaged
      ? null
      : Math.abs(dx) > Math.abs(dy)
        ? dx > 0 ? "right" : "left"
        : dy > 0 ? "down" : "up";

    if (direction !== this._direction) this._setDirection(direction);
  }

  _dragEnd(e) {
    this._base.releasePointerCapture?.(e.pointerId);
    this._base.classList.remove("active");
    this._thumb.classList.add("snap");
    this._thumb.classList.remove("live");
    this._thumb.style.transform = "translate(0, 0)";
    this._setDirection(null);
  }

  // ── d-pad: ring and cross ─────────────────────────────────────────────────

  _wireKeys() {
    this._hints = {};
    for (const key of this.shadowRoot.querySelectorAll(".dir")) {
      const direction = key.dataset.dir;
      this._hints[direction] = key;
      // Press and hold repeats, exactly like holding the joystick off-centre.
      key.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        key.setPointerCapture(e.pointerId);
        this._setDirection(direction);
      });
      const stop = () => this._setDirection(null);
      key.addEventListener("pointerup", stop);
      key.addEventListener("pointercancel", stop);
      key.addEventListener("pointerleave", stop);
    }
  }

  // ── shared ────────────────────────────────────────────────────────────────

  _setDirection(direction) {
    this._direction = direction;
    for (const d of DIRECTIONS) {
      this._hints[d]?.classList.toggle("on", d === direction);
    }

    clearInterval(this._timer);
    this._timer = null;
    if (!direction) return;

    this._press(direction);
    this._timer = setInterval(() => this._press(this._direction), this._config.interval);
  }

  _press(direction) {
    const entity = this._entities?.[direction];
    if (!entity || !this._hass) return;
    this._hass.callService("button", "press", { entity_id: entity });
  }

  // ── presets ───────────────────────────────────────────────────────────────

  _syncPresets() {
    const select = this._entities?.select;
    if (!select || (!this._chips && !this._row)) return;
    const state = this._hass.states[select];
    if (!state) return;

    const all = state.attributes.options || [];
    const saved = all.filter((o) => !o.toLowerCase().includes(EMPTY_MARK));

    // Each list is rebuilt only when it really changed, so a click is never
    // swallowed by a re-render caused by some unrelated state update.
    if (this._chips) {
      const signature = saved.join("|");
      if (signature !== this._chipSignature) {
        this._chipSignature = signature;
        this._chips.replaceChildren(
          ...saved.map((option) => {
            const chip = document.createElement("button");
            chip.className = "chip";
            chip.textContent = chipLabel(option);
            chip.title = option;
            chip.addEventListener("click", () => this._goto(option));
            return chip;
          }),
        );
      }
      for (const chip of this._chips.children) {
        chip.classList.toggle("on", chip.title === state.state);
      }
    }

    if (this._row) {
      const signature = all.join("|");
      if (signature !== this._pickerSignature) {
        this._pickerSignature = signature;
        this._picker.replaceChildren(
          ...all.map((option) => {
            const item = document.createElement("option");
            item.value = option;
            item.textContent = option;
            return item;
          }),
        );
        this._row.classList.toggle("hidden", all.length === 0 || !this._entities.goto);
      }
      // Never fight the user: leave the open list alone while it has focus.
      if (this._picker !== this.shadowRoot.activeElement) {
        this._picker.value = state.state;
      }
    }
  }

  _select(option) {
    this._hass.callService("select", "select_option", {
      entity_id: this._entities.select,
      option,
    });
  }

  _pressGoto() {
    this._hass.callService("button", "press", { entity_id: this._entities.goto });
  }

  async _goto(option) {
    // Aim first, then press: the button reads the selected slot as it fires, so
    // the order matters and the two calls must not overlap.
    await this._hass.callService("select", "select_option", {
      entity_id: this._entities.select,
      option,
    });
    await this._hass.callService("button", "press", { entity_id: this._entities.goto });
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    clearTimeout(this._fallbackTimer);
    // Leaving the view must release the stream, or a closed dashboard would go
    // on holding the camera awake.
    clearTimeout(this._liveTimer);
    this._asked = false;
  }
}

/**
 * Define the element, more than once if need be.
 *
 * Home Assistant's scoped-registry polyfill REPLACES `window.customElements`
 * partway through startup, and a module loaded through `add_extra_js_url` can run
 * either side of that swap. Defining only at import time lands in the registry
 * that is about to be discarded — silently, with no console error, and the card
 * never appears (frontend issue #53890). Defining again once the page has loaded
 * catches the other case; the guard keeps the second call from throwing when both
 * ran against the same registry.
 */
/**
 * The visual editor. `ha-form` renders the schema with Home Assistant's own
 * controls, so the device row is the same picker the rest of the UI uses —
 * filtered to this integration, so only eufy cameras are offered.
 */
const EDITOR_SCHEMA = [
  { name: "device", required: true, selector: { device: { integration: PLATFORM } } },
  {
    name: "camera",
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "auto", label: "Automatica (dal bridge)" },
          { value: "", label: "Nessuna" },
        ],
        custom_value: true,
      },
    },
  },
  { name: "go2rtc", selector: { text: {} } },
  {
    name: "live",
    selector: { select: { mode: "dropdown", options: ["on_demand", "follow", "never"] } },
  },
  {
    name: "variant",
    selector: { select: { mode: "dropdown", options: VARIANTS } },
  },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "dpad", selector: { boolean: {} } },
      { name: "chips", selector: { boolean: {} } },
      { name: "picker", selector: { boolean: {} } },
      { name: "theme", selector: { select: { mode: "dropdown", options: THEMES } } },
    ],
  },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "size", selector: { number: { min: 100, max: 400, step: 10, unit_of_measurement: "px" } } },
      { name: "interval", selector: { number: { min: 100, max: 2000, step: 50, unit_of_measurement: "ms" } } },
    ],
  },
];

const LABELS = {
  en: {
    device: "Camera",
    camera: "Live picture",
    go2rtc: "go2rtc address (only if you republished its port)",
    live: "Live view (on_demand keeps a battery camera asleep)",
    variant: "Control shape",
    dpad: "Show d-pad",
    chips: "Show preset chips",
    picker: "Show slot picker",
    theme: "Colours",
    size: "Size",
    interval: "Repeat every",
  },
  it: {
    device: "Telecamera",
    camera: "Immagine live",
    go2rtc: "Indirizzo go2rtc (solo se ne hai cambiato la porta)",
    live: "Diretta (on_demand non tiene sveglia la telecamera)",
    variant: "Forma del controllo",
    dpad: "Mostra il d-pad",
    chips: "Mostra i preset",
    picker: "Mostra l'elenco slot",
    theme: "Colori",
    size: "Dimensione",
    interval: "Ripeti ogni",
  },
};

class EufyCameraCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...DEFAULTS, ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._hass || !this._config) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.addEventListener("value-changed", (e) => {
        e.stopPropagation();
        this.dispatchEvent(
          new CustomEvent("config-changed", { detail: { config: e.detail.value } }),
        );
      });
      this.appendChild(this._form);
    }
    const words = LABELS[this._hass.language] || LABELS.en;
    this._form.hass = this._hass;
    this._form.data = this._config;
    this._form.schema = EDITOR_SCHEMA;
    this._form.computeLabel = (row) => words[row.name] || row.name;
  }
}

function define() {
  if (!customElements.get("eufy-camera-card")) {
    customElements.define("eufy-camera-card", EufyCameraCard);
  }
  if (!customElements.get("eufy-camera-card-editor")) {
    customElements.define("eufy-camera-card-editor", EufyCameraCardEditor);
  }
  // The card was called eufy-ptz-joystick while it lived inside the integration.
  // Keeping that name working means a dashboard survives the move untouched; a
  // class can only hold one tag, hence the subclass.
  if (!customElements.get("eufy-ptz-joystick")) {
    customElements.define("eufy-ptz-joystick", class extends EufyCameraCard {});
  }
}
define();
window.addEventListener("load", define);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "eufy-camera-card")) {
  window.customCards.push({
    type: "eufy-camera-card",
    name: "Eufy - Camera",
    description: "Live picture, pan-tilt controls and stored presets",
    // The picker renders the card itself as its thumbnail, which is why an
    // unconfigured one has to draw something rather than refuse.
    preview: true,
    documentationURL: "https://github.com/Filpin011/eufy-camera-card",
  });
}

console.info(
  `%c EUFY - CAMERA %c v${VERSION} `,
  "color:#0b1016;background:#38bdf8;font-weight:700;border-radius:3px 0 0 3px",
  "color:#38bdf8;background:#0b1016;border-radius:0 3px 3px 0",
);
