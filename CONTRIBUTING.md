# Contributing

Bug reports, ideas and pull requests are welcome. A few things worth knowing before you spend time on
one.

## How changes land

Everything goes through a pull request against `main`, and the repository owner reviews and merges
it. `main` is protected: nobody pushes to it directly, and nothing merges without that review.

Releases are cut by the owner too, by hand — **Actions → Release → Run workflow**. There is no
automatic publishing on push or merge, so a merged pull request does not become a release until it is
deliberately made one.

## Before you open a pull request

```bash
npm install
npm test
```

The tests run the card against a real DOM and cover the parts that break quietly: each d-pad variant,
the switches that hide parts of the card, the device lookup, and that a configuration written for an
older version still works. Add a case when you add behaviour.

Keep the change focused, and say in the description what you observed — especially anything found on
actual hardware, since preset slots and stream addresses vary by camera.

## Adding a language

Drop `<lang>.json` into `dist/` with a `card` section, using `en.json` as the template. No JavaScript
to edit: the card fetches it at runtime. Leave out anything you are unsure of and it falls back to
English.

## What tends not to be accepted

- Keeping the live stream open by default. A player holds the stream rather than merely watching it,
  and on a battery camera that is the difference between days and hours of runtime. `live: follow` is
  there for mains-powered cameras.
- Hard-coded entity ids or English strings in the source. The card resolves entities through the
  registry and reads its text from the translation files, so that both survive a rename or another
  language.
