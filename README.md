# Blueprint PC

A local desktop app that turns a plain-English description into a buildable
hardware project: parts list with prices, a pin-accurate wiring diagram, and
step-by-step assembly instructions.

Everything runs on your machine. No account, no server, no subscription.

---

## What you get

| Section | What it shows |
| --- | --- |
| **INFO** | What the build is, parts cost, wiring counts by type, named nets, version history |
| **BOM** | Bill of materials with quantities, model prices, live offers from retailers, and export to CSV |
| **WIRING** | Auto-laid-out diagram with board-style parts. Power on the left, controller in the middle, peripherals right. Colour-coded by wire kind |
| **MECH** | 3D CAD view of every part — rotate, zoom, pan. Loads STL/GLB/OBJ from source URLs, falls back to a coloured primitive by category |
| **INSTRUCTIONS** | Ordered assembly steps you can tick off at the bench, with per-step components |
| **PART** | Search the local parts catalogue and add parts to this design |

Export the wiring diagram as SVG, the parts list as CSV, or the whole project as JSON.

A global **Part library** in the sidebar is a searchable offline mirror of 6,000+ real
parts with descriptions, pinouts and prices — see [Part library](#part-library) below.

### Home: prompt-to-hardware

Describe what you want to build in plain English and the AI generates a complete
design: parts, wiring, assembly steps, and a product summary. Choose **Lite** for
fast generation or **Pro** for tighter part matching and fuller breakdowns. The
input defaults to text; image and sketch input are placeholders for future vision
model support.

---

## Setup

### 1. Install dependencies

```powershell
npm install
```

### 2. Add an AI API key

The app needs a model to do the designing. Launch it, click **Settings**, and
paste a key for whichever provider you prefer.

- **NVIDIA NIM** (default) — hosted open models, free tier. Get a key at <https://build.nvidia.com>
- **Google Gemini** — has a free tier. Get a key at <https://aistudio.google.com/apikey>
- **OpenAI** — get a key at <https://platform.openai.com/api-keys>

Once an NVIDIA key is entered, click **Load model list** and the model field
becomes a searchable picker of every model your account can actually call. That
beats guessing a catalog string like `meta/llama-3.3-70b-instruct`.

The key is stored in plain text on your machine and is only ever sent to the
provider you pick. It is never included in any export.

You can switch providers at any time in Settings; each provider keeps its own
key and model.

### 3. Run it

```powershell
npm run dev
```

---

## Building a standalone app

Produces `release/win-unpacked/Blueprint PC.exe` — a double-clickable app, no
terminal needed.

```powershell
npm run build
npm run package
```

The folder is about 330 MB because it bundles a full Chromium and Node runtime.
That is normal for an Electron app.

---

## Where your data lives

```
%APPDATA%\blueprint-pc\data\
  settings.json     your API key and model choice
  projects.json     every project, design, and version
  catalogue.db      the offline part library (SQLite)
  images/           generated product renders and part photos
```

The JSON files are plain text; `catalogue.db` is a SQLite database. Back them up by
copying the folder. Delete them to reset the app completely.

This folder is the same whether you run from source or a packaged build, and it
survives a reinstall — the app anchors it to a fixed name under your user data,
not to the app's display name. Reinstalling never touches it, and the next sync
only fetches parts you do not already hold.

There is also an **Open data folder** button in the sidebar.

---

## Configuration

`npm run check` runs the built-in self-check for the pieces that turn unreliable
model or source data into something safe to show (154 assertions covering id
assignment, dropped broken connections, layout ordering, and Schematik price,
pin and currency parsing).

`npm run typecheck` type-checks the main and renderer processes separately.

### Changing the model

Settings has a model field for the active provider. For NVIDIA NIM, use **Load
model list** to see what your key can call. If a model returns capacity errors,
try another — Google's models in particular rotate fast, and older names like
`gemini-2.5-flash` have been retired.

---

### Part thumbnails

Every row in the parts list shows a photo. The app tries three sources in order:

1. A direct image URL the model supplied with the part
2. The `og:image` social preview on the product page (a real shop listing photo)
3. A **Wikimedia Commons** search on the part name

Sources 1 and 2 are what you want but they fail constantly: the model invents
product URLs (4 of 4 Amazon links were dead in testing) and shops block scrapers.
Commons is the one that actually fills the table, and it covers 8 of the 10 parts
in a typical build. The two that miss are a capacitive soil sensor and a generic
OLED module, which are not on Commons at all; they fall back to a category glyph
rather than showing a misleading photo.

Results are filtered for relevance. Commons full-text search will happily return
a pinout diagram for "ESP32 DevKit" or an antenna for "capacitive soil", and a
wrong picture in a parts list you are about to order from is worse than no
picture. Titles that do not share enough words with the part are rejected.

Photos are cached by part name in `data/part-images.json`, so each one is looked
up once.

> **Attribution:** Commons images are free-licensed (mostly CC BY-SA) but they do
> require credit. Fine for personal use. If you ever share or publish this app,
> you must display the file title, author and licence for each photo.

Each row also has a search button built from the part name, which always finds
something purchasable.

### Price comparison

Every row shows the **cheapest live offer** across four retailers, with the store name
underneath. Click the chevron to expand the full comparison: every offer with its store,
listing title, unit price and the cost for the quantity you need.

Stores checked per part: **Adafruit**, **AliExpress**, **eBay** and **Amazon**.

- Adafruit and AliExpress answer a plain request and carry prices in their markup.
- eBay returns 403 to a scripted request, so it is fetched in a hidden browser window.
- Amazon refuses the first search of a session until the homepage has set its cookies, so
  it gets a warm-up navigation in the same window.

AliExpress and Amazon geo-localise by IP and quote in the local currency (MVR here). Each
offer keeps its own currency and any converted dollar figure is shown with an `≈`, because
comparing `158.17` against `11.49` as though the units matched would be quietly wrong.

Walmart is deliberately not queried: its listings are US-only and unreachable from the
Maldives, so a cheap price there is not one you can pay. DigiKey, Mouser, RobotShop and
Newark return 403; Temu redirects every search to a login page.

Results are cached for 24 hours, so opening the parts list repeatedly does not re-scrape.

> **Prices are scraped snapshots, not live quotes.** They are a planning aid. Always open
> the store listing before ordering.

### Part detail

Click any row in the parts list to open a detail view for that part: the best price, the
live offers, every wire it participates in, and links into four CAD libraries (GrabCAD,
SnapEDA, Ultra Librarian, Thingiverse). CAD links are offered for categories that have a
physical shape worth modelling, not for passives.

**Matching, and why it is strict.** A naive keyword match will happily sell you a
1.3" SH1106 OLED when you asked for a 0.96" SSD1306, or a "Simple Soil Moisture Sensor"
when you asked for a capacitive one. Both were real results in testing. So:

- If the part name contains a **model number** (DHT22, SSD1306, ESP32), the listing
  must contain it too. Bare dimensions like `128x64` are ignored, because they match
  half the catalogue.
- If it has no model number, every distinctive word of the request must appear.
- If nothing passes that bar, the app falls back to looser matches and labels them
  **approximate** in the header and on the expanded row. A wrong price is worse than
  no price, so this is deliberately biased toward precision.

### Part library

Open **Part library** in the sidebar for a searchable, offline mirror of a public
electronics catalogue (6,000+ parts from Schematik). Search by name, brand or part
number; select a result to see its description, full pinout and price. When a part in
your design matches a library entry, the part detail view shows that description and
pinout too.

**Interactive pinout.** Each part's pins render as a package diagram beside a pin
table. Hover or focus a pin in either view and it highlights in both — the same
logical↔physical link a real pinout sheet gives you. Pins are colour-coded by
function (power, ground, data, signal) using the same palette as the wiring diagram.
The diagram is a schematic layout derived from the pin list, not a to-scale
manufacturing footprint (the source does not supply pad coordinates); a later version
can drop in true coordinates for standard packages without changing this view.

**Recently viewed & parts tray.** The library remembers the last parts you viewed
(across restarts) and shows them on the empty state. Selecting a part adds it to a
parts tray (up to five) at the bottom of the screen; from there you can view any
tray part's detail, compare two or more parts side-by-side (specs + pinouts), or
clear the tray. Category filter chips let you narrow results without retyping.

**It is a local cache, not a live feed.** Click **Import more** to pull a batch of parts
from the source; each run is bounded and resumable, and the source is a free public
service, so the import is deliberately slow (one request at a time, ~40 parts per run).
The data lives in an SQLite file (`catalogue.db`) in your data folder, so search never
touches the network once a part is imported.

**Freshness, honestly.** The source exposes no per-part change dates, so a sync only
adds parts it does not already hold — it does not re-fetch existing ones. A part's price
can therefore go stale until you reset the library. Treat library prices as indicative
and check the source link before ordering.

**Attribution.** Part names, descriptions, pinouts and prices are mirrored from the
public Schematik catalogue (schematik.io), used under its fair-use terms for a personal,
non-commercial mirror. They are the source's own work, may be incomplete, and are not
warrantied.

## Honest limitations

- **Prices are model estimates.** They come from the model's training data, not
  a live shop feed. Check the linked page before ordering.
- **Pin numbers can be wrong.** The prompt pushes hard for accuracy, but a model
  can still invent a pin. Verify against the datasheet before wiring anything
  to mains or a power supply.
- **No real CAD export.** Producing STEP or STL files needs a solid-modelling
  kernel (OpenCASCADE-class) that normally runs as a server service. This app
  gives you the parts, the wiring, and the assembly steps instead.
- **Part photos are best-effort.** Vendor pages block scrapers and the model
  invents product URLs, so most rows fall back to a category illustration. Photos
  appear automatically when the URL is real.
- **One design at a time.** There is no multi-user sync, sharing, or community.
  It is a single-user local tool by design.

---

## Project layout

```
src/
  shared/           types shared by both processes, plus the design summariser
  main/             Electron main process
    ai/
      prompts.ts    system prompt and schema contract
      llm.ts        Gemini and OpenAI HTTP clients
      normalise.ts  turns raw model JSON into a validated DesignSpec
    catalogue/
      db.ts         the SQLite part library (schema, search, save, query)
    sync/
      schematik.ts  polite, resumable import from the public Schematik MCP
      schematik-parse.ts  pure price/pin parsing (covered by the self-check)
    store.ts        JSON persistence (atomic writes)
    settings.ts     API key and model storage
    paths.ts        the one stable data/images directory (survives reinstall)
    ipc.ts          the IPC surface
  renderer/src/
    pages/          Home, ProjectView, PartLibrary, and the tabs
    components/     Sidebar, SettingsDialog, WiringDiagram, PinoutView
    lib/
      wiringLayout.ts  column layout engine, shared with the SVG export
      packageLayout.ts DIP-style package layout + pin colour categories
      export.ts        CSV / SVG / JSON export
scripts/
  selfcheck.ts        154 runnable assertions over the risky logic
  verify-wiring.mjs   asserts every drawn wire lands on a real pin dot
  verify-offers.mjs   runs the retailer parsers against captured pages
  verify-catalogue.mjs  drives a real sync + search + get through the app
  verify-library-ui.mjs  drives the Part library UI over CDP
  verify-phase2.mjs   drives Home + ProjectView tabs over CDP
```

## Security notes

- `contextIsolation` on, `nodeIntegration` off, `sandbox` on.
- The renderer reaches the main process only through the explicit allowlist in
  `src/main/preload.ts`. There is no generic IPC bridge.
- API keys live in the main process only and are never exposed to the renderer
  except by explicit read for display.
- All model I/O is server-side in the main process; the renderer holds a strict
  Content-Security-Policy.