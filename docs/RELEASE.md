# Release preparation
by LanternSquid

## Release 0.7.0

This is a beta for community testing. The code and demo have completed local automated checks and the final macOS application pass. Public source repository: https://github.com/ExploitedBlackDuck/visual-gantt-bases. The first beta is being published through the authenticated browser. Use the steps below when preparing subsequent releases.

The runtime assets are `main.js`, `manifest.json`, and `styles.css`. The checked-in main.js is the runtime source, so there's no compilation step. The repository includes an MIT license, documentation, tests, and a GitHub Actions matrix. No npm install step is needed.

Before publishing:

1. Run `npm test` and inspect `docs/QA.md` for the actual test evidence and remaining platform coverage.
2. Create an owned public GitHub repository, such as `visual-gantt-bases`. Push this repository's files without local exports or unrelated vault contents.
3. Create and push a Git tag named exactly `0.7.0`. It must match the manifest version.
4. Create a GitHub release with that tag. Attach `main.js`, `manifest.json`, and `styles.css` individually. The ZIP is an optional convenience download and doesn't replace those assets.
5. Use the prepared text in `docs/COMMUNITY_REVIEW.md` to request beta testing. Replace any local installation references with the actual repository URL.
6. After beta feedback, sign in at https://community.obsidian.md, connect the owning GitHub account, and submit the repository. Resolve the automated review findings before announcing general availability.

The manifest requires Obsidian 1.15.1, which is the version actually tested. Mobile installation stays disabled until an actual device test is completed. Don't lower the minimum version or set `isDesktopOnly` to false based solely on mocked tests.

Official submission guide: https://docs.obsidian.md/plugins/releasing/submit-plugin
Requirements: https://docs.obsidian.md/community-directory/submission-requirements-for-plugins

## Rollback

Disable the plugin, replace the three runtime files with the saved v0.6.0 release, then reload Obsidian. Settings introduced in 0.7.0 can remain in a Base and will be ignored by 0.6.0. Undo history is in memory and doesn't survive reloads. Export files remain ordinary vault files.
