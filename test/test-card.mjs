/**
 * Test di rendering della card, con un DOM vero (jsdom).
 *
 * Verifica quello che un grep non può dire: che ogni variante produca gli elementi
 * giusti, che i tre interruttori tolgano davvero le parti, che l'auto-discovery
 * riempia i ruoli e che le configurazioni impossibili vengano rifiutate.
 */

import { JSDOM } from "jsdom";
import { pathToFileURL } from "node:url";

const CARD = process.argv[2];

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
});
// Il modulo si registra su questi al caricamento.
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.customElements = dom.window.customElements;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.console.info = () => {}; // il banner di versione qui è rumore

globalThis.fetch = async () => ({ ok: false });  // nessuna traduzione da servire qui
await import(pathToFileURL(CARD).href);

const Card = customElements.get("eufy-camera-card");

const ENTITIES = {
  "button.cam_su": { device_id: "dev1", platform: "eufy_sdk", translation_key: "tilt_up", entity_id: "button.cam_su" },
  "button.cam_giu": { device_id: "dev1", platform: "eufy_sdk", translation_key: "tilt_down", entity_id: "button.cam_giu" },
  "button.cam_sx": { device_id: "dev1", platform: "eufy_sdk", translation_key: "pan_left", entity_id: "button.cam_sx" },
  "button.cam_dx": { device_id: "dev1", platform: "eufy_sdk", translation_key: "pan_right", entity_id: "button.cam_dx" },
  "button.cam_vai": { device_id: "dev1", platform: "eufy_sdk", translation_key: "preset_goto", entity_id: "button.cam_vai" },
  "select.cam_preset": { device_id: "dev1", platform: "eufy_sdk", translation_key: "preset", entity_id: "select.cam_preset" },
};

const HASS = {
  devices: { dev1: { id: "dev1", name: "Cam" } },
  entities: ENTITIES,
  states: {
    "select.cam_preset": {
      state: "0 · HOME",
      attributes: {
        options: ["0 · HOME", "1", "2", "3 · empty", "4 · empty"],
      },
    },
  },
  callService: () => {},
};

const failures = [];
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures.push(`${label}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
  else console.log(`  ok  ${label}`);
};

function build(config) {
  const card = new Card();
  card.setConfig({ device: "Cam", ...config });
  card.hass = HASS;
  return card;
}
const q = (card, sel) => card.shadowRoot.querySelectorAll(sel);

// ── le tre varianti ─────────────────────────────────────────────────────────
const joy = build({});
check("joystick: base e pallino", [q(joy, ".joystick").length, q(joy, ".thumb").length], [1, 1]);
check("joystick: 4 indicatori", q(joy, ".hint").length, 4);

const ring = build({ variant: "ring" });
check("ring: anello con 4 tasti", [q(ring, ".ring").length, q(ring, ".ring .dir").length], [1, 4]);
check("ring: punto centrale", q(ring, ".pip").length, 1);
check("ring: nessun pallino trascinabile", q(ring, ".thumb").length, 0);

const cross = build({ variant: "cross" });
check("cross: 4 tasti a croce", q(cross, ".cross .dir").length, 4);
check("cross: niente anello", q(cross, ".ring").length, 0);

// ── i tre interruttori ──────────────────────────────────────────────────────
const full = build({});
check("tutto acceso: dpad + chip + tendina",
  [q(full, ".control").length, q(full, ".presets").length, q(full, ".row").length], [1, 1, 1]);
check("i chip sono i 3 preset salvati",
  [...q(full, ".chip")].map((c) => c.textContent), ["HOME", "1", "2"]);
check("la tendina elenca tutti i 5 slot", q(full, ".picker option").length, 5);

const noDpad = build({ dpad: false });
check("dpad:false toglie il controllo", q(noDpad, ".control").length, 0);
check("dpad:false lascia i preset",
  [q(noDpad, ".presets").length, q(noDpad, ".row").length], [1, 1]);

const noChips = build({ chips: false });
check("chips:false toglie i chip", q(noChips, ".presets").length, 0);

const noPicker = build({ picker: false });
check("picker:false toglie la tendina", q(noPicker, ".row").length, 0);

const only = build({ chips: false, picker: false });
check("solo dpad", [q(only, ".control").length, q(only, ".presets").length, q(only, ".row").length], [1, 0, 0]);

// ── auto-discovery e configurazioni rifiutate ───────────────────────────────
check("i ruoli sono stati risolti dal device",
  [joy._entities.up, joy._entities.select], ["button.cam_su", "select.cam_preset"]);

const explicit = build({ up: "button.altro" });
check("un'entità esplicita batte la scoperta", explicit._entities.up, "button.altro");

let threw = null;
try { build({ variant: "boh" }); } catch (e) { threw = e.message; }
check("variante sconosciuta rifiutata", threw?.includes("unknown variant"), true);

threw = null;
let plate = null;
try { const c = new Card(); c.setConfig({ variant: "ring" }); plate = c.shadowRoot.querySelector(".plate"); } catch (e) { threw = e.message; }
check("senza nulla: non rifiuta, mostra la targhetta", [threw, Boolean(plate)], [null, true]);
threw = null;
try { const c = new Card(); c.setConfig({ up: "button.x" }); } catch (e) { threw = e.message; }
check("mezza configurazione: rifiutata", threw?.includes("set `device`"), true);

threw = null;
try { const c = new Card(); c.setConfig({ dpad: false, chips: true }); } catch (e) { threw = e.message; }
check("senza dpad non servono le direzioni", threw, null);

console.log();
if (failures.length) {
  console.log("FALLITI:");
  for (const f of failures) console.log("  -", f);
  process.exit(1);
}
console.log("card: rendering e configurazione corretti");
