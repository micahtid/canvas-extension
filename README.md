# canvas-extension

A Chrome MV3 extension that customizes the appearance of Canvas LMS and adds a weekly task list widget.

Built with Vite, vanilla JS/CSS, and the Canvas REST API.

## Build

```bash
npm install
npm run build
```

Load the `dist/` folder as an unpacked extension from `chrome://extensions` (Developer mode on).

## Features

- **Customization modal** — click the toolbar icon to open a full-screen modal with live previews for every setting.
- **Course Cards** — corner radius, shadow, image toggle, opacity, columns, gap, header height, and theme presets (Pastel, Monochrome, Vibrant, Warm, Cool, Dark).
- **Left Sidebar** — compact restyle with adjustable icon/label size and optional icon-only mode.
- **Theme** — global accent color, density, border radius.
- **Tasks Widget** — replaces Canvas's native "To Do" sidebar with a weekly task list; configurable progress style (bar / ring / segments), sort order, and filters.

## Structure

- `src/content.js` — content script: settings, modal, weekly tasks widget, DOM observers.
- `src/content.css` — all styles (Canvas overrides + modal + previews).
- `src/background.js` — MV3 service worker; toggles the modal on toolbar click.
- `manifest.json` — MV3 manifest.
- `vite.config.js` — builds a single IIFE bundle and copies static assets to `dist/`.
- `CHANGELOG.md` — every change we make to Canvas, dated.
