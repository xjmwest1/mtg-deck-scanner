# MTG Deck Scanner

A client-side web app that turns a photo of a Magic: The Gathering deck into a decklist.

Upload or capture a photo of overlapping cards, OCR the visible names, match them against known MTG cards, overlay results on the image, and export a corrected decklist. Processing runs entirely in the browser.

See [PLAN.md](./PLAN.md) for the full build plan, architecture, and phased milestones.

## MVP

This first version covers the plan's MVP slice:

- One English-language photo
- Browser-side PaddleOCR
- Fuzzy matching against Scryfall card names
- SVG overlays with confidence colors
- Tap-to-correct, land-count adjustment, and manual add
- Copy / `.txt` / `.json` export

It does **not** yet include column clustering or missing-card inference. Basic lands can be counted from a die on the card or a sideways fan of exposed edges; the count is still easy to correct by tapping the land.

## Develop

```bash
npm install
npm test
npm run dev
```

The first scan downloads the OCR model and a local card-name catalog. After that, recognition stays on-device.

The home screen includes a few bundled samples: a generated overlapping-column layout, plus real photos of a cube on a playmat and fanned title bars. Sources and licenses are in [`public/samples/SOURCES.md`](./public/samples/SOURCES.md).
