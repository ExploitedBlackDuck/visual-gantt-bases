# Contributing
by LanternSquid

Use Node.js 22 or later. There are no third-party runtime dependencies and no npm install step. Run `npm test` from the repository root. The tests mock Obsidian for logic and rendering checks. They don't replace testing inside Obsidian.

Keep geometry consistent between the HTML chart, drag gestures, PNG export, and PDF pages. Add regression coverage for date handling, concurrent writes, dependency resolution, and export boundaries when changing those areas. Keep dates as calendar days. Use Obsidian's public Vault and FileManager APIs. Don't add network requests, analytics, or external file access without an explicit design decision and README disclosure.

After changing a release asset, copy the three runtime files into `demo-vault/.obsidian/plugins/visual-gantt-bases/`. Run the tests again. Check the valid project and the validation-errors sample in Obsidian. Follow `docs/QA.md` and record which environments you actually tested.

The GitHub workflow runs the mocked tests on three operating systems and two Node.js versions. A passing workflow doesn't establish that the Obsidian application was tested on those operating systems.
