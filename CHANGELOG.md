# Field Explorer EX — Changelog

## v1.0.0 — February 7, 2026

Initial release. Complete rewrite of the NetSuite Field Explorer concept with modern architecture.

### Architecture
- **Data source:** `&xml=T` URL parameter (zero governance, pure HTTP fetch)
- **XML parsing:** Native `DOMParser` (replaced X2JS library)
- **Filtering:** Native JavaScript (replaced lodash)
- **Rendering:** Custom table renderers with tabbed interface
- **Icon activation:** `tabs.onUpdated` (cross-browser, replaced `declarativeContent`)
- **Execution model:** On-demand via `chrome.scripting.executeScript`

### Features
- **Tabbed interface:** Body Fields | Sublists | Raw JSON
- **Body Fields table:** Field ID, Value, and Type columns
- **Field type detection:** Heuristic detection (checkbox, date, select, currency, number, email, url, id, text)
- **Sublist viewer:** Dropdown picker, proper column headers, line numbers
- **Click-to-copy:** Click any field ID or value to copy to clipboard
- **Search/filter:** Real-time search across field names and values with highlight
- **Dark Mode:** Toggle with setting persistence
- **Compact Mode:** Condensed view toggle with setting persistence
- **Export JSON:** Full record data export
- **Export CSV:** Body fields export (Field ID, Value, Type)
- **Record info header:** Record type + internal ID (clickable to copy)
- **Field/sublist count:** Displayed in header
- **Footer links:** Records Browser + Records Catalog for current record type
- **Keyboard shortcut:** Ctrl+Shift+F to open popup
- **Smart icon:** Grayed out on non-NetSuite pages

### Dependencies
- Zero external libraries (no lodash, no X2JS, no CDN loads)
- Icons borrowed from original NetSuite Field Explorer (placeholder, replace later)

### Cross-Browser Support
- Chrome (MV3)
- Edge (MV3)
- Firefox (MV3, gecko ID + strict_min_version 109)
- Safari (via Web Extension wrapper)

### Files
| File | Purpose |
|------|---------|
| `manifest.json` | MV3 manifest, cross-browser |
| `popup.html` | Tabbed popup layout |
| `js/background.js` | Service worker, icon activation |
| `js/popup.js` | All logic: fetch, parse, render, export |
| `css/main.css` | Full styling (light/dark/compact) |
