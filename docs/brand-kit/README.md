# nex brand kit — Charcoal Neutral (v1.2)

This package is an update of the approved neutral brand direction. The only palette changes are primary Charcoal, Raised Charcoal, the Dark Border, and Ink.

## Open the prototype

- Open `nex_homepage.html` in any modern browser.
- Open `nex_brand_guide.html` for the palette, typography, logo usage and interface rules.
- Search tools with the search field or `/` shortcut. Click cards to preview details.
- To launch a real internal destination, edit the `url` string for that tool in `nex_homepage.html` (`const tools = [...]`).
- Fonts load from Google Fonts when available; system fallbacks keep the page functional offline.

## Reuse the brand

- `nex_brand_palette.css` supplies namespaced CSS variables (`--nex-charcoal`, `--nex-signal-teal`, etc.).
- `nex_design_tokens.json` supplies the corresponding palette and type properties.
- `nex_wordmark_primary.svg` is transparent and is intended for dark backgrounds. Its text uses editable SVG typography and relies on installed font fallbacks if Space Grotesk is unavailable.
- `nex_wordmark_on_charcoal.svg` includes the new Charcoal background.
- `nex_brand_identity.md` documents design intent, ratios, usage and the v1.1-to-v1.2 migration.

## Palette changes from the prior version

- `#252C36` → `#292D34` (Charcoal)
- `#303A45` → `#363B43` (Raised Charcoal)
- `#414D58` → `#454B53` (Dark Border)
- `#202932` → `#252A31` (Ink)

The supporting neutral backgrounds and the two primary teal colors have not changed.
