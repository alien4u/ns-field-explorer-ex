> **⚠️ Disclaimer:** This is a personal project shared under the [MIT License](LICENSE). It is not intended to replace, compete with, or serve as an alternative to any other similar plugin, extension, or tool, commercial or otherwise. Use it as you see fit, at your own risk.
>
> This extension is inspired by and built upon the ideas of the original [**NetSuite Field Explorer**](https://github.com/michoelchaikin/netsuite-field-explorer) by [Michoel Chaikin](https://github.com/michoelchaikin). His extension has been an invaluable tool for the NetSuite community — if you haven't already, go give it a ⭐ and consider [supporting his work](https://github.com/michoelchaikin/netsuite-field-explorer). Field Explorer EX is a ground-up rewrite with a different architecture and additional features, but the original inspiration belongs to Michoel.
>
> In response to [Oracle's security notification regarding Chrome extensions](https://community.oracle.com/netsuite/english/discussion/4512418/security-notification-chrome-extensions), this extension has been made fully open source so that anyone can audit the code, verify its behavior, and confirm that it does not collect, transmit, or store any sensitive data. Transparency is the best security policy.

---

# NetSuite Field Explorer EX

**Explore and inspect every field on any NetSuite record — body fields, sublists, raw data, and navigation management in one tool.**

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Manifest](https://img.shields.io/badge/manifest-v3-orange)

## Overview

NetSuite Field Explorer EX is a browser extension for NetSuite administrators, developers, and consultants. It gives you instant visibility into every field on any record — body fields with types, sublists with all columns, raw JSON, and a built-in navigation manager to declutter NetSuite's menu bar.

Open any record, click the icon, and get a complete breakdown of the record's data. Or use the Nav Manager on any NetSuite page to hide menu items you don't need.

## Features

### Field Explorer

- 🔍 **Body Fields Table** · View all fields with IDs, values, and auto-detected types (checkbox, date, select, currency, etc.). Click any field ID or value to copy to clipboard.

- 📋 **Sublists** · Browse all sublists with column headers and line data. Select sublists from a dropdown, with line counts shown.

- 📄 **Raw JSON** · Full record data in formatted JSON, ready for inspection or copying.

- 🌳 **Legacy Tree View** · JSONFormatter-powered expandable tree view for familiar drill-down inspection.

- 🔎 **Search** · Filter fields and sublists in real-time by name or value. Highlights matches across all views.

- 🏷️ **Field Filter** · Toggle between All, Custom, or Standard fields across every view.

- ↕️ **Sortable Columns** · Click column headers to sort body fields by ID, value, or type.

- 📥 **Export** · Download filtered data as JSON or CSV with one click.

- 📖 **Records Browser & Catalog Links** · Quick links to NetSuite's official record documentation for the current record type.

- 🌙 **Dark / Light Mode**

- 📐 **Compact Mode** · Condensed layout for smaller screens.

### Nav Manager

- 🗂️ **Menu Visibility Control** · Hide unwanted NetSuite navigation menu items — no more cluttered menu bars from installed bundles and SuiteApps.

- 🌐 **All Instances** · Hide menu items globally across every NetSuite account you use.

- 📋 **Per-Account** · Hide menu items for specific accounts only (auto-detected from URL).

- 🔄 **Smart Overlap Handling** · Items hidden globally show as locked in the account tree with a 🌐 indicator. No redundant storage.

- ⚡ **Instant Apply** · Menu items hide/show immediately without page refresh via CSS injection.

- 🔎 **Search** · Filter the menu tree by name or automation ID.

- 🌲 **Expandable Tree** · Nested menu structure with expand/collapse controls.

- 💾 **Persistent** · Selections survive browser restarts. Stored locally, never transmitted.

## How It Works

### Field Explorer

1. Navigate to any record page in NetSuite.
2. Click the extension icon (it lights up on NetSuite pages).
3. Browse body fields, sublists, and raw JSON across tabs.
4. Use search, filters, and sorting to find what you need.
5. Click any value to copy it to your clipboard.

The extension fetches the record's XML representation (`&xml=T`) via NetSuite's native HTTP interface and parses it client-side. No SuiteScript execution, no governance cost.

### Nav Manager

1. Click the extension icon on any NetSuite page.
2. Click the **🗂️ Nav** button in the header.
3. The menu tree loads all detected navigation items.
4. Check items to hide them — choose **All Instances** for global rules or the **Account** section for per-account rules.
5. Click **← Back** to return to the field explorer.

Hidden menus are applied instantly via a content script that injects CSS on every NetSuite page load. Uses the same selector approach as custom Stylus/UserCSS scripts (`data-automation-id` primary, `aria-label` fallback).

## Architecture

```
[Field Explorer]
        │
    popup.html / popup.js
        │
        ├── chrome.scripting.executeScript
        │       (fetches record URL + &xml=T)
        │
        ├── Parse XML → body fields, sublists
        │
        └── Render: Table / Sublists / Raw JSON / Legacy Tree


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

> **Firefox users:** Before loading, rename `manifest_firefox.json` to `manifest.json` (replacing the original). The Firefox manifest includes the required `background.scripts` fallback and `browser_specific_settings` for Firefox compatibility.

### Permissions

| Permission | Purpose |
|------------|---------|
| `host_permissions: *.netsuite.com` | Fetch record XML data and inject scripts on NetSuite pages |
| `activeTab` | Interact with the current page when activated |
| `storage` | Persist preferences and Nav Manager configuration |
| `scripting` | Execute scripts in NetSuite tabs for data retrieval and menu extraction |
| `tabs` | Detect NetSuite pages for contextual icon activation |

## Browser Compatibility

Chrome, Edge, Firefox (MV3, 109+), and Safari (via Web Extension wrapper).

> The default `manifest.json` targets Chrome and Edge. A `manifest_firefox.json` is included for Firefox, which adds the `background.scripts` fallback and `browser_specific_settings` required by Firefox's extension platform.

## License

[MIT](LICENSE)

---

*Powered by Alien Technology LLC*
