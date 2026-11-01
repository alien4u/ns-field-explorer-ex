# Privacy Policy - NetSuite Field Explorer EX

**Last updated:** August 4, 2026

## Data Collection

NetSuite Field Explorer EX does **not** collect, transmit, or store any personal or sensitive data. Period.

## How It Works

All data is retrieved **live from the page context** by fetching the record's XML representation (`&xml=T`) via NetSuite's native HTTP interface. The extension runs entirely within your browser and communicates only with the NetSuite page you are currently viewing.

## What Is Stored

The extension stores **user preferences only** - nothing else.

In your browser's synced storage (`chrome.storage.sync`), with a mirrored copy in local storage as an offline fallback:

- Theme selection (Auto / Dark / Light)
- Compact mode toggle
- View mode preference (New / Legacy)
- Field filter preference (All / Custom / Standard)

In your browser's local storage (`chrome.storage.local`) only, never synced:

- Popup width and height
- Nav Manager hidden menu selections (per account and global)

The extension itself **never transmits anything** to any external server. If you have your browser's built-in sync turned on, the four display preferences above may be synced across your devices by your browser vendor (Google, Microsoft, or Mozilla) under their privacy policy. That transfer is performed by the browser, not by this extension, and carries no record data - only the preference flags listed above. Turning off browser sync, or signing out of your browser profile, keeps everything on the device.

## No External Servers

This extension does **not**:

- Send data to any external server or third-party service (browser-managed preference sync is not an extension transmission)
- Use analytics, tracking, or telemetry of any kind
- Collect login credentials, tokens, or session data
- Store or cache any NetSuite record data beyond the current page view

## Permissions

| Permission | Purpose |
|------------|---------|
| `activeTab` | Interact with the current page when activated |
| `storage` | Persist user preferences (display preferences roam via browser sync) and Nav Manager configuration |
| `scripting` | Execute scripts in NetSuite tabs for data retrieval and menu extraction |
| `optional_host_permissions: *.netsuite.com` | Requested on first Nav Manager use to auto-hide menus on page load |

All permissions are used exclusively for the extension's core functionality as described above.

## Open Source

This extension is fully open source. You can audit the complete source code at:

🔗 **https://github.com/alien4u/ns-field-explorer-ex**

## Contact

If you have questions or concerns about this privacy policy, please open an issue on the GitHub repository.

---

*Powered by Alien Technology LLC*
