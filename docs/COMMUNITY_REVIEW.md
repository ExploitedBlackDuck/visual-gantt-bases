# Community beta review draft
by LanternSquid

I've built Visual Gantt for Bases, a project timeline view for Obsidian Bases. It reads dates, statuses, milestones, and dependencies from Markdown properties.

The 0.7.0 beta includes Day, Week, and Month zoom; a Today marker and jump button; adjustable task-column width; pinned labels and dates; status colors and a legend; and PNG and paginated PDF exports. Optional date editing includes a confirmation dialog, dependency checks, stale-data checks, and one-step Undo.

The package includes a fictional 12-task project and a separate validation-errors sample. Date editing starts off. The plugin doesn't make network requests or collect telemetry.

I've tested Obsidian 1.15.1 on macOS. I'd like feedback from Windows and Linux users, users of different desktop themes, and people with larger project datasets. Please report the Obsidian and plugin versions, operating system, theme, zoom, and reproduction steps. Fictional task notes are enough for a useful report.

Please focus on label readability, arrow alignment at each zoom, Today behavior, exported page layout, save conflicts, and Undo. PDF output uses rasterized chart pages, so its chart text isn't searchable. Dependencies crossing PDF page boundaries aren't drawn. Mobile is disabled pending device testing.

This is a beta request for review, not a claim that every platform or concurrent-editing scenario has been validated.

Source and downloads: https://github.com/ExploitedBlackDuck/visual-gantt-bases
