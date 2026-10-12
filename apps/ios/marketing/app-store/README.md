# capsule App Store gallery

Designed screenshots, 1242 × 2688 RGB PNG: Lato, monochrome canvases, real app UI, and unbranded sample garments.

- `assets/`: original generated sample knit, jeans, tee, and scarf; no brand names, logos, or recognizable third-party graphics. The Lato font and license are bundled.
- `screens/`: unretouched Simulator captures of production views from `b702051` (version 1.0, build 10, the version under review).
- `gallery-entry.swift`: screenshot-only fixture using in-memory SwiftData, manually entered fields, and a transport that rejects all network requests. It is never part of the shipped app or App Review access.
- `render.py`: deterministic Pillow compositor; preserves the real UI, adds headings and device framing, and generates `index.html`.
- `exports/`: three numbered upload panels and a contact sheet for preview. Only upload the numbered panels.

The October 11, 2026 revision replaces every branded garment, brand field value, and shoe decoration in the prior gallery after App Review flagged third-party content. The screenshots do not imply that on-device processing infers names, brands, or categories. Generated sample photos are demonstration input, not an app feature.

## Capture and render

Use a disposable copy of `apps/ios` from `b702051`, matching the submitted binary. Replace its app entry point with `gallery-entry.swift` and copy the four sample PNGs into its Resources folder. Regenerate that disposable Xcode project with `scripts/generate-project.py`. Build for an iPhone Simulator with a separate bundle identifier (`dev.gtfol.capsule.gallery`) and signing disabled. Do not change the production app or use a real account.

Launch with `GALLERY_SCREEN=knit`, `tee`, or `drafts`. In Simulator, use File → Save Screen… with the device mask disabled; save to `screens/knit.png`, `screens/tee.png`, and `screens/drafts.png`. The editor opens a saved local sample draft so no extraction alters the manually entered example.

Run `python3 render.py` with Pillow installed. Visually inspect all three panels, including names, logos, footer clearance, and any overlays. All artwork must end above y=2430, leaving at least 150 px before the footer at y=2580. Verify each upload is 1242 × 2688, RGB, with no alpha channel.

## Sample image provenance

Generated using the built-in image-generation tool on October 11, 2026. Common prompt constraints: realistic generic catalog garment, full front view with margin, soft neutral light, no people, hangers, brand, logo, label, text, or distinctive trademark; transparent background. Subjects:

- `knit.png`: plain oversized charcoal-black crewneck wool sweater with natural folds.
- `jeans.png`: plain washed black wide-leg five-pocket denim with tonal stitching and an unmarked button.
- `tee.png`: plain off-white oversized short-sleeve crewneck cotton tee.
- `scarf.png`: plain charcoal wool scarf, loosely folded, with frayed ends and no pattern.

These replace the older third-party photos; those images and branded screenshots are removed from the current gallery source. Do not reuse older listing assets from App Store Connect’s Asset Library.
