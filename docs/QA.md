# Verification and beta test plan
by LanternSquid

## Automated coverage

Local verification used Node.js 25.9.0. The full test suite passed with UTC, America/New_York, and Pacific/Auckland timezones.

The local test runner checks JavaScript syntax, calendar dates, leap years, absent Bases values, real list members with commas, case ambiguity, explicit missing paths, cycles, a 5,000-task dependency chain, status mapping, unsafe property collisions, stale target writes, changed dates and dependencies across the rendered valid task set, changed milestone flags, deleted notes, concurrent saves, lock recovery after a write error, Undo scope, zoom geometry, Today and Project controls, width persistence, keyboard editing, 9-pixel-per-day week dragging, empty views, 500-note limits, and large-chart DOM bounds.

Export tests check PDF cross-reference offsets, image embedding, metadata, balanced pagination, page-count limits, and oversized PNG rejection. Release checks verify matching versions, the MIT license, branding, demo-file identity, and the absence of network calls, raw HTML insertion, and Node.js/Electron runtime imports.

Run `npm test`. The runner needs no npm packages. The prepared GitHub Actions matrix targets Windows, Linux, and macOS on Node.js 22 and 24. Check the repository Actions tab for its current run results. CI verifies mocked tests, not application compatibility.

## Application evidence

Test environment: macOS, Obsidian 1.15.1. Tests were performed on November 22, 2026.

- The valid project renders 12 tasks, 13 dependencies, and four milestones without warnings.
- Day, Week, and Month controls change the displayed scale without changing task dates.
- The chosen zoom and task-column width survive an Obsidian reload.
- Today includes the local calendar date when it falls before the scheduled project. Project restores the scheduled range.
- PNG output is a valid complete image.
- PDF output opens in Obsidian. Its image streams and document structure parse successfully in an independent PDF reader library.
- Export status and Open export remain available after a Base data refresh.
- The final installed files match the release source byte for byte. The final application pass saved Firewall policy audit as December 9–12, restored December 8–11 with Undo, and rejected a proposed December 7 start. Date editing was turned off after testing.
- The final balanced PDF contains two pages. It passes strict PDF parsing, and the final page contains Monitoring and Operations handoff with repeated headings and a correct page count.
- The final build was inspected in both light and dark themes. Earlier application checks also confirmed task-note navigation and pinned labels and date headings.

## Remaining beta coverage

| Environment or check | Status |
|---|---|
| Obsidian 1.15.1 on macOS | Final build installed and tested, including save, Undo, overlap rejection, PDF pagination, and both themes. |
| Newer Obsidian releases | Not tested. |
| Windows Obsidian | Not tested in the application. |
| Linux Obsidian | Not tested in the application. |
| Mobile | Not tested and disabled in the manifest. |
| Third-party themes | Not tested. |
| Independent human code review | A community review draft is prepared. No independent human review has been performed or requested publicly yet. |
| Official directory scanner | Not run. Submission requires publication and a working sign-in. |

## Reproduction steps for reviewers

1. Open the included demo and enable the plugin. Check the 12 tasks and four milestones in the valid project. Check the seven expected warnings and six drawn tasks in the validation sample.
2. Try all three zoom levels. Drag the Task column edge, then use the arrow keys on it. Reload Obsidian and confirm the settings remain. Scroll both directions and check pinned labels and dates.
3. Click Today and Project. Test a project that spans today and one that doesn't. Verify the marker uses the machine's local calendar date.
4. Export PNG and PDF. Check every task label and milestone, the legend, page dates, and final page. Test a project that barely exceeds a page width to catch empty padding pages.
5. Enable editing in the disposable demo. Move Firewall policy audit from December 8–11 to December 9–12. Save, inspect its properties, and Undo. Confirm December 8–11 returns.
6. Move that task to December 7–10. Save must be rejected because Inventory ends on December 7. Cancel must leave the note unchanged.
7. Open an edit dialog, then change another task's dates or dependencies. The pending save must refuse stale data. Also test deletion, a changed milestone flag, and two simultaneous plugin saves.
8. Change the Base's filters after an edit. Undo must refuse a different task set. Restore the original Base and task set to retry.
9. Try a large Base. More than 500 included notes must show a helpful message. Large PNG or PDF exports must stop at their limits without creating partial files.

## Review boundaries

Cross-note checks reduce stale writes but aren't an atomic transaction across all notes. The filtered Base defines the dependency scope. PDF charts are rasterized, and dependencies crossing page boundaries aren't drawn. These limitations are documented in the README rather than hidden by the test results.

## Publication

The live macOS regression pass is complete. Public source repository: https://github.com/ExploitedBlackDuck/visual-gantt-bases. The first beta is being published through the authenticated browser. Official directory submission and independent human review have not been completed.

## 0.7.1 review fixes

Removed CSS importance overrides after the Obsidian preview scan flagged them. Task-button styles now use chart-scoped selectors. Reduced-motion scrolling targets the timeline scroll region. The v0.7.0 macOS evidence above covers the unchanged runtime logic. The 0.7.1 CSS was copied into the demo vault and its light-mode chart was inspected in Obsidian 1.15.1. Task labels, row alignment, bars, milestones, and arrows remained readable.
