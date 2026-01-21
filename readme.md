## שיר – Ben Yehuda wake-up poem (PWA)

Minimal, phone-first, offline-friendly PWA that shows a single Hebrew poem/excerpt from Project Ben Yehuda. Swipe left for next, swipe right for previous. Tap the left edge for next, the right edge for previous. Tap middle to toggle the small control bar (theme toggle).

### Running locally
1. Serve the folder (any static server). Examples:
   - `cd /Users/niryariv/Projects/shir && python -m http.server 8000`
   - Or open `index.html` directly in a modern browser (service worker may be restricted when opened via file://).
2. Visit `http://localhost:8000` on your phone/desktop. Install as PWA if prompted.

### Gestures & controls
- Swipe left: next poem.
- Swipe right: previous poem (if available).
- Tap left edge (20% of width): next.
- Tap right edge (20%): previous.
- Tap middle: show/hide controls.
- Control bar: theme toggle (dark by default). Language toggle is present but disabled until English is added.

### Data source
- Uses Project Ben Yehuda public API: `/api/v1/search` (primary) and `/api/v1/texts/batch` (hydration), with `genres: ["poetry"]`, `intellectual_property_types: ["public_domain"]`, `view: "basic"`, `file_format: "html"`, `snippet: true`.
- API key is bundled in `app.js` per your instruction (frontend-only). Update `BEN_YEHUDA_API_KEY` there if you rotate keys.

### Offline behavior
- Service worker caches the app shell and recently fetched API responses for fast morning loads. If offline and no cached item is available, a status message is shown.
- Last viewed poem, theme, and queue state are stored in `localStorage` under `shir.state.v1`.

### Files
- `index.html` – root document and minimal markup.
- `style.css` – responsive, large-type UI with dark/light themes (dark default).
- `app.js` – swipe/edge navigation, Ben Yehuda API client, persistence, service worker registration.
- `manifest.webmanifest` – PWA metadata.
- `service-worker.js` – caches shell + API responses (network-first for API, cache-first for shell).
- `icons/` – placeholder PWA icons.

### Deploying
- Host the static files at any HTTPS origin. Ensure `start_url` and `scope` in `manifest.webmanifest` fit the deploy path (currently `./` for root).
- Keep `icons/icon-192.png` and `icons/icon-512.png` accessible at the referenced paths.
