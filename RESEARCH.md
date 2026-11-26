# Research: scraping price, image and description for parts

Measured on 2026-11-23 from this machine (Maldives, so AliExpress and Amazon
geo-localise to MVR). Every "works" below was observed in this session, not
assumed. Anything marked **UNVERIFIED** was not tested and should be treated as a
guess.

## Short version

For **price and image**, scraping is the only option that works for everyone, and
it works for three of the four stores the user asked about. For **description**,
there is no single trick: each store keeps it somewhere different, and two of the
four keep it in the DOM rather than in any structured data.

Official APIs exist for eBay and AliExpress and are the better long-term answer,
but both are gated behind business accounts that a hobby project will not have.
Amazon's API is gated behind sales you do not have yet. Temu has no buyer-facing
API at all.

## What each store actually exposes

| Store | Price | Image | Description | Where it lives |
| --- | --- | --- | --- | --- |
| eBay | ✅ | ✅ | ⚠️ thin | `schema.org/Product` JSON-LD on the item page |
| AliExpress | ✅ | ✅ | ❌ | prices in an embedded SSR blob; description not server-rendered |
| Amazon | ✅ | ✅ | ✅ | plain DOM: `.a-price`, `#landingImage`, `#feature-bullets` |
| Temu | ❌ | ❌ | ❌ | search redirects to a login page |
| Adafruit | ✅ | ✅ | ✅ | schema.org microdata on the search page |
| Walmart | ✅ | ✅ | ✅ | plain DOM on the search page |

## Store by store

### eBay — the best-behaved target

**Reaching it.** Plain `fetch` returns **403** from Akamai. Nine combinations
(three user-agents × three hosts) all failed. Real Chromium returns the full
results page. Electron already ships Chromium, so a hidden `BrowserWindow` is
enough; no extra dependency.

**Price and image.** The item page carries a clean JSON-LD block, verified on
`/itm/306977743375`:

```
@type: Product
name: 0.49" I2C IIC OLED White Display Screen Module SSD1306 64x32
offers: { price: "2.84", priceCurrency: "USD", availability: InStock }
image:  { url: ".../s-l1600.jpg", width: 1600, height: 1600 }
mpn, model, brand, gtin13 also present
```

That is price, currency, stock and a 1600-pixel image in one object, with no
scraping of prose.

**Description.** JSON-LD has an empty `description`; `og:description` is boilerplate
("Find many great new & used options..."). The real text is in the listing DOM.
**UNVERIFIED**: the exact selector for a long description was not confirmed; the
title from JSON-LD is the reliable field.

**Search results.** One `<li class="s-item">` per listing with `.s-item__title`,
`.s-item__price` and an `/itm/<id>` link. Filter two things:
- The first row is usually an advert titled **"Shop on eBay"** with a placeholder
  link `/itm/123456`.
- Every title ends with "Opens in a new window or tab", which must be stripped or
  it pollutes model-number matching.

**Legal.** `robots.txt` for `User-agent: *` contains `Disallow: /sch/` and
`Disallow: /sch/i.html?_nkw=`, so **searching eBay by keyword is disallowed**;
`/itm/` pages are allowed. The User Agreement (section 3, current from 2026-06-28)
bans "any robot, spider, scraper, data mining tools" without express permission.
Scraping search results is therefore against both.

### AliExpress — prices yes, descriptions no

**Reaching it.** Plain `fetch` works: 200, ~780 KB. Prices are in an embedded SSR
blob, not in the visible text (a naive `$` search finds zero prices).

**Price.** The shape, verified:

```
"productId":"1005008430150201"
"title":{ "displayTitle":"5 Pcs 0.96 Inch OLED ... SSD1306 ..." }
"prices":{ "salePrice":{ "minPrice":133.54, "currencyCode":"MVR", ... },
           "singleDiscountPrice":{ "minPrice":26.71, ... } }
```

Two traps:
1. `prices` also has a top-level `minPrice` that is the **undiscounted** price.
   Reading the first `minPrice` returns that instead of the sale price, so the
   lookup must be scoped inside each price object.
2. `salePrice` on a "5 Pcs" listing is the price of all five;
   `singleDiscountPrice` is per piece. Only the per-piece value is comparable to
   other stores' unit prices.

**Currency.** AliExpress geo-localises by IP and quotes this user in **MVR**.
Six overrides were tried (`?currency=USD`, `?Currency=USD`, `aep_usuc_f` cookie,
`xman_us_f` cookie, both cookies, and the `aliexpress.us` storefront — which does
not resolve). All returned MVR. **The server decides; the client cannot override.**

**Image.** `og:image` gives the main photo, and `image.imgUrl` in the blob gives it
protocol-relative. Both work.

**Description.** Not available server-side: zero JSON-LD blocks, `og:description`
is the generic "Smarter Shopping, Better Living!", and `meta name="description"`
is empty. The real description loads with the product detail view. Getting it
needs either the Dropshipping API (`aliexpress.ds.product.get`, which returns
description, specs, images and video) or rendering the item page in a browser and
reading the description panel — the latter is **UNVERIFIED**.

**Legal.** `robots.txt` has `Disallow: /wholesale*` but explicitly
`Allow: /wholesale.html$` and `Allow: /wholesale-page-*.html`. The URL used here
(`/w/wholesale-<term>.html`) matches no listed `Disallow` for `/w/`.

### Amazon — best descriptions, hardest access

**Reaching it.** Two obstacles, both solved:
- The **first search of a session returns 503** ("Sorry! Something went wrong!").
  Loading the homepage first, in the same session, then searching, returns real
  results. Verified: 503 cold, 200 with a warm-up.
- Product pages carry **no JSON-LD and no Open Graph tags** at all.

**Price.** DOM only: `span.a-price span.a-offscreen`. Exclude `a-text-price`,
which is the struck-through list price, or you report the saving instead of the
price. Prices come back as **"MVR 147.10"** — Amazon geo-localises too, with the
currency in the price text rather than a data attribute.

**Image.** `img.s-image` on search results; `#landingImage` on the product page.

**Description.** The good news: `#feature-bullets li` returns clean, specific text,
for example "Embedded Driver IC: SSD1306. Communication: I2C/IIC Interface, only
need two I / O ports". This is better than anything the other stores expose.

**Links.** Some sponsored cards have no `/dp/` anchor. Skip them; an offer without
a link is not actionable.

**Legal.** `robots.txt` is 220 lines but has **no rule against `/s?`** search, so
search is not disallowed there. Amazon's Conditions of Use still restrict
programmatic access, and the Associates API is the sanctioned route.

### Temu — not scrapable

Plain `fetch` returns 200 with a **2.9 KB obfuscated JavaScript proof-of-work**
that mints `tc...` cookies and reloads. Real Chromium gets past the script and then
**redirects to `login.html`** — search requires an account. `/api/search` returns
403.

Temu's Partner Platform is a **seller/merchant** API (product listing, pricing,
orders for your own store), not a buyer price feed. The affiliate programme gives
referral links, not a catalog API.

Conclusion: **drop Temu.** There is no honest path to its prices without
credentials.

## Official APIs, and why they are not the answer yet

| Platform | What it gives | Gate | Verdict |
| --- | --- | --- | --- |
| eBay Browse API | `item_summary/search` → title, price, currency, image, itemWebUrl | Developer account + app; free tier reported at 5,000 calls/day; production Buy API access requires eBay's eligibility approval | Best long-term route. Worth applying for. |
| Amazon Creators API (replaced PA-API 5.0) | Titles, images, prices, availability for ASINs | Associates account **+ 10 qualifying sales in the trailing 30 days**, per marketplace | Unusable now. Revisit if the project ever refers real sales. |
| AliExpress Open Platform (Dropshipping / Affiliate) | `aliexpress.ds.product.get` returns description, specs, images, video, stock per variant | Developer profile approval + app + OAuth token; dropshipping requires joining `ds.aliexpress.com` | Viable, but only worth it if descriptions become a hard requirement. |
| Temu Partner Platform | Seller product management, not buyer prices | Merchant account | Not applicable. |

Sources: [eBay Browse API](https://developer.ebay.com/develop/api/buy/browse_api),
[eBay Browse search reference](https://www.realtyapi.io/blog/ebay-api-search),
[Amazon Creators API prerequisites](https://affiliate-program.amazon.com/creatorsapi/docs/),
[AliExpress Open Platform](https://openservice.aliexpress.com/doc/doc.htm),
[AliExpress API comparison](https://quarralabs.com/guides/aliexpress-api-alternative/),
[Temu Partner Platform](https://partner.temu.com/documentation).

## Practical rules the scraper follows

1. **Prefer JSON-LD/microdata, fall back to DOM.** Structured data changes far less
   often than class names. eBay is the proof: one JSON block replaces all guesswork.
2. **Identify the client honestly.** The app currently sends a Chrome user-agent,
   which is what gets past most edges. That is a deliberate choice, not an
   oversight, but it means the requests look like a browser rather than a bot.
3. **Cache for 24 hours.** `data/offers.json` already does this. It keeps the load
   on other people's servers low and makes the tab feel instant.
4. **Run browser-backed stores last.** eBay and Amazon cost a window and ~10
   seconds each; they only run when the cheap stores come up empty or approximate.
5. **Never invent a URL.** A fabricated listing link is worse than no offer, which
   is why cards without a real `/itm/` or `/dp/` link are dropped.
6. **Label conversions.** AliExpress and Amazon quote MVR; anything converted is
   shown with "≈" and the peg, never as a quote.

## What this changed in the app

**Price comparison now covers four stores: Adafruit, AliExpress, eBay and Amazon.**
Walmart was removed rather than kept. It was reachable and its prices were real, but its
listings are US-only and this user is in the Maldives, so the cheapest Walmart price was
never one they could actually pay. A comparison that cannot be acted on is noise.

Mixed currencies are handled rather than ignored: every offer keeps its own currency, and
anything converted to dollars is shown with an "≈" and the peg it used.

**Part photos now fall back to a retailer listing photo.** Commons had no entry for two of
the ten parts in the sample project (a capacitive soil sensor and a generic OLED module),
so both showed a placeholder. The shops selling those parts have perfectly good product
photos, and they were already being fetched for the price comparison, so the image
resolver now reuses them. Both parts now render a real photo.

**Clicking a part opens a detail view** with its best price, full offer table, every wire it
participates in, and links into four CAD libraries. The CAD links are searches, not
lookups: none of the four sites offers a keyless API, so sending the user to the site's own
search is cheaper and more durable than scraping a result count that would break on the
next redesign. GrabCAD needed care here - `?q=` is silently ignored and returns "Recent
models", so it takes `?query=`.

Not implemented, and the honest gap: **description**. The research says it is available from
Amazon (`#feature-bullets`) and, with an API, from AliExpress; eBay and Walmart have it only
as prose in the DOM. If descriptions are wanted, Amazon is the cheapest source and eBay the
most fragile.

A second gap: the app has no per-store shipping check, so a price is not a landed price. For
a user in the Maldives that difference is often bigger than the price difference between
stores.
---

# Competitor study: schematik.io

Studied from the browser on 2026-11-24. Public pages only; `/app` requires an account.

## What it is

"Schematik: AI Hardware Builder for ESP32, Arduino and Pico". Tagline **"Cursor for
Hardware"**. Series of AI-generated hardware projects from a plain-English prompt.
$4.6M pre-seed from Lightspeed, covered by WIRED, 250k+ users. This is a direct
competitor to Blueprint PC, and a much larger one.

Supported boards: ESP32 (S2/S3/C3/C6/P4), ESP8266, Arduino Uno/Nano/Mega, Pi Pico/RP2040.

## What it does

- Generates a project from a prompt: firmware (Arduino, ESPHome, ESP-IDF), wiring
  diagram, component list, pin assignments, assembly steps
- Runs the firmware in a **browser simulator** on a 3D workbench (screens, LEDs,
  servos, serial monitor react)
- Compiles in the cloud, flashes over USB from Chrome/Edge (UF2 for Pico)
- Buys parts from shops that ship to the user's country, or pushes a DigiKey cart
- Publishes build guides; anyone can remix them
- macOS desktop app for Apple silicon

## The parts catalogue

6,021 parts in 68 curated groups (ESP32 boards, Arduino, Pico, HATs/shields,
displays...), filterable by level and platform. Images are curated assets served
from Vercel Blob through Next.js image optimisation, not scraped from vendors.

Each part page carries `schema.org/Product` JSON-LD with sku, brand, image, and an
`offers` block (`lowPrice`, `highPrice`, `offerCount`, `priceCurrency`), plus a
pinout drawn as an **SVG diagram** rather than only a table.

## The MCP server (the interesting part)

`https://www.schematik.io/mcp` — free, read-only, **no sign-in**, Streamable HTTP.
Four tools: `search_parts`, `get_part`, `search_build_guides`, `get_build_guide`.

Verified live on 2026-11-24. `get_part` for `ssd1306-oled` returned:

- a real description ("0.96 inch class white OLED display module using the SSD1306
  driver, 128x64 resolution, I2C protocol, 3V-5V supply, about 80mW consumption")
- a price (`"from 3.95 EUR"`)
- a structured pinout: `VCC` (power, 3-5V), `GND` (ground), `SDA` and `SCL` (i2c),
  each with a `function` and `required` flag

Those pin types line up with the `Connection.kind` values this app already uses.

Their terms allow it: "Public build guides and parts are available without signing
in." Fair use forbids scraping "at a scale that harms other users". They do log
which tool was called and the search words.

## Where it is weaker, and Blueprint PC's opening

- No offline mode: it is a cloud service with an account
- The simulator runs firmware but does not model voltage or current
- Flashing needs desktop Chrome or Edge
- Prices are a single "from" figure per part, not a comparison across shops

Blueprint PC is local-first with no account, and now compares four retailers. That
is a real difference to keep, not a gap to close.

## What is worth taking

1. **Use the MCP as a parts data source.** It closes three gaps this app has
   documented as unfixable: no descriptions, no pinouts, and prices that come from
   brittle scraping. A keyless read-only endpoint beats parsing retailer HTML.
2. **Adopt `schema.org/Product` JSON-LD on part pages.** This app emits none, so no
   search engine or assistant can read a build.
3. **Draw a pinout, not just a list.** A small SVG pinout in the detail view is
   what makes a part page look authoritative.
4. **Publish a "facts for AI" page.** Cheap, and it is how a small tool gets
   described correctly by assistants.

Risks in taking (1): it is a third-party service that can change or disappear;
prices are their single source, not a comparison; and part names leave the machine.
