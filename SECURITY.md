# Security and privacy
by LanternSquid

The plugin makes no network requests. It has no telemetry, ads, account requirement, payment integration, or external services. It reads task notes included by the Base, opens linked task notes, and writes PNG/PDF files to `Visual Gantt Exports` inside the current vault. It doesn't use Node.js or Electron APIs and doesn't access files outside the vault.

Date editing is off by default. When enabled, a confirmation dialog precedes every date save and Undo. Saves update only the configured date properties through `FileManager.processFrontMatter`. Obsidian can reformat YAML during that operation.

The plugin rejects overlapping date moves, changed target dates or dependencies, changed milestone flags, missing task notes, changed dates or dependencies in the rendered task set, and concurrent date saves through the plugin. Undo also checks that the view contains the same task paths and property settings. These checks aren't a transaction across multiple notes. Another application or sync client could still change a related note after it was checked. A general backup remains the user's responsibility.

Report ordinary bugs through Issues. For a security problem, check the repository's Security tab for a private reporting option. If one isn't available, open an issue requesting a private contact method without posting private note contents or exploit details.

The supported beta environment is Obsidian 1.15.1 or newer on desktop. Only Obsidian 1.15.1 on macOS has been tested in the application so far. Mobile installation is disabled pending device testing.
