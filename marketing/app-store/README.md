# capsule scan App Store gallery

Designed screenshots, 1242 × 2688 RGB PNG. Lato, monochrome canvases, restrained headings, real app UI, and garment photos supplied from Allen's capsule wardrobe for this listing.

- `assets/`: the Burberry quarter-zip, NO/FAITH denim, Madman jersey, and Nike Dunks exported from capsule's visible wardrobe images. No generated garment is used.
- `screens/`: unretouched, full-resolution Simulator captures of the app's existing views.
- `render.py`: deterministic gallery compositor using Pillow and the bundled Lato font.
- `exports/`: upload-sized panels and a compact contact sheet for approval.
- `index.html`: generated browser preview of the actual exports.
- `gallery-entry.swift`: disposable screenshot fixture entry point. It renders the production views with sample records, in-memory SwiftData, and a transport that rejects every network request. It must never replace the shipped app entry point or serve as App Review access.

The fixture build is in `/tmp/capsule-scan-gallery`, installed only on the separate `capsule scan gallery` simulator. `GALLERY_SCREEN=sweater`, `jersey`, or `drafts` selects the scene. Images are bundled in the disposable build, not added to the production app. Garment field examples are manually filled for demonstration; the gallery makes no claim that on-device processing infers names or brands.

Current status: all three panels are approved and uploaded to App Store Connect for version 1.0, English (U.S.), iPhone 6.5-inch. Order: capture, details, drafts. The app has not been submitted for review.

All artwork is constrained above y=2430, leaving at least 150 px before the footer at y=2580. Rotated bounds are included, and the browser preview displays the same exported PNGs.

Render the panels and browser preview:

```sh
python3 render.py
```

Do not advertise background removal until it is implemented and verified. Do not upload the contact sheet; use each numbered PNG separately after visual approval.
