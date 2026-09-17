/**
 * Retrocompatibilità: una card configurata con una versione precedente deve
 * continuare a funzionare dopo un aggiornamento, prendendo dai default tutto
 * quello che nella sua configurazione non c'è.
 *
 * Ogni caso qui sotto è una configurazione realmente scritta per una versione
 * passata della card.
 */

import { JSDOM } from "jsdom";
import { pathToFileURL } from "node:url";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  customElements: dom.window.customElements,
  HTMLElement: dom.window.HTMLElement,
  CustomEvent: dom.window.CustomEvent,
});
globalThis.console.info = () => {};
const debugged = [];
globalThis.console.debug = (m) => debugged.push(m);

globalThis.fetch = async () => ({ ok: false });
await import(pathToFileURL(process.argv[2]).href);
const Card = customElements.get("eufy-camera-card");

const ENTITIES = {};
for (const [id, key] of [
  ["button.su", "tilt_up"],
  ["button.giu", "tilt_down"],
  ["button.sx", "pan_left"],
  ["button.dx", "pan_right"],
  ["button.vai", "preset_goto"],
  ["select.preset", "preset"],
  ["sensor.url", "stream_url"],
  ["image.last", "last_event"],
  ["binary_sensor.str", "streaming"],
]) {
  ENTITIES[id] = { device_id: "dev1", platform: "eufy_sdk", translation_key: key, entity_id: id };
}
const HASS = {
  devices: { dev1: { id: "dev1", name: "Cam" } },
  entities: ENTITIES,
  states: {
    "select.preset": { state: "0 · HOME", attributes: { options: ["0 · HOME", "1", "3 · empty"] } },
    "sensor.url": { state: "unknown", attributes: { rtsp_url: "rtsp://h:8554/S", go2rtc_url: "http://h:1984" } },
    "binary_sensor.str": { state: "off", attributes: {} },
    "image.last": { state: "x", attributes: {} },
  },
  callService: () => {},
};

const failures = [];
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures.push(`${label}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
  else console.log(`  ok  ${label}`);
};

/** Ogni voce: com'era scritta allora, e cosa deve continuare a fare oggi. */
const HISTORY = [
  {
    when: "v1.0 — solo le quattro direzioni, nessun device",
    config: { up: "button.su", down: "button.giu", left: "button.sx", right: "button.dx" },
    expect: (c) => {
      check("v1.0 disegna il joystick", c.shadowRoot.querySelectorAll(".joystick").length, 1);
      check("v1.0 usa le entità dichiarate", c._entities.up, "button.su");
      check("v1.0 prende i default nuovi", [c._config.variant, c._config.live], ["joystick", "on_demand"]);
    },
  },
  {
    when: "v1.1 — con i preset espliciti",
    config: {
      up: "button.su", down: "button.giu", left: "button.sx", right: "button.dx",
      select: "select.preset", goto: "button.vai",
    },
    expect: (c) => {
      check("v1.1 mostra i chip", [...c.shadowRoot.querySelectorAll(".chip")].map((x) => x.textContent), ["HOME", "1"]);
    },
  },
  {
    when: "v1.2 — device e varianti",
    config: { device: "Cam", variant: "ring", size: 200 },
    expect: (c) => {
      check("v1.2 mantiene la variante", c.shadowRoot.querySelectorAll(".ring").length, 1);
      check("v1.2 mantiene la dimensione", c._config.size, 200);
    },
  },
  {
    when: "v1.3 — card della telecamera annidata",
    config: { device: "Cam", camera: { type: "custom:webrtc-camera", url: "rtsp://x" } },
    expect: (c) => {
      check("v1.3 tiene la card annidata", c._config.camera.type, "custom:webrtc-camera");
      check("v1.3 lo slot video esiste", c.shadowRoot.querySelectorAll(".camera").length, 1);
    },
  },
  {
    when: "v1.4 — camera auto, prima che live esistesse",
    config: { device: "Cam", camera: "auto", fallback_delay: 5 },
    expect: (c) => {
      check("v1.4 eredita il default prudente", c._config.live, "on_demand");
      check("v1.4 mantiene il suo fallback_delay", c._config.fallback_delay, 5);
    },
  },
  {
    when: "opzione di una versione futura, qui sconosciuta",
    config: { device: "Cam", qualcosa_di_nuovo: true },
    expect: (c) => {
      check("l'opzione ignota non rompe", Boolean(c.shadowRoot.querySelector(".joystick")), true);
      check("ma viene segnalata in console", debugged.some((m) => m.includes("qualcosa_di_nuovo")), true);
    },
  },
];

for (const { when, config, expect } of HISTORY) {
  console.log(`\n${when}`);
  let card;
  try {
    card = new Card();
    card.setConfig(config);
    card.hass = HASS;
  } catch (err) {
    failures.push(`${when}: ha sollevato "${err.message}"`);
    continue;
  }
  expect(card);
}

console.log();
if (failures.length) {
  console.log("FALLITI:");
  for (const f of failures) console.log("  -", f);
  process.exit(1);
}
console.log("le configurazioni vecchie continuano a funzionare");
