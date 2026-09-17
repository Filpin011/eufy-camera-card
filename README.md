# Eufy - Camera

A Lovelace card for pan-tilt eufy cameras: the live picture, a d-pad that moves the camera, and one
button per saved preset.

Companion to the [`ha-eufy-sdk`](https://github.com/mega-yfue/ha-eufy-sdk) integration, which supplies
the controls this card drives.

## Install

**1. Add this repository to HACS.**

In Home Assistant: **HACS → ⋮ (top right) → Custom repositories**, then

| field | value |
| --- | --- |
| Repository | `https://github.com/Filpin011/eufy-camera-card` |
| Type | **Dashboard** (called *Lovelace* on older HACS) |

**2. Install it.** Search HACS for **Eufy - Camera** and download it.

**3. Reload the browser** with Ctrl+Shift+R, and the card is in the picker under *Eufy - Camera*.

You also need:

- the [`ha-eufy-sdk`](https://github.com/mega-yfue/ha-eufy-sdk) integration, and a camera it reports
  as pan-tilt
- [`webrtc-camera`](https://github.com/AlexxIT/WebRTC) for the live view — without it the card shows
  the last-event still and skips the player, since nothing else here plays RTSP

## Use

Add the card and pick your camera. That is the whole configuration:

```yaml
type: custom:eufy-camera-card
device: Front door camera
camera: auto
```

`device` takes a device name or its id. The controls behind it are found through the entity registry,
so the card keeps working if you change language or rename an entity.

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
| `deadzone` | `0.28` | how far the joystick moves before it sends anything |
| `theme` | `auto` | `auto` follows Home Assistant, or force `dark` / `light` |

`up`, `down`, `left`, `right`, `select` and `goto` can each name an entity explicitly, overriding what
`device` found.

## Why the live view is not always on

A player does not merely watch a stream, it holds one open. On a battery camera that keeps the radio
awake and flattens it in hours — and the bridge's own idle-off cannot help while a client is pulling.

So the card shows the last-event still, which costs nothing, and opens the live view only when you
press play. It closes itself again after `live_timeout`, and when you leave the view.

If your camera is mains-powered, `live: follow` mirrors the streaming sensor and behaves the way you
probably expect.

## Translations

English and Italian are included. To add a language, drop `<lang>.json` into `dist/`
with a `card` section — the card fetches it at runtime, so there is no JavaScript to edit:

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

## Releasing (maintainers)

Releases are manual, never automatic on push: **Actions → Release → Run workflow**, give the version
(for example `0.1.0-beta`). It runs the tests, stamps the version into the card, commits that, and
publishes the release.

Everything HACS installs lives flat in `dist/` — the card, its translations, its images. No
subdirectories and no attached archive: HACS validates a plugin by looking for a `.js` named after
the repository, and rejects a zip release even though its installer would accept one
([hacs/integration#4928](https://github.com/hacs/integration/issues/4928)).

## Licence

MIT.
