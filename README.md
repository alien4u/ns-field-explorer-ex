> **Disclaimer:** This is a personal project shared under the [FSL-1.1-MIT License](LICENSE). It is not intended to replace, compete with, or serve as an alternative to any other similar plugin, extension, or tool, commercial or otherwise. Use it as you see fit, at your own risk.
>
> This extension is inspired by and built upon the ideas of the original [**NetSuite Field Explorer**](https://github.com/michoelchaikin/netsuite-field-explorer) by [Michoel Chaikin](https://github.com/michoelchaikin). His extension has been an invaluable tool for the NetSuite community. If you haven't already, go give it a ⭐ and consider [supporting his work](https://github.com/michoelchaikin/netsuite-field-explorer). Field Explorer EX is a ground-up rewrite with a different architecture and additional features, but the original inspiration belongs to Michoel.
>
> In response to [Oracle's security notification regarding Chrome extensions](https://community.oracle.com/netsuite/english/discussion/4512418/security-notification-chrome-extensions), this extension has been made fully open source so that anyone can audit the code, verify its behavior, and confirm that it does not collect, transmit, or store any sensitive data. Transparency is the best security policy.

---

# NetSuite Field Explorer EX

**Explore and inspect every field on any NetSuite record: body fields, sublists, raw data, and navigation management in one tool.**

![Version](https://img.shields.io/badge/version-1.2.0-blue)
![License](https://img.shields.io/badge/license-FSL--1.1--MIT-green)
![Manifest](https://img.shields.io/badge/manifest-v3-orange)

## Store Availability

| Store | Version | Link |
|-------|---------|------|
| Chrome Web Store | v1.2.0 | [Install](https://chromewebstore.google.com/detail/netsuite-field-explorer-e/pdmkaejbieljlcemfjpmgifjljhgniij) |
| Edge Add-ons | v1.2.0 | [Install](https://microsoftedge.microsoft.com/addons/detail/fanclcoacijckjhfbcocfmcdfkkbnlci) |
| Firefox Add-ons | v1.2.0 | [Install](https://addons.mozilla.org/en-US/firefox/addon/netsuite-field-explorer-ex/) |

## Overview

NetSuite Field Explorer EX is a browser extension for NetSuite administrators, developers, and consultants. It gives you instant visibility into every field on any record: body fields with types, sublists with all columns, raw JSON, and a built-in navigation manager to declutter NetSuite's menu bar.

Open any record, click the icon, and get a complete breakdown of the record's data. Or use the Nav Manager on any NetSuite page to hide menu items you don't need.

## Features

### Field Explorer

- 🔍 **Body Fields Table** · View all fields with IDs, form labels, values, and real field types. Labels and types come from the page you are on, then Oracle's records reference, then a heuristic. Click any field ID or value to copy to clipboard.

- 📋 **Sublists** · Browse all sublists with column headers, labels and line data. Select sublists from a dropdown, with line counts shown.

- 🕳️ **Empty Fields** · Turn on **Empty** to see the fields and columns the record has but that hold no value. Search finds them either way, by ID or label.

- 📌 **Pin and Compare** · Pin a record, open another one, and a **Compare** tab lists what differs: body fields and sublist lines, added, removed and changed. The snapshot lives in memory only and is gone when the browser closes.

- 📄 **Raw JSON** · Full record data in formatted JSON, ready for inspection or copying.

- 🌳 **Legacy Tree View** · JSONFormatter-powered expandable tree view for familiar drill-down inspection.

- 🔎 **Search Everything** · Filter by field ID, label or value in real time. Tabs and the sublist dropdown show how many rows match, and the Sublists tab moves to the first sublist with hits. Highlights matches across all views.

- 🏷️ **Field Filter** · Toggle between All, Custom, or Standard fields across every view.

- ↕️ **Sortable Columns** · Click column headers to sort body fields by ID, value, or type.

- 📥 **Export** · Download filtered data as JSON, body-field CSV, or per-sublist CSV with one click. CSV exports carry a UTF-8 BOM and are formula-injection safe.

- 📖 **Records Browser & Catalog Links** · Quick links to NetSuite's official record documentation for the current record type.

- 🌙 **Auto / Dark / Light Theme** · Auto follows your system theme and repaints when it changes.

- 📐 **Compact Mode** · Condensed layout for smaller screens.

- ↔️ **Resizable Popup** · Drag the corner grip to resize the popup width and height. Your preferred size is remembered across sessions.

### Nav Manager

- 🗂️ **Menu Visibility Control** · Hide unwanted NetSuite navigation menu items. No more cluttered menu bars from installed bundles and SuiteApps.

- 🌐 **All Instances** · Hide menu items globally across every NetSuite account you use.

- 📋 **Per-Account** · Hide menu items for specific accounts only (auto-detected from URL).

- 🔄 **Smart Overlap Handling** · Items hidden globally show as locked in the account tree with a 🌐 indicator. No redundant storage.

- ⚡ **Instant Apply** · Menu items hide/show immediately without page refresh via CSS injection.

- 🔎 **Search** · Filter the menu tree by name.

- 🌲 **Expandable Tree** · Expand and collapse the All Instances and Account sections. The tree lists top-level menu items, because NetSuite renders submenus only on hover.

- 💾 **Persistent** · Selections survive browser restarts. Stored locally, never transmitted.

## How It Works

### Field Explorer

1. Navigate to any record page in NetSuite.
2. Click the extension icon.
3. Browse body fields, sublists, and raw JSON across tabs.
4. Use search, filters, and sorting to find what you need.
5. Click any value to copy it to your clipboard.
6. To compare two records, click the Pin icon on the first, then open the second and go to the **Compare** tab.

The extension fetches the record's XML representation (`&xml=T`) via NetSuite's native HTTP interface, parses it client-side, and reads field labels and types from the rendered form. No SuiteScript execution, no governance cost.

### Nav Manager

1. Click the extension icon on any NetSuite page.
2. Click the **Nav Manager** button (folder icon) in the header.
3. The menu tree loads the detected top-level navigation items.
4. Check items to hide them. Choose **All Instances** for global rules or the **Account** section for per-account rules.
5. Click **← Back** to return to the field explorer.

Hidden menus are applied instantly via a content script that injects CSS on every NetSuite page load. Rules match the menu item's `aria-label`, plus `data-automation-id` for rules saved by older builds.

## Architecture

```
[Field Explorer]
        │
    popup.html / popup.js
        │
        ├── chrome.scripting.executeScript
        │       (fetches record URL + &xml=T, reads form labels and types from the page)
        │
        ├── js/core.js: parse XML, merge page + data/records-reference.json labels
        │
        └── Render: Table / Sublists / Raw JSON / Legacy Tree / Compare


[Nav Manager]
        │
    popup.html / navmanager.js
        │
        ├── chrome.scripting.executeScript
        │       (extracts [role="menuitem"] tree from DOM)
        │
        ├── Render checkbox tree (All Instances + Account)
        │
        └── chrome.storage.local → save selections
                    │
                    ▼
              navhider.js (content script)
                    │
        ├── Runs on ALL netsuite.com pages at document_start
        ├── Reads navHide_all + navHide_{accountId}
        └── Injects <style> with display:none selectors
```

## Installation

### From Source (Developer Mode)

1. Clone this repository
2. Open your browser's extension management page:
   - **Chrome:** `chrome://extensions`
   - **Edge:** `edge://extensions`
   - **Firefox:** `about:debugging#/runtime/this-firefox`
3. Enable **Developer Mode**
4. Click **Load unpacked** and select the project folder

> **Firefox users:** Before loading, rename `manifest_firefox.json` to `manifest.json` (replacing the original). The Firefox manifest includes the required `browser_specific_settings` for Firefox compatibility.

### Permissions

| Permission | Purpose |
|------------|---------|
| `activeTab` | Interact with the current page when activated |
| `storage` | Persist preferences and Nav Manager configuration (display preferences roam via your browser's sync), and hold the record you Pin in session storage, in memory only |
| `scripting` | Execute scripts in NetSuite tabs for data retrieval and menu extraction |
| `optional_host_permissions: *.netsuite.com` | Requested on first Nav Manager use to auto-hide menus on page load |

## Browser Compatibility

Chrome, Edge, Firefox (MV3, 140+), and Safari (via Web Extension wrapper).

> The default `manifest.json` targets Chrome and Edge. A `manifest_firefox.json` is included for Firefox, which adds the `background.scripts` fallback and `browser_specific_settings` required by Firefox's extension platform.

## Tests

No dependencies to install. From a fresh clone, with [Bun](https://bun.sh) and Chrome (set `CHROME_BIN` if Chrome is not at the default macOS path):

```
bun test tests/                 # unit: real source files in node:vm
bun tests/browser/run.js        # real popup.html, CSS and JS in headless Chrome, CSP on
```

`bun tests/e2e/smoke.js` checks the packaged extension and does not run from a clone alone. It needs both release zips in `dist/`, made by `build.sh`, a local packaging script that is not in this repository; Chrome for Testing, since branded Chrome ignores `--load-extension` (Playwright's copy is found automatically, or set `CHROME_FOR_TESTING`); and network access on first use for `bunx web-ext`.

`data/records-reference.json` is generated from Oracle's records reference by `tools/build-reference.js`.

## Acknowledgments

- Icons and store images co-authored with **Gemini NanoBanana Pro**
- Code co-authored with **Claude Code**
- Third-party material and licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

## Changelog

### v1.2.0 - 2026-11-02

**New in this release**

- Field labels and real types: body rows and sublist headers show the form's label, read from the page, then from Oracle's records reference. Search matches labels, and the body CSV gains a `Label` column
- Empty fields: an **Empty** checkbox shows the fields and columns that hold no value; search finds them either way
- Search everything: match counts on the tabs and the sublist dropdown, automatic move to the first sublist with hits, and Raw JSON narrows with the term
- Pin and compare: pin a record and compare it with the next one you open, body and lines, in a new **Compare** tab. Memory only

**Popup sizing**

- Pre-paint size and theme restore via `js/boot.js` - the popup now opens at its stored size instead of painting at the default and correcting afterwards, which is what produced the white band on Chrome 151
- Size clamps moved under Chrome's hard popup cap (792x592) and the dragged values are persisted instead of rounded element sizes
- `html` carries the theme background and `color-scheme`, so there is no light flash on a dark-themed popup

**Features**

- Sublist CSV export - export every line of the selected sublist with its column headers
- Auto dark mode - the theme toggle now cycles Auto / Dark / Light, Auto follows the system theme live
- Display preferences roam through `storage.sync` with a one-time copy-forward from existing local settings
- Sublist search now filters lines as well as columns, and large sublists render the first 500 rows with a notice (exports remain complete)
- Sticky table headers and sticky copy buttons in the Raw JSON and Legacy panels
- Nav Manager: rules whose menu item is missing from the scanned page are listed under "Not in current menu" with per-rule Unhide, plus a two-step "Clear all" per scope

**Fixes**

- NetSuite detection now parses the hostname instead of substring-matching the URL, in both the explorer and the Nav Manager menu scrape
- Copy feedback is tracked per element, so two quick copies no longer strand a "Copied" label, and a failed copy reports "Copy failed" instead of failing silently
- Value-column sort and sublist search no longer stringify select fields to `[object Object]`
- Nav rules saved by older builds keep working now that menu anchors carry no `data-automation-id`: a rule with both an id and a label matches on either, shows checked and unchecks cleanly
- `_csrf` and `_eml_nkey_` are no longer shown, copied, searched or exported, and the record's `fields` attribute no longer becomes a row
- Suitelets are never requested a second time, and create-mode records now open (`ID: (new)`). The record check moved from "has an id parameter" to the page path
- Each fetch outcome has its own message: NetSuite's own error text, HTTP errors, not a record, expired session, a 60 s timeout, unparseable
- `custpage` and `cseg` fields count as Custom; `customform` and `customer` stay Standard
- Type detection no longer calls `paid` an id, and recognizes `YYYY-MM-DD` and `D-Mon-YYYY` dates
- The Legacy tree follows the theme, and repaints when it changes
- Records Browser and Records Catalog links use your account's own domain, Records Browser moved to 2026.1 and is hidden for custom record and custom transaction types
- Nav Manager search opens branches holding a match without touching what you expanded, and a matching parent keeps its children
- Removed the sponsor footer; the footer version now comes from the manifest
- Account rules are no longer saved under a dead key when no account is detected
- Startup failures render an error instead of leaving "Loading record data..." on screen
- Links inside the Legacy JSON tree open in a new tab instead of navigating the popup away
- CSV exports carry a UTF-8 BOM and guard against spreadsheet formula injection

**Accessibility and performance**

- ARIA tablist with arrow-key navigation, `aria-sort` on sortable headers, keyboard-activatable copy targets and visible focus states
- Nav Manager tree toggles, section headers and orphan headers work by keyboard
- 150 ms search debounce, and only the visible panel re-renders on each keystroke

**Housekeeping**

- Shared module (`js/shared.js`) removes four copies of the browser API shim and two of the registration logic
- Content-script registration is now verified after every register/update
- Nav rule storage schema v2 with a one-time migration on update
- Firefox `strict_min_version` lowered to 140.0 (ESR), 142.0 on Firefox for Android, the first version there that supports `data_collection_permissions`; `build.sh` enforces manifest version parity and stops shipping unreferenced artwork

### v1.1.1 - 2026-03-10

- Removed smart icon (gray out) - extension icon is always clickable; non-NetSuite pages show a friendly message
- Dropped `host_permissions` and `content_scripts` from manifests - eliminates install-time browser warnings
- Nav Manager now uses `optional_host_permissions` with a one-time permission prompt on first use
- Permission gate interstitial with open source transparency note before browser permission request
- Dynamic content script registration via `scripting.registerContentScripts` (persists across restarts)
- Minimal background service worker for content script re-registration on extension update
- Removed dead spinner CSS and unused variables
- Updated Records Browser URL to 2025.2
- Hungarian notation cleanup across all JS files

### v1.1.0 - 2026-03-05

- Complete UI overhaul -- CSS custom properties design token system (`--fe-*` prefix), dark navy toolbar, consistent shadows and transitions
- SVG sprite icon system replacing inline emoji throughout the UI
- Floating copy-to-clipboard buttons on Raw JSON panel (both New and Legacy views) with "Copied!" feedback
- Redesigned two-row filter bar with record info and field count separation
- Footer with sponsor branding
- Eliminated all `innerHTML` usage across every JS file for Firefox AMO compliance
- DocumentFragment-based search highlighting (XSS-safe)
- TreeWalker-based legacy view search highlighting (pure DOM, no HTML string manipulation)
- Resizable popup -- drag the bottom-left corner grip to adjust width and height, persisted via chrome.storage.local
- Cross-browser compatibility verified (Chrome, Edge, Firefox MV3 -- 0 blockers)

### v1.0.2

- Initial public release

## License

[FSL-1.1-MIT](LICENSE) -- Free to use for any non-competing purpose. Converts to MIT automatically after two years.

---

*By [Alien Technology LLC](https://www.alientechnologyllc.com/)*
