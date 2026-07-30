# Third-Party Assets

This project bundles only local copies of verified permissive assets. There are no runtime hotlinks for these assets.

## Kenney Factory Kit 3.0

- Source: https://kenney.nl/assets/factory-kit
- Creator: Kenney
- License: Creative Commons Zero, CC0
- Official license file: `public/assets/cc0/kenney-factory-kit/License.txt`
- Bundled source files:
  - `public/assets/cc0/kenney-factory-kit/obj/cog-a.obj`
  - `public/assets/cc0/kenney-factory-kit/obj/conveyor-long.obj`
  - `public/assets/cc0/kenney-factory-kit/obj/scanner-high.obj`
  - `public/assets/cc0/kenney-factory-kit/obj/screen-wide.obj`
  - matching `.mtl` files
  - `public/assets/cc0/kenney-factory-kit/textures/colormap.png`
- Converted runtime data: `app/timeRollCc0Meshes.ts`

The selected meshes are imported offline with `scripts/import-obj-to-rawmesh.mjs` and exported as WebGL-safe RawMesh constants.

## Kenney Car Kit 3.1

- Source: https://kenney.nl/assets/car-kit
- Creator: Kenney
- License: Creative Commons Zero, CC0
- Official license file: `public/assets/cc0/kenney-car-kit/License.txt`
- Bundled source files:
  - `public/assets/cc0/kenney-car-kit/obj/wheel-default.obj`
  - `public/assets/cc0/kenney-car-kit/obj/cone.obj`
  - matching `.mtl` files
  - `public/assets/cc0/kenney-car-kit/textures/colormap.png`
- Converted runtime data: `app/timeRollCc0Meshes.ts`

These small transport silhouettes were selected instead of full vehicle bodies to keep the runtime mesh bundle under the mobile WebGL budget.

## Kenney Nature Kit 2.1

- Source: https://kenney.nl/assets/nature-kit
- Creator: Kenney
- License: Creative Commons Zero, CC0
- Official license file: `public/assets/cc0/kenney-nature-kit/License.txt`
- Bundled source files:
  - `public/assets/cc0/kenney-nature-kit/obj/tree_oak.obj`
  - `public/assets/cc0/kenney-nature-kit/obj/mushroom_red.obj`
  - matching `.mtl` files
- Converted runtime data: `app/timeRollCc0Meshes.ts`

The selected Nature Kit OBJ files do not depend on a bundled texture atlas at runtime.

## Generated Material Atlas

- Source image: Codex image generation for this project
- Runtime file: `public/textures/time-roll-material-atlas-5x5.png`
- Dimensions: 1250 x 1250 PNG, 5 x 5 grid, no alpha channel
- Intended use: local material/skin tiles for manufacturing, construction, transport, communication, and life-themed objects.
