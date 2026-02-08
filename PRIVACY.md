# Privacy Policy — NetSuite Field Explorer EX

**Last updated:** February 8, 2026

## Data Collection

NetSuite Field Explorer EX does **not** collect, transmit, or store any personal or sensitive data. Period.

## How It Works

All data is retrieved **live from the page context** by fetching the record's XML representation (`&xml=T`) via NetSuite's native HTTP interface. The extension runs entirely within your browser and communicates only with the NetSuite page you are currently viewing.

## What Is Stored Locally

The extension uses your browser's local storage (`chrome.storage.local`) to persist the following **user preferences only**:

- Dark / Light mode selection
- Compact mode toggle
- View mode preference (New / Legacy)
- Field filter preference (All / Custom / Standard)
- Nav Manager hidden menu selections (per account and global)

These preferences are stored locally in your browser and are **never transmitted** to any external server.

## No External Servers

This extension does **not**:

- Send data to any external server or third-party service
- Use analytics, tracking, or telemetry of any kind
- Collect login credentials, tokens, or session data
- Store or cache any NetSuite record data beyond the current page view

## Permissions

| Permission | Purpose |
|------------|---------|
| `host_permissions: *.netsuite.com` | Fetch record XML data and inject scripts on NetSuite pages |
| `activeTab` | Interact with the current page when activated |
| `storage` | Persist user preferences and Nav Manager configuration |
| `scripting` | Execute scripts in NetSuite tabs for data retrieval and menu extraction |
| `tabs` | Detect NetSuite pages for contextual icon activation |

All permissions are used exclusively for the extension's core functionality as described above.

## Open Source

This extension is fully open source. You can audit the complete source code at:

🔗 **https://github.com/alien4u/ns-field-explorer-ex**

## Contact

If you have questions or concerns about this privacy policy, please open an issue on the GitHub repository.

---

*Powered by Alien Technology LLC*
