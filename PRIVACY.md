# Privacy Policy - NetSuite Field Explorer EX

**Last updated:** November 1, 2026

## Data Collection

NetSuite Field Explorer EX does **not** collect or transmit any personal or sensitive data. It keeps only what is listed under What Is Stored, in your own browser.

## How It Works

Field labels and types are read **locally** from the form already rendered in your tab, and from a reference file packaged with the extension. Neither involves a network request.

All data is retrieved **live from the page context** by fetching the record's XML representation (`&xml=T`) via NetSuite's native HTTP interface. The extension runs entirely within your browser and communicates only with the NetSuite page you are currently viewing.

## What Is Stored

The extension stores **user preferences** and, only if you click **Pin**, one in-memory snapshot of a record - nothing else.

In your browser's synced storage (`chrome.storage.sync`), with a mirrored copy in local storage as an offline fallback:

- Theme selection (Auto / Dark / Light)
- Compact mode toggle
- View mode preference (New / Legacy)
- Field filter preference (All / Custom / Standard)
- Empty fields preference (show or hide)

In your browser's local storage (`chrome.storage.local`) only, never synced:

- Popup width and height
- Nav Manager hidden menu selections (per account and global)

If you click **Pin**, one snapshot of that record's fields and sublist lines, whose values can include names, addresses and other business data, is held in your browser's session storage (`chrome.storage.session`) so you can compare it with another record. It stays in memory only: it is not written to disk, is never synced, is replaced by the next pin, and is gone when you click Unpin or close the browser.

The extension itself **never transmits anything** to any external server. If you have your browser's built-in sync turned on, the five display preferences above may be synced across your devices by your browser vendor (Google, Microsoft, or Mozilla) under their privacy policy. That transfer is performed by the browser, not by this extension, and carries no record data - only the preference flags listed above. Turning off browser sync, or signing out of your browser profile, keeps everything on the device.

## No External Servers

This extension does **not**:

- Send data to any external server or third-party service (browser-managed preference sync is not an extension transmission)
- Use analytics, tracking, or telemetry of any kind
- Collect login credentials, tokens, or session data
- Store or cache any NetSuite record data beyond the current page view, other than the in-memory snapshot you ask for with Pin

## Permissions

| Permission | Purpose |
|------------|---------|
| `activeTab` | Interact with the current page when activated |
| `storage` | Persist user preferences (display preferences roam via browser sync) and Nav Manager configuration, and hold the snapshot you Pin in session storage, in memory only |
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
