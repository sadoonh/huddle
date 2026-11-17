# nex — Charcoal Neutral brand identity

**Version:** 1.2 · November 2026  
**Direction:** Minimal, calm, purposeful. Neutral charcoal defines the header, off-white surfaces keep the catalog readable, and teal provides a distinct brand signal.

## Wordmark

- Brand name: **nex**, always lowercase.
- Primary wordmark: **ne** `#FFFFFF` + **x** `#38D9C5` on a charcoal background.
- Logo font: **Space Grotesk, 700**, tight tracking (`letter-spacing: -0.087em`).
- Desktop size **48px**, mobile **40px**; header left inset **26px** desktop and **16px** mobile.
- Do not put the primary white wordmark on light backgrounds. Do not introduce a standalone symbol without new brand review.

## Color palette

| Name | Hex | Role |
|---|---|---|
| Charcoal | `#292D34` | Primary brand header and dark background |
| Raised Charcoal | `#363B43` | Header depth and elevated dark surfaces |
| Dark Border | `#454B53` | Dividers and edges on charcoal |
| Signal Teal | `#38D9C5` | Logo x and dark-background highlights |
| Light Teal | `#5CE5D3` | Dark-background logo hover |
| Action Teal | `#087F77` | Links and UI focus on white |
| Canvas | `#F6F7F8` | Page background |
| White | `#FFFFFF` | Cards, search and panels |
| Ink | `#252A31` | Primary content typography |
| Secondary Slate | `#66717C` | Descriptions and helper text |
| Light Border | `#E1E5E9` | Dividers and card borders |
| Whisper Teal | `#EAF7F4` | Soft selected states |

### Key relationships

- **Header:** gradient from `#292D34` to `#363B43`, with divider `#454B53`.
- **Logo:** `ne` in `#FFFFFF`, `x` in `#38D9C5`.
- **Canvas and cards:** `#F6F7F8` background; `#FFFFFF` cards.
- **Typography:** `#252A31` headings and body; `#66717C` supporting text.
- **Interactions on white:** `#087F77`, not the brighter logo teal. Use `#EAF7F4` for light selection surfaces.
- **Borders:** `#E1E5E9` on light surfaces.
- **Tool icon palettes:** muted product-specific cues are permitted and do not change the core brand colors.

## Typography

- **Space Grotesk Bold (700)** — wordmark.
- **Manrope ExtraBold (800)** — headings and tool names.
- **DM Sans** — paragraphs, search, controls and metadata.
- Google Fonts imports are used in the HTML. System sans-serif fallback is provided if offline.

## Layout and interaction

- Homepage header: 90px desktop / 76px mobile, dark charcoal gradient.
- Main catalog: three columns desktop, two on tablet, one on mobile.
- Cards: 16px radius, minimal shadow, 204px desktop min-height; original compact proportions retained.
- Search: light surface; Action Teal border and focus halo.
- Interaction: subtle card lift and hover, with `prefers-reduced-motion` support.
- Keep the homepage free of marketing banners, role filters, categories, and tool count badges.

## Implementation files

- `nex_homepage.html` — standalone functional homepage; edit tool names/URLs in its JavaScript `tools` array.
- `nex_brand_guide.html` — interactive visual identity reference.
- `nex_brand_palette.css` — reusable CSS tokens.
- `nex_design_tokens.json` — reusable machine-readable brand tokens.
- `nex_wordmark_primary.svg` — scalable wordmark on transparent canvas; designed for charcoal backgrounds.
- `nex_wordmark_on_charcoal.svg` — scalable lockup with the charcoal background.
- `nex_homepage_desktop.png`, `nex_homepage_mobile.png`, `nex_brand_guide_preview.png` — implementation screenshots.

## Changes from v1.1

| Previous | Current |
|---|---|
| Graphite `#252C36` | Charcoal `#292D34` |
| Raised Graphite `#303A45` | Raised Charcoal `#363B43` |
| Dark header border `#414D58` | Dark Border `#454B53` |
| Ink `#202932` | Ink `#252A31` |

All other core colors are unchanged. In CSS tokens, the old `--nex-graphite*` names were renamed to `--nex-charcoal*` for semantic consistency.
