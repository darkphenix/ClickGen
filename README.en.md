# ClickGen

**Turn any image into a 3D-printable mechanical-switch clicker.** Drop a logo, a mascot or a drawing: ClickGen cuts out the shape, fits a keyboard switch (Cherry MX compatible) inside, colors the cap with the image's colors and exports a **multicolor .3mf for Bambu Studio / OrcaSlicer** (or STL files).

![ClickGen: exploded and cutaway view, switch in blue](docs/screenshot.jpg)

Everything runs in your browser: your images never leave your computer and no network request is made once the page has loaded.

[Version française](README.md)

## Use it

- **Locally**: `npm run serve` (Node 18+), then <http://localhost:5173>. An HTTP server is required: the 3D computation runs in a Web Worker with WebAssembly, which does not work from `file://`.
- **Online**: the folder is a static site, publish it as is (GitHub Pages, Netlify…). There is nothing to build.

## What you need

- An **MX-compatible mechanical switch** (Cherry, Gateron, Kailh, Outemu…). A *clicky* (blue) switch gives the real click.
- An FDM printer, 0.4 mm nozzle, PLA. No supports needed.
- For the multicolor decor: one filament per distinct color (AMS, AMS lite or manual swaps).

## How it works

1. **Cut-out**: image transparency, or background color (sampled on the borders, adjustable tolerance). The outline is traced at sub-pixel precision, smoothed, then cleaned in millimeters (narrow gaps closed, details thinner than the nozzle removed).
2. **Two parts**: the **shell** follows the silhouette; the **cap** is the silhouette shrunk by the wall (2 mm) and the clearance (0.6 mm). It slides inside the shell.
3. **Switch placement**: ClickGen searches the cap for the position and angle where the switch square (14.8 mm relief + walls) fits entirely, as close as possible to the center of mass. Shapes that are too small are enlarged automatically (can be disabled).
4. **Colors**: the image is reduced to 1–5 colors (k-means in Lab). The largest area colors the cap; the others become thin decor layers printed against the bed.
5. **Export**: a `.3mf` with two objects (shell upright, **cap flipped** decor-side down), one filament per distinct color, the purge tower placed inside the plate; or a zip of STL files.

## Print and assemble

1. Open the `.3mf` in Bambu Studio or OrcaSlicer, check the filaments, print.
2. Press the switch into the shell's pocket from above (pins into the cavity): it is held by friction.
3. Push the cap onto the switch's cross stem. It must be able to travel 4 mm; the shell wraps it almost down to the bottom.

The 3MF carries the settings of a **Bambu Lab A1 mini** (0.4 mm nozzle, 0.16 mm layers, 2 walls, 15 % infill). On another machine, simply change printer in the slicer: parts and filaments are kept.

## Tuning the fit

Default dimensions (14.0 mm pocket, 4.13 × 1.12 mm cross, 0.6 mm cap/shell clearance) come from the Cherry MX datasheet and from clickers printed by other makers. **They have not been validated by the author on every printer**: each machine prints holes slightly smaller or larger. In the "Fit" section:

- *Switch pocket*: + widens the 14 mm square, − tightens it.
- *Cross socket grip*: + widens the cap's cross, − tightens it.
- *Cap / shell clearance*: increase it if the cap rubs.
- *Stem sleeve diameter*: reduce it if your switch has a "box" around the stem.

Adjust in steps of 0.05 to 0.1 mm after a first test print.

## Development

```bash
npm test          # 23 tests: image, placement, mechanical dimensions, 3MF, STL
npm run serve     # dev server on port 5173
```

- `src/image/` cut-out, contours, colors · `src/geometry/` placement and solids ([manifold-3d](https://github.com/elalish/manifold)) · `src/export/` 3MF, STL, plate layout · `src/view/` 3D and 2D previews · `src/worker.js` off-main-thread computation.
- Design notes (dimensions, vertical stack, print orientation, Bambu 3MF format): [`docs/DESIGN.md`](docs/DESIGN.md) (French).
- Generated 3MF files were sliced with Bambu Studio's CLI (`return_code 0`, filaments and colors preserved).

## Known limits

- Very detailed images and photos give complicated silhouettes: prefer a logo, a mascot or flat art on a transparent or plain background.
- Only one piece is kept (the largest); detached islands are ignored.
- Only the A1 mini profile is embedded in the 3MF.

## License

MIT, see [`LICENSE`](LICENSE). Third-party components (manifold-3d, three.js, fflate, IBM Plex): [`THIRD_PARTY.md`](THIRD_PARTY.md). ClickGen is not affiliated with Cherry, Bambu Lab or ClickerFactory.
