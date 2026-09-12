# MTG Deck Photo Scanner — High-Level Build Plan

## 1. Goal

Build a client-side web app that lets a user take or upload a photo of a Magic: The Gathering deck laid out on a table, with cards overlapping in columns and basic lands sometimes stacked in rows.

The app should:

1. Detect visible card title regions.
2. OCR the card names.
3. Match OCR output against known MTG card names.
4. Overlay recognized names directly on the original image.
5. Show confidence and unresolved cards.
6. Count repeated basic lands.
7. Let the user quickly correct mistakes.
8. Export the result as a decklist.

The first version should work entirely in the browser, with no backend required.

---

## 2. Primary User Flow

1. User opens the web app.
2. User takes a photo or uploads an existing one.
3. App preprocesses the image.
4. OCR scans visible text regions.
5. Recognized text is matched against a local MTG card-name index.
6. Matches are grouped spatially into card columns.
7. The original image is displayed with overlays:
   - High-confidence matches
   - Low-confidence matches
   - Suspected missing cards
8. User taps incorrect or unresolved matches to correct them.
9. App detects/counts basic land piles separately.
10. User reviews the final decklist.
11. User copies, downloads, or shares the decklist.

---

## 3. Recommended Stack

### Frontend

- TypeScript
- React
- Vite
- Canvas or SVG overlay layer

### Computer Vision

- OpenCV.js
  - Image resizing
  - Contrast normalization
  - Perspective correction if needed
  - Edge/line detection
  - Spatial clustering
  - Land-stack edge counting

### OCR

Start with:

- PaddleOCR.js

Alternative/fallback:

- Tesseract.js

OCR should run inside a Web Worker so image processing does not block the UI.

### Card Matching

- Local Scryfall card-name dataset
- Fuse.js or a custom fuzzy matcher

The matcher should combine:

- OCR confidence
- String similarity
- Set/card availability if known
- Spatial consistency
- Possible card-name length

---

## 4. Core Technical Strategy

Do not try to detect complete card rectangles first.

In overlapping deck photos, most cards do not have four visible edges. Instead, treat the visible card-name/title bar as the primary detection target.

Pipeline:

```text
Photo
  ↓
Resize / normalize
  ↓
Detect OCR text regions
  ↓
Find likely MTG title-bar text
  ↓
Fuzzy-match against card-name database
  ↓
Group detections into columns
  ↓
Infer missing card positions
  ↓
Retry OCR on uncertain regions
  ↓
Render overlays
```

This approach takes advantage of the way players naturally spread cards so the names remain visible.

---

## 5. Image Processing Pipeline

### Step 1: Image normalization

Before OCR:

- Downscale very large phone photos to a reasonable working resolution.
- Correct EXIF rotation.
- Normalize brightness.
- Apply local contrast enhancement.
- Optionally reduce glare-heavy highlights.

Create several image variants:

1. Original / lightly normalized
2. High contrast
3. Grayscale
4. Adaptive threshold

Avoid applying expensive transformations to the full-resolution image more than necessary.

---

### Step 2: Initial OCR pass

Run OCR across the normalized image.

For each detected text region, retain:

```ts
type OCRRegion = {
  text: string;
  confidence: number;
  polygon: Point[];
  boundingBox: Rect;
};
```

The polygon is important because the final overlay should align with the original card orientation.

---

### Step 3: Card-name candidate filtering

Discard OCR regions that are unlikely to be card names.

Possible heuristics:

- Reasonable font/text height
- Mostly horizontal orientation
- String length
- Position relative to nearby repeated text bands
- Similar vertical spacing within columns
- Fuzzy match against known card names

Do not require exact OCR results.

Example:

```text
OCR:
"Scorchlng Dragonflre"

Match:
"Scorching Dragonfire"
```

A restricted vocabulary makes fuzzy matching much more reliable than general OCR.

---

## 6. MTG Card Matching

Download and preprocess Scryfall card data into a compact client-side index.

The MVP only needs:

- Oracle/card name
- Optional set code
- Optional collector number

Create a normalized form for every name:

```text
Lightning Bolt
→ lightning bolt
```

Potential matching score:

```text
score =
  stringSimilarity
  × OCRConfidence
  × layoutConfidence
```

Return the top few candidates instead of only one.

Example:

```ts
{
  detectedText: "Frost Lyny",
  matches: [
    { name: "Frost Lynx", score: 0.96 },
    { name: "Frost Titan", score: 0.62 }
  ]
}
```

---

## 7. Column Detection

Once several card names are recognized, use their coordinates to infer deck layout.

Typical photo:

```text
Column 1
  Card
  Card
  Card
  Card

Column 2
  Card
  Card
  Card

Column 3
  Card
  Card
```

Cluster title regions primarily by X coordinate and orientation.

Possible approaches:

- K-means
- DBSCAN
- Simple gap-based clustering

DBSCAN may work especially well because the number of columns is unknown.

For each column determine:

- Average X position
- Average title angle
- Average card spacing
- Expected next card position

---

## 8. Missing Card Detection

Spatial layout can reveal cards OCR failed to recognize.

Example:

```text
y=100  Card A
y=132  Card B
y=196  Card D
```

If average spacing is about 32px, infer:

```text
y≈164  Unknown card
```

Then:

1. Crop a targeted region.
2. Generate several enhanced variants.
3. Retry OCR.
4. Match against Scryfall again.

This targeted retry system should significantly improve accuracy without repeatedly OCRing the entire photograph.

---

## 9. Handling Glare

Glare will likely be the biggest source of OCR failures.

MVP strategy:

- Local contrast enhancement
- Multiple preprocessing variants
- Targeted OCR retries
- Use spatial inference when text is partially unreadable

Later improvements:

- Highlight/glare masks
- Image inpainting
- Polarization guidance in the camera UI
- Multi-frame capture

A future camera mode could briefly capture several frames and combine the best readable regions.

---

## 10. Basic Land Recognition

Treat basic lands separately.

Possible basic-land classes:

- Plains
- Island
- Swamp
- Mountain
- Forest
- Wastes

For land piles:

1. Identify the visible/top card.
2. Classify the land type.
3. Detect repeated exposed card edges.
4. Estimate the number of cards in the stack.

Example:

```text
Visible top card:
Mountain

Detected repeated edges:
8

Result:
8 Mountain
```

This is easier than OCRing every land individually.

For the MVP, allow users to manually adjust the count if edge detection is uncertain.

---

## 11. Overlay UI

Render recognized cards directly on the uploaded image.

Use either:

- SVG overlay
- HTML elements positioned above an image
- Canvas

SVG is likely the easiest option for interactive labels.

Each detection should include:

```ts
type CardDetection = {
  id: string;
  name?: string;
  confidence: number;
  polygon: Point[];
  columnId?: string;
  status: "confirmed" | "uncertain" | "unknown";
};
```

Suggested UI states:

- Green: confident match
- Yellow: uncertain match
- Red or `?`: suspected card but unresolved
- Blue: manually corrected

Tapping a label should open nearby fuzzy-match candidates.

---

## 12. Correction UX

Corrections should be extremely fast.

On tap:

```text
Detected:
"Frost Lyny"

Possible matches:
✓ Frost Lynx
  Frost Titan
  Frost Walker

Search...
```

User can:

- Confirm suggestion
- Select another candidate
- Search manually
- Delete false detection

Corrections should immediately update the decklist.

---

## 13. Decklist Output

Once reviewed, produce:

```text
2 Lightning Strike
1 Scorching Dragonfire
3 Frost Lynx
8 Mountain
7 Island
```

Initial export options:

- Copy to clipboard
- Download `.txt`
- Download `.json`

Later:

- Moxfield format
- Archidekt format
- MTG Arena format
- Shareable URL

---

## 14. Suggested Application Architecture

```text
src/
  components/
    PhotoUploader/
    ScannerView/
    CardOverlay/
    CardCorrectionDialog/
    DeckList/

  vision/
    preprocess.ts
    ocr.ts
    titleCandidates.ts
    columnDetection.ts
    missingCardInference.ts
    landDetection.ts

  cards/
    scryfall.ts
    fuzzyMatch.ts
    cardIndex.ts

  workers/
    ocr.worker.ts
    vision.worker.ts

  models/
    detection.ts
    deck.ts
```

Keep the CV/OCR pipeline separate from React UI code.

This makes it much easier to test recognition independently.

---

## 15. Development Phases

### Phase 1 — Proof of Concept

Goal: prove OCR + fuzzy matching works.

Build:

- Image upload
- PaddleOCR.js
- Scryfall card-name index
- Display OCR results
- Fuzzy-match results

Success criteria:

A clear photo with overlapping cards can correctly identify most visible card names.

---

### Phase 2 — Image Overlay

Add:

- OCR coordinates
- SVG overlay
- Confidence visualization
- Click-to-correct

Success criteria:

Users can visually verify which physical card produced each match.

---

### Phase 3 — Layout Intelligence

Add:

- Column clustering
- Card spacing estimation
- Missing-card inference
- Targeted OCR retries

Success criteria:

The app can detect likely missed cards and recover many OCR failures automatically.

---

### Phase 4 — Land Detection

Add:

- Land classification
- Card-edge counting
- Manual count adjustment

Success criteria:

Common land piles can be converted into approximate quantities.

---

### Phase 5 — Mobile Camera UX

Add:

- Direct camera capture
- Capture framing guide
- Glare warning
- Resolution optimization
- Automatic processing

Success criteria:

A user can photograph a deck directly from their phone and get usable results without manually preparing the image.

---

### Phase 6 — Accuracy Improvements

Measure real-world failures and only add ML where needed.

Potential upgrades:

- Custom title-bar detector
- Small YOLO/ONNX model running via WebGPU
- Multi-frame image fusion
- Better glare detection
- Card-art similarity as a fallback
- Set-symbol recognition

Do not train a custom ML model until the heuristic/OCR approach has been benchmarked.

---

## 16. Testing Dataset

Build a small labeled dataset early.

Capture deck photos with:

- Different playmats/tables
- Sleeved and unsleeved cards
- Glossy sleeves
- Heavy glare
- Low indoor light
- Angled camera positions
- Dense overlapping columns
- Foils
- Borderless cards
- Alternate art
- Double-faced cards
- Lands stacked vertically and horizontally

For every image record:

- Correct card names
- Card counts
- Detection positions
- Which cards were intentionally obscured

This dataset should drive all optimization.

---

## 17. Important Metrics

Track:

### Recognition recall

```text
correctly detected cards
------------------------
actual visible cards
```

### Recognition precision

```text
correct card matches
--------------------
all proposed matches
```

### Full-deck accuracy

Percentage of photos where the final generated decklist is completely correct after automated processing.

### Correction burden

Average number of user corrections per deck.

The most important product metric may ultimately be:

> How many taps are required to turn a photo into a correct decklist?

A 92% accurate scanner that requires two corrections may provide a better experience than a slower 97% scanner.

---

## 18. MVP Scope

Keep version 1 deliberately narrow.

Support:

- One photo
- English cards
- Standard overlapping-column deck layouts
- Client-side processing
- Card-name OCR
- Basic fuzzy matching
- Interactive overlays
- Manual corrections
- Simple decklist export

Do not initially build:

- Full card image recognition
- Set/printing identification
- Price lookup
- Collection management
- Authentication
- Backend processing
- Custom ML training
- Perfect land counting

---

## 19. Biggest Risks

### Glare

May completely destroy title text.

Mitigation:

- Multiple preprocessing passes
- Spatial inference
- Targeted retries
- Better photo guidance

### OCR performance on mobile

Large OCR models may be slow.

Mitigation:

- Resize images
- Web Workers
- Crop before repeated OCR
- Lazy-load OCR model
- Test WebGPU support later

### Alternate card frames

Showcase/borderless cards can move or visually alter title bars.

Mitigation:

Use OCR text detection rather than hardcoded pixel coordinates.

### Overlap density

Some title bars may simply be hidden.

Mitigation:

Flag inferred missing cards and require user correction rather than guessing aggressively.

---

## 20. First Implementation Milestone

Build the smallest experiment possible:

```text
Upload photo
   ↓
PaddleOCR
   ↓
OCR polygons + text
   ↓
Fuzzy-match against Scryfall names
   ↓
Draw matched name over image
```

Do not build column detection or land counting yet.

Collect approximately 20 real deck photos and measure recognition quality.

If that experiment consistently recognizes the majority of visible names, proceed with layout inference and correction UX.

If OCR performs poorly even after preprocessing, investigate a custom title-bar detection model before building the rest of the product.
