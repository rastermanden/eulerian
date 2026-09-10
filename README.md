# Eulerian Magnifier

Real-time [Eulerian video magnification](https://people.csail.mit.edu/mrub/evm/)
in the browser. Point a webcam or phone camera at a face to see the pulse, at a
person to see them breathe, or at a speaker to see it vibrate. Everything runs
on the device GPU with WebGL2; no video leaves the browser.

See [PLAN.md](PLAN.md) for the design and roadmap.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173, also reachable on your LAN
```

Phone cameras need HTTPS. For LAN testing either use the deployed GitHub Pages
build or tunnel the dev server (e.g. `npx localtunnel --port 5173`).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | type-check and production build to `dist/` |
| `npm test` | Vitest unit tests for the filter math |
| `npm run smoke` | headless Chromium end-to-end check of the WebGL pipeline on synthetic video |

## How it works

Each frame is converted to YIQ at a reduced processing resolution, decomposed
into a Gaussian pyramid (and Laplacian levels in motion mode), band-pass
filtered over time per pixel with two first-order IIR low-passes, amplified,
recombined coarse-to-fine, and added back to the full-resolution frame. The
IIR coefficients are recomputed from the measured frame interval every frame so
the cutoff frequencies stay correct when the camera drops frames.

Sliders update GPU uniforms directly, so every control is live. Settings are
mirrored into the URL so a good configuration can be shared.

## Deploy

Pushes to `main` build and publish to GitHub Pages via
`.github/workflows/deploy.yml`. Enable Pages with "GitHub Actions" as the
source in the repository settings once.
