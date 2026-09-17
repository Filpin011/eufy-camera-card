# Eufy - Camera

A Lovelace card for pan-tilt eufy cameras: the live picture, a d-pad that actually moves the camera,
and one button per saved preset.

Built for the [`ha-eufy-sdk`](https://github.com/mega-yfue/ha-eufy-sdk) integration, which supplies
the controls this card drives.

## What it does

- **Live picture**, opened only when you ask. On a battery camera a player does not merely watch a
  stream, it holds one open — so the card shows the last-event still and gives you a play button.
  The live view closes itself again, which is what keeps the camera asleep.
- **A d-pad**, in three shapes: a joystick you drag, a flat ring, or four keys in a cross. Hold a
  direction and it repeats.
- **Preset chips**, one per position the camera has actually stored, read from the camera itself.
  Click to go there.

## Requirements

- The [`ha-eufy-sdk`](https://github.com/mega-yfue/ha-eufy-sdk) integration, and a camera it reports
  with the `ptz` capability
- [`webrtc-camera`](https://github.com/AlexxIT/WebRTC) for the live view. Without it the card shows
  the still and skips the player, since nothing else here can play RTSP.

## Install

Through HACS: add this repository as a custom repository of type **Lovelace**, then install
**Eufy - Camera**.

Manually: download `eufy-camera-card.zip` from the
[latest release](../../releases/latest), extract it into `config/www/eufy-camera-card/`, and add
`/local/eufy-camera-card/eufy-camera-card.js` as a JavaScript module under
**Settings → Dashboards → Resources**.

## Use

Add the card from the picker — it is listed as **Eufy - Camera** — and choose your camera. The visual
editor is the whole configuration:

```yaml
type: custom:eufy-camera-card
device: Front door camera
camera: auto
```

`device` takes a device name or its id. The six controls behind it are found through the entity
registry's translation keys, not entity ids, so the card keeps working across a language change or a
rename.

### Options

| option | default | what it does |
| --- | --- | --- |
| `device` | — | the camera; everything else is found from it |
| `camera` | unset | `auto` builds the player from the camera, or name a `camera.` entity, or nest a whole card config |
| `go2rtc` | from the camera | override only if you republished go2rtc on another port |
| `live` | `on_demand` | `on_demand`, `follow` (mains-powered only), or `never` |
| `live_timeout` | `120` | seconds before the live view closes itself |
| `fallback_delay` | `8` | seconds to wait before dropping back to the still |
| `dpad` / `chips` / `picker` | `true` | show or hide each part |
| `variant` | `joystick` | `joystick`, `ring` or `cross` |
| `size` | `180` | d-pad diameter, px |
| `interval` | `350` | ms between steps while a direction is held |
| `deadzone` | `0.28` | how far the joystick must move before it sends anything |
| `theme` | `auto` | `auto` follows Home Assistant, or force `dark` / `light` |

Any of `up`, `down`, `left`, `right`, `select` and `goto` can name an entity explicitly, which
overrides what `device` found.

## Why the live view is not always on

The camera moves and streams over P2P, and eufy exposes no "keep streaming" that is free. A player
left running holds the radio awake, and a battery camera flattens in hours — the bridge's own
idle-off cannot help while a client is pulling the stream. So the card treats the live view as
something you open deliberately and it closes again on its own.

If your camera is mains-powered, `live: follow` mirrors the streaming sensor and behaves the way you
probably expect.

## Translations

English and Italian ship with the card. To add a language, drop a `<lang>.json` into `translations/`
with a `card` section — the card fetches it at runtime, so there is no JavaScript to touch:

```json
{
  "card": {
    "watch": "Watch now",
    "live": "Live",
    "pick_camera": "Pick a camera"
  }
}
```

A regional tag falls back to its base (`pt-BR` tries `pt`), and anything missing falls back to
English. Pull requests with new languages are welcome.

## Licence

MIT.
