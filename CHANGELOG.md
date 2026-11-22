# Changelog
by LanternSquid

## 0.7.0

Added persistent Day, Week, and Month zoom; adjustable task-column width; a local-date Today marker and jump control; Project range reset; full PNG exports; and paginated landscape PDF exports with repeated headings and labels. Export status survives Base refreshes, and PDF pagination avoids almost-empty padding pages.

Strengthened date saves with checks across the rendered valid task set, per-vault write serialization, milestone-change checks, and scoped Undo. Preserved commas in actual dependency list members, rejected ambiguous case-only paths, stopped resolving missing explicit paths by unrelated basenames, validated distinct property mappings, and rejected timestamps and inconsistent milestone dates. Added iterative cycle detection, bounded chart sizes, efficient long-range shading, compact-zoom markers, and Base sort-order support.

Added the MIT license, security and privacy documentation, a contributor guide, a reviewer test plan, a release guide, a community review draft, and a prepared CI matrix. Raised the minimum app version to the tested Obsidian 1.15.1 and disabled mobile installation pending device testing.

## 0.6.0

Polished labels, status colors, dependency endpoints, date headings, scrolling, and keyboard focus. Added LanternSquid branding. Fixed absent Bases values and milestone drag rotation. Verified the sample in Obsidian 1.15.1 on macOS.
