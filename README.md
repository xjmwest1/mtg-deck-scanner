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

## GitHub Pages

This app is static (Vite build) and runs fully in the browser, so it can be hosted on [GitHub Pages](https://pages.github.com/).

**Live site:** after deployment is enabled, the app is served at  
`https://xjmwest1.github.io/mtg-deck-scanner/`

### One-time repo setup

1. Open the repository on GitHub → **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.

### Deploy

Pushes to `main` run [`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml), which downloads OCR assets, builds with base path `/mtg-deck-scanner/`, and publishes `dist/` to Pages. You can also run the workflow manually from the **Actions** tab.

Local production preview with the same base path as Pages:

```bash
VITE_BASE_PATH=/mtg-deck-scanner/ npm run build
npm run preview
```

Then open the URL shown by `vite preview` (paths are rooted at `/mtg-deck-scanner/`).
