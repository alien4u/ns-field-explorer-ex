# NetSuite Field Explorer EX — Store Listing

---

## Extension Name

NetSuite Field Explorer EX

## Short Description (132 chars max)

Explore and inspect all fields on any NetSuite record — body fields, sublists, and raw data. Zero governance. Zero scripts required.

## Detailed Description

**NetSuite Field Explorer EX** gives NetSuite developers and administrators instant visibility into every field on any record — without writing a single line of SuiteScript and without consuming any governance units.

Inspired by the original [NetSuite Field Explorer](https://chromewebstore.google.com/detail/netsuite-field-explorer/cekalaapeajnlhphgdpmngmollojdfnd) extension by Michoel Chaikin, Field Explorer EX is a ground-up rebuild with a modern interface, zero external dependencies, and powerful new features for the NetSuite developer workflow.

### How It Works

Click the extension icon (or press **Ctrl+Shift+F**) on any NetSuite record page. Field Explorer EX reads the record's native XML representation to extract every body field, sublist, and line item value — all without injecting scripts or using NetSuite API governance.

### Key Features

**📊 Two View Modes**
- **New Mode** — Clean tabbed interface with sortable tables for body fields, sublists, and raw JSON
- **Legacy Mode** — Collapsible JSON tree matching the style of the original NetSuite Field Explorer, for developers who prefer the classic explorer-style navigation

**🔎 Smart Search & Filter**
- Real-time search across field names and values with highlighted matches
- Filter by field type: All Fields, Custom Only, or Standard Only
- Filters apply to both the display and all exports

**📋 Body Fields Table**
- Field ID, value, and auto-detected type for every field on the record
- Type detection: checkbox, date, select, multiselect, currency, number, email, URL, and more
- Type indicators with intuitive icons

**📑 Sublist Viewer**
- Dropdown picker to jump between sublists
- Proper column headers with line numbers
- Line count per sublist

**📥 Export**
- Export to JSON (full record data including sublists)
- Export to CSV (body fields with Field ID, Value, and Type columns)
- Exports respect your current filter — export only custom fields, only standard fields, or everything

**🖱️ Click-to-Copy**
- Click any field ID or value to copy it to your clipboard instantly
- Visual confirmation on copy

**🎨 Display Options**
- Dark Mode and Light Mode toggle
- Compact Mode for denser layouts
- All preferences are saved and restored automatically

**🔗 Quick Links**
- One-click links to the NetSuite Records Browser and Records Catalog for the current record type

**⚡ Zero Overhead**
- No SuiteScript execution — zero governance units consumed
- No content scripts injected into NetSuite pages
- No external network requests — everything runs locally
- No third-party analytics or tracking

### Who Is This For?

- **SuiteScript Developers** — Quickly find field IDs, check values, inspect sublists while building scripts
- **NetSuite Administrators** — Audit field values, verify custom fields, troubleshoot record data
- **Implementation Consultants** — Explore unfamiliar records, document field structures, export field inventories

### Cross-Browser Support

NetSuite Field Explorer EX works on Chrome, Edge, and Firefox.

### Acknowledgments

This extension was inspired by the original [NetSuite Field Explorer](https://chromewebstore.google.com/detail/netsuite-field-explorer/cekalaapeajnlhphgdpmngmollojdfnd) by Michoel Chaikin (michoel@gmail.com). The original extension pioneered the `&xml=T` approach for zero-governance field exploration. Field Explorer EX builds on that concept with a redesigned interface, field type detection, custom field filtering, dual view modes, export capabilities, and zero external dependencies.

---

**Developed by Alien Technology LLC**

---

## Category

Developer Tools

## Language

English

---

## Privacy Practices

### Single Purpose Description

NetSuite Field Explorer EX reads and displays all field data from the currently active NetSuite record page. It parses the record's XML representation to present body fields, sublist data, and raw record data in a searchable, filterable, and exportable interface. The extension operates entirely within the user's browser session and does not transmit any data externally.

### Data Usage Disclosures

**This extension does not:**
- Collect or transmit any user data
- Use analytics or tracking services
- Store data outside the user's browser
- Make network requests to any server other than the user's own NetSuite instance
- Sell or share any data with third parties

**This extension stores locally (via chrome.storage.local):**
- User display preferences only (dark mode, compact mode, view mode, field filter selection)

### Are you using remote code?

No. All code is bundled with the extension. No remote code is loaded or executed.

---

## Permissions Justifications

### `activeTab`

**What it does:** Grants temporary access to the currently active tab when the user clicks the extension icon or uses the keyboard shortcut.

**Why it's needed:** NetSuite Field Explorer EX needs to read the URL of the active tab to construct the XML data request (`&xml=T` parameter) and execute a fetch within the tab's context to retrieve the record data. Access is only granted for the active tab and only when the user explicitly invokes the extension — it never runs in the background or accesses other tabs.

**Justification:** Required to read the current NetSuite record page URL and fetch the record's XML data representation from within the page's authenticated session context.

---

### `storage`

**What it does:** Allows the extension to save and retrieve small amounts of data using `chrome.storage.local`.

**Why it's needed:** NetSuite Field Explorer EX persists user display preferences (dark mode on/off, compact mode on/off, selected view mode, and field filter selection) so settings are remembered between popup sessions. No record data or personal information is stored — only UI preference flags.

**Justification:** Required to persist user display preferences (dark mode, compact mode, view mode, field filter) across sessions. Only boolean flags and string values are stored. No user data, credentials, or record content is saved.

---

### `scripting`

**What it does:** Allows the extension to execute a script in the context of the active web page via `chrome.scripting.executeScript`.

**Why it's needed:** To retrieve record data, the extension must execute a `fetch()` call within the NetSuite page's authenticated session context. The injected script makes a single HTTP GET request to the same record URL with `&xml=T` appended, which returns the record's data as XML. This fetch must run within the page context to include the user's existing NetSuite session cookies for authentication. No scripts are persistently injected — the function runs once per popup open and returns the XML response text.

**Justification:** Required to execute a single `fetch()` call within the NetSuite page context to retrieve the record's XML data. The fetch uses the page's existing authenticated session (cookies). No persistent content scripts are injected. The script runs only when the user opens the popup.

---

### `tabs`

**What it does:** Allows the extension to query tab information (URL, tab ID) and listen for tab update events.

**Why it's needed:** Used for two purposes:
1. **Icon activation:** The background service worker listens to `tabs.onUpdated` and `tabs.onActivated` to enable/disable the extension icon based on whether the current tab is a NetSuite page (`*.netsuite.com`). The icon is grayed out on non-NetSuite pages to indicate the extension is not applicable.
2. **Tab identification:** When the popup opens, `chrome.tabs.query` retrieves the active tab's URL and ID to determine the record URL and target the `scripting.executeScript` call.

**Justification:** Required to (1) enable/disable the extension icon based on whether the active tab is a NetSuite page, and (2) query the active tab's URL to fetch record data. No tab content is read — only URLs are checked against the `*.netsuite.com` pattern.

---

### Host Permission: `https://*.netsuite.com/*`

**What it does:** Allows the extension to interact with pages on NetSuite domains.

**Why it's needed:** NetSuite Field Explorer EX is purpose-built for NetSuite. This host permission is required for `chrome.scripting.executeScript` to run the data-fetching function on NetSuite record pages. The extension only activates on NetSuite domains — it has no functionality on any other website. The wildcard subdomain (`*`) is necessary because NetSuite instances use account-specific subdomains (e.g., `1234567.app.netsuite.com`, `1234567-sb1.app.netsuite.com`).

**Justification:** Required to execute the record data fetch on NetSuite pages. NetSuite uses account-specific subdomains, so the wildcard is necessary to support all NetSuite instances (production, sandbox, and release preview environments). The extension has no functionality outside of NetSuite domains.

---

## Screenshots (Recommended Descriptions)

1. **Body Fields Table (Light Mode)** — "View all body fields with field ID, value, and auto-detected type in a clean table layout."
2. **Body Fields Table (Dark Mode)** — "Full dark mode support for comfortable viewing."
3. **Sublist Viewer** — "Browse sublists with a dropdown picker, proper column headers, and line numbers."
4. **Legacy Mode** — "Classic collapsible JSON tree view inspired by the original NetSuite Field Explorer."
5. **Custom Fields Filter** — "Filter to show only custom fields or only standard fields — filters apply to exports too."
6. **Search with Highlights** — "Real-time search across all field names and values with highlighted matches."
7. **Export Options** — "Export filtered data as JSON or CSV with one click."

---

## Promotional Tile Text (440×280)

**NetSuite Field Explorer EX**
*Every field. Every sublist. Zero governance.*

---

## Tags / Keywords

NetSuite, SuiteScript, field explorer, record fields, developer tools, NetSuite fields, custom fields, sublist viewer, field inspector, NetSuite admin
