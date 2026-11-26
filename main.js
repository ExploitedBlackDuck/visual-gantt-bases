'use strict';
// Visual Gantt for Bases by LanternSquid. MIT licensed.
const { Plugin, BasesView, Modal, Notice, TFile, getFrontMatterInfo, parseYaml } = require('obsidian');
const VIEW_TYPE = 'visual-gantt';
const DAY_MS = 86400000;
const LABEL_WIDTH = 300, DAY_WIDTH = 26, ROW_HEIGHT = 52, AXIS_HEIGHT = 76;
const ZOOM_WIDTHS = { day: 26, week: 9, month: 3.5 };
const ZOOM_ORDER = ['month', 'week', 'day'];
const MAX_TASKS = 500;
const activeWrites = new WeakSet();
function localToday(now = new Date()) {
  const date = new Date(0);
  date.setUTCFullYear(now.getFullYear(), now.getMonth(), now.getDate());
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}
// Scrolling up zooms in toward Day; scrolling down zooms out toward Month.
function wheelZoom(zoom, delta) { const i = ZOOM_ORDER.indexOf(zoom); return i < 0 || !delta ? zoom : ZOOM_ORDER[Math.min(ZOOM_ORDER.length - 1, Math.max(0, i + (delta < 0 ? 1 : -1)))]; }
function clampWidth(input) { const n = Number(input); return Number.isFinite(n) ? Math.min(520, Math.max(180, Math.round(n / 20) * 20)) : LABEL_WIDTH; }
function fieldIssue(fields) {
  const unsafe = key => !key || ['__proto__', 'constructor', 'prototype'].includes(key);
  if (unsafe(fields.start) || unsafe(fields.end) || fields.start === fields.end) return 'Choose two distinct, non-empty date property names.';
  if ([fields.depends, fields.milestone, fields.label, fields.status].some(key => key && (key === fields.start || key === fields.end))) return 'Date properties must be separate from title, status, dependency, and milestone properties.';
  return null;
}
function statusClass(status) {
  if (/^(done|complete|completed|finished)$/i.test(status.trim())) return 'vg-done';
  if (/blocked|hold/i.test(status)) return 'vg-blocked';
  if (/^(in[ -]?progress|active|started|underway)$/i.test(status.trim())) return 'vg-progress';
  return 'vg-planned';
}

function isoDate(input) {
  if (input == null) return null;
  const s = String(input).trim().replace(/^\"|\"$/g, '');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const dt = new Date(0);
  dt.setUTCFullYear(year, month - 1, day);
  dt.setUTCHours(0, 0, 0, 0);
  const ms = dt.getTime();
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return ms;
}
function utcLabel(ms) { return new Date(ms).toISOString().slice(0, 10); }
function textValue(entry, key) {
  if (!key) return '';
  const val = entry.getValue('note.' + key);
  return val == null || (typeof val.isTruthy === 'function' && !val.isTruthy()) ? '' : String(val.toString()).trim();
}
function parseDependencies(value) {
  if (value == null || (typeof value.isTruthy === 'function' && !value.isTruthy())) return [];
  // Read actual list members so commas in note names stay intact.
  if (Array.isArray(value) || (typeof value.length === 'function' && typeof value.get === 'function')) {
    const items = Array.isArray(value) ? value : Array.from({ length: value.length() }, (_, i) => value.get(i));
    return [...new Set(items.flatMap(item => {
      if (item == null || (typeof item.isTruthy === 'function' && !item.isTruthy())) return [];
      const raw = String(item == null ? '' : item.toString()).trim();
      if (!raw) return [];
      return raw.includes('[[') ? parseDependencies(raw) : [raw.replace(/^['"]|['"]$/g, '').trim()];
    }))];
  }
  const raw = String(value.toString());
  const tokens = [];
  const masked = raw.replace(/\[\[([^\]]+)\]\]/g, (_, contents) => {
    tokens.push(contents.split('|')[0].split('#')[0].trim());
    return ',';
  });
  for (const token of masked.replace(/^\[|\]$/g, '').split(',')) {
    const cleaned = token.trim().replace(/^['"]|['"]$/g, '').trim();
    if (cleaned) tokens.push(cleaned);
  }
  return [...new Set(tokens.filter(Boolean))];
}
function canonical(s) {
  return String(s).replace(/\\/g, '/').replace(/\.md$/i, '').toLowerCase().trim();
}
function resolveGraph(tasks) {
  const byPath = new Map(), byName = new Map();
  for (const task of tasks) {
    const pathKey = canonical(task.path);
    if (!byPath.has(pathKey)) byPath.set(pathKey, []);
    byPath.get(pathKey).push(task);
    const base = canonical(task.path.split('/').pop());
    if (!byName.has(base)) byName.set(base, []);
    byName.get(base).push(task);
  }
  const warnings = [], edges = [], edgeSet = new Set();
  for (const task of tasks) {
    for (const dep of task.depends) {
      const key = canonical(dep);
      const exact = byPath.get(key) || [];
      if (exact.length > 1) { warnings.push(`${task.label}: ambiguous dependency "${dep}" differs only by case.`); continue; }
      let match = exact[0];
      if (!match && !key.includes('/')) {
        const choices = byName.get(key.split('/').pop()) || [];
        if (choices.length === 1) match = choices[0];
        else if (choices.length > 1) {
          warnings.push(`${task.label}: ambiguous dependency "${dep}". Use a full vault path.`);
          continue;
        }
      }
      if (!match) { warnings.push(`${task.label}: dependency "${dep}" isn't in this Base.`); continue; }
      if (match === task) { warnings.push(`${task.label}: task depends on itself.`); continue; }
      const id = `${match.path}→${task.path}`;
      if (edgeSet.has(id)) continue;
      edgeSet.add(id);
      edges.push({ from: match, to: task });
      if (match.end >= task.start) warnings.push(`${task.label}: overlaps dependency ${match.label}. Finish predecessor before the successor starts.`);
    }
  }
  // Iterative DFS avoids overflowing the call stack on long dependency chains.
  const adjacency = new Map(tasks.map(t => [t.path, []]));
  const labels = new Map(tasks.map(t => [t.path, t.label]));
  for (const edge of edges) adjacency.get(edge.from.path).push(edge.to.path);
  const state = new Map(), cycles = new Set();
  for (const task of tasks) {
    if (state.get(task.path) === 2) continue;
    const stack = [{ path: task.path, next: 0 }];
    state.set(task.path, 1);
    while (stack.length) {
      const top = stack[stack.length - 1], children = adjacency.get(top.path);
      if (top.next >= children.length) { state.set(top.path, 2); stack.pop(); continue; }
      const next = children[top.next++];
      if (state.get(next) === 1) {
        const index = stack.findIndex(frame => frame.path === next);
        cycles.add(stack.slice(index).map(frame => labels.get(frame.path)).concat(labels.get(next)).join(' → '));
      } else if (!state.has(next)) { state.set(next, 1); stack.push({ path: next, next: 0 }); }
    }
  }
  for (const cycle of cycles) warnings.push(`Dependency cycle: ${cycle}`);
  return { edges, warnings };
}
function makeTasks(entries, fields, options = {}) {
  const tasks = [];
  const warnings = [];
  for (const entry of entries) {
    const startRaw = textValue(entry, fields.start);
    const endRaw = textValue(entry, fields.end);
    if (!startRaw && !endRaw) continue;
    const start = isoDate(startRaw);
    const end = isoDate(endRaw);
    if (start == null || end == null) {
      warnings.push(`${entry.file.basename}: invalid or missing start/end (expected YYYY-MM-DD).`);
      continue;
    }
    if (end < start) {
      warnings.push(`${entry.file.basename}: end date is before start date.`);
      continue;
    }
    const label = textValue(entry, fields.label) || entry.file.basename;
    const status = textValue(entry, fields.status);
    const depends = parseDependencies(fields.depends ? entry.getValue('note.' + fields.depends) : null);
    const milestone = /^(true|yes|1)$/i.test(textValue(entry, fields.milestone)) || start === end;
    if (milestone && start !== end) { warnings.push(`${label}: milestones must have matching start and end dates.`); continue; }
    tasks.push({ path: entry.file.path, label, status, start, end, depends, milestone });
  }
  if (!options.preserveOrder) tasks.sort((a, b) => a.start - b.start || a.label.localeCompare(b.label));
  const graph = resolveGraph(tasks);
  graph.edges.snapshot = tasks;
  return { tasks, warnings: warnings.concat(graph.warnings), edges: graph.edges };
}
// Parse only date-only property values. The chart intentionally doesn't edit timestamps.
function strictDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) || value.getUTCHours() || value.getUTCMinutes() || value.getUTCSeconds() || value.getUTCMilliseconds() ? null : value.toISOString().slice(0, 10);
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && isoDate(value) != null ? value : null;
}
function shiftRange(start, end, days) {
  if (!Number.isSafeInteger(days)) throw Error('Invalid day offset');
  const s = isoDate(start), e = isoDate(end);
  if (s == null || e == null || e < s) throw Error('Invalid task dates');
  return { start: utcLabel(s + days * DAY_MS), end: utcLabel(e + days * DAY_MS) };
}
function validateChange(task, nextStart, nextEnd, edges) {
  const start = isoDate(nextStart), end = isoDate(nextEnd);
  if (!strictDate(nextStart) || !strictDate(nextEnd) || end < start) return 'Dates must be valid YYYY-MM-DD values, with end on or after start.';
  if (task.milestone && start !== end) return 'Milestones must have matching start and end dates.';
  for (const edge of edges) {
    if (edge.to.path === task.path && edge.from.end >= start)
      return `The predecessor "${edge.from.label}" ends on or after the proposed start date.`;
    if (edge.from.path === task.path && edge.to.start <= end)
      return `The successor "${edge.to.label}" starts on or before the proposed end date.`;
  }
  return null;
}
function unchangedDates(frontmatter, fields, task) {
  const originalStart = utcLabel(task.start), originalEnd = utcLabel(task.end);
  return strictDate(frontmatter[fields.start]) === originalStart && strictDate(frontmatter[fields.end]) === originalEnd;
}
async function verifyRelatedTasks(app, task, fields, edges) {
  const related = new Map((edges.snapshot || []).filter(note => note.path !== task.path).map(note => [note.path, note]));
  for (const edge of edges) {
    if (edge.from.path === task.path) related.set(edge.to.path, edge.to);
    if (edge.to.path === task.path) related.set(edge.from.path, edge.from);
  }
  for (const neighbor of related.values()) {
    const file = app.vault.getAbstractFileByPath(neighbor.path);
    if (!(file instanceof TFile)) throw Error(`Related task "${neighbor.label}" no longer exists. Refresh the view.`);
    const info = getFrontMatterInfo(await app.vault.read(file));
    const fm = info.exists ? parseYaml(info.frontmatter) : {};
    if (!fm || !unchangedDates(fm, fields, neighbor) || !sameDependencies(fm[fields.depends], neighbor.depends || []))
      throw Error(`Related task "${neighbor.label}" changed. Refresh the view before editing.`);
  }
}
async function saveTaskDates(app, task, fields, nextStart, nextEnd, edges) {
  if (activeWrites.has(app)) throw Error('Another date edit is saving. Wait for it to finish.');
  const issue = fieldIssue(fields) || validateChange(task, nextStart, nextEnd, edges);
  if (issue) throw Error(issue);
  activeWrites.add(app);
  try {
    const file = app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile) || file.extension !== 'md') throw Error('The task note no longer exists as a Markdown file.');
    await verifyRelatedTasks(app, task, fields, edges);
    await app.fileManager.processFrontMatter(file, (fm) => {
      if (!unchangedDates(fm, fields, task)) throw Error('Task dates changed since this view loaded. Refresh and try again.');
      if (fields.depends && !sameDependencies(fm[fields.depends], task.depends || []))
        throw Error('Task dependencies changed since this view loaded. Refresh and try again.');
      const currentMilestone = /^(true|yes|1)$/i.test(String(fm[fields.milestone] || '')) || strictDate(fm[fields.start]) === strictDate(fm[fields.end]);
      if (fields.milestone && currentMilestone !== task.milestone) throw Error('Task milestone changed. Refresh and try again.');
      fm[fields.start] = nextStart;
      fm[fields.end] = nextEnd;
    });
    return { path: task.path, label: task.label, beforeStart: utcLabel(task.start), beforeEnd: utcLabel(task.end),
      afterStart: nextStart, afterEnd: nextEnd, depends: [...(task.depends || [])], milestone: task.milestone, scope: (edges.snapshot || []).map(note => note.path).sort() };
  } finally { activeWrites.delete(app); }
}
function sameDependencies(value, original) {
  return JSON.stringify(parseDependencies(value).map(canonical).sort()) === JSON.stringify(original.map(canonical).sort());
}
async function undoDateChange(app, undo, fields, edges) {
  if (!undo) throw Error('No date change to undo.');
  if (undo.fields && JSON.stringify(undo.fields) !== JSON.stringify(fields))
    throw Error('Undo belongs to a Base with different property settings. Open the original view and try again.');
  if (undo.scope && JSON.stringify(undo.scope) !== JSON.stringify((edges.snapshot || []).map(note => note.path).sort()))
    throw Error('Undo belongs to a different set of tasks. Open the original Base and filters.');
  const current = { path: undo.path, label: undo.label, start: isoDate(undo.afterStart), end: isoDate(undo.afterEnd),
    depends: undo.depends, milestone: undo.milestone };
  // The inverse write has exactly the same stale-write guard as a normal save.
  return saveTaskDates(app, current, fields, undo.beforeStart, undo.beforeEnd, edges);
}
class RescheduleModal extends Modal {
  constructor(app, task, fields, edges, nextStart, nextEnd, onSaved) {
    super(app);
    this.task = task; this.fields = fields; this.edges = edges;
    this.nextStart = nextStart; this.nextEnd = nextEnd; this.onSaved = onSaved;
  }
  onOpen() {
    const { contentEl, task } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: `Reschedule: ${task.label}` });
    contentEl.createEl('p', { text: 'Review the proposed dates. No note is changed until you confirm.' });
    const form = contentEl.createEl('form', { cls: 'vg-edit-form' });
    const startLabel = form.createEl('label', { text: 'Start date' });
    const startInput = startLabel.createEl('input', { type: 'date', attr: { 'aria-label': 'Start date' } }); startInput.value = this.nextStart;
    const endLabel = form.createEl('label', { text: 'End date' });
    const endInput = endLabel.createEl('input', { type: 'date', attr: { 'aria-label': 'End date' } }); endInput.value = this.nextEnd;
    const warning = form.createDiv({ cls: 'vg-edit-error', attr: { role: 'alert' } });
    const actions = form.createDiv({ cls: 'vg-edit-actions' });
    const cancel = actions.createEl('button', { type: 'button', text: 'Cancel' });
    const submit = actions.createEl('button', { type: 'submit', cls: 'mod-cta', text: 'Save dates' });
    cancel.addEventListener('click', () => this.close());
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      const issue = validateChange(task, startInput.value, endInput.value, this.edges);
      if (issue) { warning.setText(issue); return; }
      submit.disabled = true;
      try {
        const receipt = await saveTaskDates(this.app, task, this.fields, startInput.value, endInput.value, this.edges);
        receipt.fields = { ...this.fields };
        if (this.onSaved) this.onSaved(receipt);
        new Notice(`Updated dates for ${task.label}`);
        this.close();
      } catch (err) {
        warning.setText(err instanceof Error ? err.message : String(err));
        submit.disabled = false;
      }
    });
  }
  onClose() { this.contentEl.empty(); }
}
class UndoModal extends Modal {
  constructor(app, plugin, fields, edges) { super(app); this.plugin = plugin; this.fields = fields; this.edges = edges; }
  onOpen() {
    const receipt = this.plugin.lastChange;
    this.contentEl.empty();
    if (!receipt) { this.contentEl.createEl('p', { text: 'There is no change to undo.' }); return; }
    this.contentEl.createEl('h3', { text: 'Undo most recent date change?' });
    this.contentEl.createEl('p', { text: `${receipt.label}: restore ${receipt.beforeStart} through ${receipt.beforeEnd}.` });
    this.contentEl.createEl('p', { text: 'Undo will fail if the note dates or dependencies have changed since the edit.' });
    const warning = this.contentEl.createDiv({ cls: 'vg-edit-error', attr: { role: 'alert' } });
    const actions = this.contentEl.createDiv({ cls: 'vg-edit-actions' });
    const cancel = actions.createEl('button', { text: 'Cancel' });
    const confirm = actions.createEl('button', { text: 'Undo date change', cls: 'mod-cta' });
    cancel.addEventListener('click', () => this.close());
    confirm.addEventListener('click', async () => {
      if (confirm.disabled || this.plugin.lastChange !== receipt) return;
      confirm.disabled = true;
      try {
        await undoDateChange(this.app, receipt, this.fields, this.edges);
        this.plugin.lastChange = null;
        this.plugin.refreshViews();
        new Notice(`Restored dates for ${receipt.label}`);
        this.close();
      } catch (err) {
        warning.setText(err instanceof Error ? err.message : String(err));
        confirm.disabled = false;
      }
    });
  }
  onClose() { this.contentEl.empty(); }
}
// Geometry is shared by the chart, drag gestures, and exports.
function milestoneSize(dayWidth) { return Math.min(14, Math.max(6, dayWidth * 1.5)); }
function dependencyGeometry(edge, index, first, dayWidth, labelWidth, axisHeight = AXIS_HEIGHT, rowHeight = ROW_HEIGHT) {
  const source = edge.from, dest = edge.to;
  const sx = labelWidth + ((source.end - first) / DAY_MS + (source.milestone ? 0.5 : 1)) * dayWidth + (source.milestone ? milestoneSize(dayWidth) / 2 + 1 : -3);
  const tx = labelWidth + ((dest.start - first) / DAY_MS) * dayWidth + (dest.milestone ? dayWidth / 2 - milestoneSize(dayWidth) / 2 - 1 : 3);
  const sy = axisHeight + (index.get(source.path) + 0.5) * rowHeight;
  const ty = axisHeight + (index.get(dest.path) + 0.5) * rowHeight;
  return { sx, tx, sy, ty, bend: Math.max(sx + 6, tx - 7) };
}
function drawDependencyArrows(chart, tasks, edges, first, days, dayWidth, labelWidth, doc) {
  if (!edges.length) return;
  const ns = 'http://www.w3.org/2000/svg', svg = doc.createElementNS(ns, 'svg');
  const width = labelWidth + days * dayWidth, height = AXIS_HEIGHT + tasks.length * ROW_HEIGHT;
  svg.setAttribute('class', 'vg-dependencies');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
  svg.setAttribute('aria-hidden', 'true');
  const defs = doc.createElementNS(ns, 'defs'), marker = doc.createElementNS(ns, 'marker');
  const id = 'vg-arrow-' + Math.random().toString(36).slice(2);
  for (const [key, value] of Object.entries({ id, markerWidth: '7', markerHeight: '7', refX: '6', refY: '3', orient: 'auto' })) marker.setAttribute(key, value);
  const tip = doc.createElementNS(ns, 'path'); tip.setAttribute('d', 'M0 0 L6 3 L0 6 Z'); tip.setAttribute('fill', 'currentColor');
  marker.appendChild(tip); defs.appendChild(marker); svg.appendChild(defs);
  const index = new Map(tasks.map((task, i) => [task.path, i]));
  for (const edge of edges) {
    const g = dependencyGeometry(edge, index, first, dayWidth, labelWidth);
    const path = doc.createElementNS(ns, 'path');
    path.setAttribute('d', `M${g.sx},${g.sy} H${g.bend} V${g.ty} H${g.tx - 2}`);
    path.setAttribute('class', 'vg-dependency-path'); path.setAttribute('marker-end', `url(#${id})`);
    svg.appendChild(path);
  }
  chart.appendChild(svg);
}
function planPdfPages(model) {
  const daysPerPage = Math.max(1, Math.floor((1120 - model.labelWidth) / model.dayWidth));
  // Balance time slices and allow the two padding days to fit without a nearly blank page.
  const columns = Math.max(1, Math.ceil(Math.max(1, model.days - 2) / daysPerPage));
  const sliceDays = Math.ceil(model.days / columns);
  const pages = [];
  for (let row = 0; row < model.tasks.length; row += 10) {
    for (let day = 0; day < model.days; day += sliceDays) {
      pages.push({ row, count: Math.min(10, model.tasks.length - row), day, days: Math.min(sliceDays, model.days - day) });
      if (pages.length > 100) throw Error('This export needs over 100 pages. Narrow the Base or choose Week or Month zoom.');
    }
  }
  return pages;
}
function drawExportCanvas(doc, model, page, scale = 1.5) {
  const tasks = model.tasks.slice(page.row, page.row + page.count), first = model.first + page.day * DAY_MS;
  const width = Math.max(640, model.labelWidth + page.days * model.dayWidth), titleHeight = 112, footerHeight = 58;
  const height = titleHeight + AXIS_HEIGHT + tasks.length * ROW_HEIGHT + footerHeight;
  if (width * height * scale * scale > 16000000 || Math.max(width, height) * scale > 16384)
    throw Error('The PNG is too large. Choose Week or Month zoom, narrow the Base, or export a paginated PDF.');
  const canvas = doc.createElement('canvas'); canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext('2d'); if (!ctx) throw Error('The image renderer is unavailable.');
  ctx.scale(scale, scale); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#17212f'; ctx.font = 'bold 20px sans-serif'; ctx.fillText('Visual Gantt by LanternSquid', 16, 29);
  ctx.font = '13px sans-serif'; ctx.fillText(String(model.name).slice(0, 110), 16, 52, width - 32);
  ctx.fillStyle = '#526174'; ctx.font = '11px sans-serif';
  ctx.fillText(`${utcLabel(first)} to ${utcLabel(first + (page.days - 1) * DAY_MS)} | ${model.warnings.length} warnings | Rows ${page.row + 1}-${page.row + page.count} of ${model.tasks.length}`, 16, 73, width - 32);
  const colors = { 'vg-planned': '#64748b', 'vg-progress': '#2563eb', 'vg-done': '#15803d', 'vg-blocked': '#a34b08' };
  let lx = 16;
  for (const [key, label] of [['vg-planned', 'Planned'], ['vg-progress', 'In progress'], ['vg-done', 'Done'], ['vg-blocked', 'Blocked']]) {
    ctx.fillStyle = colors[key]; ctx.fillRect(lx, 87, 8, 8); ctx.fillStyle = '#526174'; ctx.fillText(label, lx + 13, 95); lx += ctx.measureText(label).width + 30;
  }
  ctx.fillStyle = '#7c3aed'; ctx.save(); ctx.translate(lx + 4, 91); ctx.rotate(Math.PI / 4); ctx.fillRect(-3, -3, 6, 6); ctx.restore();
  ctx.fillStyle = '#526174'; ctx.fillText('Milestone', lx + 13, 95); lx += 85;
  ctx.fillStyle = '#d32f2f'; ctx.fillRect(lx, 86, 2, 11); ctx.fillStyle = '#526174'; ctx.fillText('Today', lx + 11, 95);
  ctx.save(); ctx.translate(0, titleHeight);
  const bottom = AXIS_HEIGHT + tasks.length * ROW_HEIGHT;
  ctx.fillStyle = '#f3f5f7'; ctx.fillRect(0, 0, width, AXIS_HEIGHT);
  for (let d = 0; d < page.days; d++) {
    const date = new Date(first + d * DAY_MS), x = model.labelWidth + d * model.dayWidth;
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) { ctx.fillStyle = '#f4f5f7'; ctx.fillRect(x, 0, model.dayWidth, bottom); }
    ctx.strokeStyle = '#edf0f3'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, bottom); ctx.stroke();
    if (d === 0 || date.getUTCDate() === 1) {
      let remaining = 1;
      while (d + remaining < page.days && new Date(first + (d + remaining) * DAY_MS).getUTCMonth() === date.getUTCMonth()) remaining++;
      const monthWidth = remaining * model.dayWidth;
      if (monthWidth >= 38) {
        const label = date.toLocaleDateString('en-US', { month: 'short', ...(monthWidth >= 75 ? { year: 'numeric' } : {}), timeZone: 'UTC' });
        ctx.save(); ctx.beginPath(); ctx.rect(x, 0, monthWidth, 36); ctx.clip(); ctx.fillStyle = '#17212f'; ctx.font = 'bold 11px sans-serif'; ctx.fillText(label, x + 6, 23); ctx.restore();
      }
    }
    const tick = model.zoom === 'month' ? date.getUTCDate() === 15 : date.getUTCDay() === 1;
    if (tick) { ctx.fillStyle = '#526174'; ctx.font = '10px sans-serif'; ctx.fillText(model.zoom === 'month' ? '15' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }), x + 3, 56); }
  }
  const index = new Map(tasks.map((task, i) => [task.path, i]));
  ctx.save(); ctx.beginPath(); ctx.rect(model.labelWidth, AXIS_HEIGHT, width - model.labelWidth, bottom - AXIS_HEIGHT); ctx.clip();
  ctx.strokeStyle = '#6b7280'; ctx.fillStyle = '#6b7280'; ctx.lineWidth = 1;
  for (const edge of model.edges) {
    if (!index.has(edge.from.path) || !index.has(edge.to.path)) continue;
    const g = dependencyGeometry(edge, index, first, model.dayWidth, model.labelWidth);
    ctx.beginPath(); ctx.moveTo(g.sx, g.sy); ctx.lineTo(g.bend, g.sy); ctx.lineTo(g.bend, g.ty); ctx.lineTo(g.tx - 2, g.ty); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(g.tx - 1, g.ty); ctx.lineTo(g.tx - 6, g.ty - 3); ctx.lineTo(g.tx - 6, g.ty + 3); ctx.fill();
  }
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i], x = model.labelWidth + ((task.start - first) / DAY_MS) * model.dayWidth;
    const y = AXIS_HEIGHT + i * ROW_HEIGHT;
    ctx.fillStyle = task.milestone && statusClass(task.status) === 'vg-planned' ? '#7c3aed' : colors[statusClass(task.status)];
    if (task.milestone) {
      ctx.save(); ctx.translate(x + model.dayWidth / 2, y + ROW_HEIGHT / 2); ctx.rotate(Math.PI / 4); const size = milestoneSize(model.dayWidth) - 2; ctx.fillRect(-size / 2, -size / 2, size, size); ctx.restore();
    } else {
      const w = Math.max(2, ((task.end - task.start) / DAY_MS + 1) * model.dayWidth - 6);
      ctx.beginPath(); ctx.roundRect(x + 3, y + 13, w, 26, Math.min(4, w / 2)); ctx.fill();
      ctx.font = '10px sans-serif';
      if (w >= ctx.measureText(task.status || 'Planned').width + 14) {
        ctx.save(); ctx.beginPath(); ctx.rect(x + 7, y + 13, w - 8, 26); ctx.clip(); ctx.fillStyle = '#ffffff'; ctx.font = '10px sans-serif'; ctx.fillText(task.status || 'Planned', x + 8, y + 30); ctx.restore();
      }
    }
  }
  if (model.showToday && model.today >= first && model.today < first + page.days * DAY_MS) {
    const x = model.labelWidth + (model.today - first) / DAY_MS * model.dayWidth + model.dayWidth / 2;
    ctx.strokeStyle = '#d32f2f'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, AXIS_HEIGHT); ctx.lineTo(x, bottom); ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = '#f3f5f7'; ctx.fillRect(0, 0, model.labelWidth, AXIS_HEIGHT);
  ctx.fillStyle = '#17212f'; ctx.font = 'bold 12px sans-serif'; ctx.fillText('Task', 14, 43);
  for (let i = 0; i < tasks.length; i++) {
    const y = AXIS_HEIGHT + i * ROW_HEIGHT;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, y, model.labelWidth, ROW_HEIGHT);
    ctx.fillStyle = '#17212f'; ctx.font = '12px sans-serif';
    const words = tasks[i].label.split(/\s+/); let line = '', lines = [];
    for (const word of words) { const next = line ? line + ' ' + word : word; if (ctx.measureText(next).width > model.labelWidth - 28 && line) { lines.push(line); line = word; } else line = next; }
    lines.push(line);
    if (lines.length > 2) lines = [lines[0], lines.slice(1).join(' ')];
    for (let j = 0; j < lines.length; j++) ctx.fillText(lines[j], 14, y + (lines.length === 1 ? 30 : 22 + j * 16), model.labelWidth - 28);
  }
  ctx.strokeStyle = '#dfe3e8'; ctx.lineWidth = 0.6;
  for (let i = 0; i <= tasks.length; i++) { const y = AXIS_HEIGHT + i * ROW_HEIGHT; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(model.labelWidth, 0); ctx.lineTo(model.labelWidth, bottom); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#526174'; ctx.font = '10px sans-serif';
  ctx.fillText('Calendar days, inclusive. Dependencies crossing pages are not drawn.', 14, height - 31, width - 28);
  ctx.fillText(`by LanternSquid | Page ${page.number || 1} of ${page.total || 1}`, 14, height - 14, width - 28);
  return canvas;
}
function bytesFromDataUrl(url) {
  const raw = atob(url.slice(url.indexOf(',') + 1));
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}
function makeRasterPdf(images) {
  // A small standards-based PDF writer. Chart pages are embedded JPEG images.
  const encode = text => new TextEncoder().encode(text), chunks = [], offsets = [0]; let size = 0;
  const append = bytes => { const data = typeof bytes === 'string' ? encode(bytes) : bytes; chunks.push(data); size += data.length; };
  const object = (id, body, stream) => {
    offsets[id] = size; append(`${id} 0 obj\n${body}`);
    if (stream) { append('\nstream\n'); append(stream); append('\nendstream'); }
    append('\nendobj\n');
  };
  append('%PDF-1.4\n%LanternSquid\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Count ${images.length} /Kids [${images.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);
  images.forEach((image, i) => {
    const id = 3 + i * 3, factor = Math.min(794 / image.width, 547 / image.height);
    const w = image.width * factor, h = image.height * factor;
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
    object(id + 1, `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>`, image.bytes);
    const commands = encode(`q\n${w.toFixed(3)} 0 0 ${h.toFixed(3)} ${((842 - w) / 2).toFixed(3)} ${(595 - 24 - h).toFixed(3)} cm\n/Im0 Do\nQ`);
    object(id + 2, `<< /Length ${commands.length} >>`, commands);
  });
  const infoId = 3 + images.length * 3;
  object(infoId, '<< /Title (Visual Gantt by LanternSquid) /Author (LanternSquid) /Producer (Visual Gantt for Bases) >>');
  const xref = size; append(`xref\n0 ${infoId + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= infoId; id++) append(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  append(`trailer\n<< /Size ${infoId + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return bytes.buffer;
}
async function saveExport(app, model, format, doc, onProgress = () => {}) {
  let data;
  if (format === 'png') {
    const canvas = drawExportCanvas(doc, model, { row: 0, count: model.tasks.length, day: 0, days: model.days }, 1.5);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error('The PNG could not be generated.')), 'image/png'));
    data = await blob.arrayBuffer(); canvas.width = canvas.height = 0;
  } else {
    const pages = planPdfPages(model), images = [];
    for (let i = 0; i < pages.length; i++) {
      onProgress(i + 1, pages.length);
      await new Promise(resolve => globalThis.setTimeout(resolve, 0));
      const canvas = drawExportCanvas(doc, model, { ...pages[i], number: i + 1, total: pages.length });
      images.push({ width: canvas.width, height: canvas.height, bytes: bytesFromDataUrl(canvas.toDataURL('image/jpeg', 0.92)) });
      canvas.width = canvas.height = 0;
    }
    data = makeRasterPdf(images);
  }
  const folder = 'Visual Gantt Exports';
  if (!app.vault.getAbstractFileByPath(folder)) {
    try { await app.vault.createFolder(folder); } catch (error) { if (!app.vault.getAbstractFileByPath(folder)) throw error; }
  }
  const name = String(model.name || 'Project').replace(/[^a-zA-Z0-9 _-]/g, '-').slice(0, 70).trim() || 'Project';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return app.vault.createBinary(`${folder}/${name}-by-LanternSquid-${timestamp}.${format}`, data);
}
class GanttView extends BasesView {
  constructor(controller, parentEl, plugin) {
    super(controller); this.plugin = plugin; this.type = VIEW_TYPE;
    this.root = parentEl.createDiv({ cls: 'vg-root', attr: { 'aria-label': 'Visual Gantt by LanternSquid' } });
    this.doc = this.root.ownerDocument || document;
    this.includeToday = false; this.exporting = false;
    plugin.views.add(this);
  }
  updateExportStatus() {
    if (!this.exportStatusEl) return;
    this.exportStatusEl.empty();
    if (this.exportMessage) this.exportStatusEl.createSpan({ text: this.exportMessage });
    if (this.exportFile) {
      const file = this.exportFile;
      const open = this.exportStatusEl.createEl('button', { text: 'Open export', cls: 'vg-open-export' });
      open.addEventListener('click', () => { void this.app.workspace.getLeaf('tab').openFile(file); });
    }
    for (const button of this.exportButtons || []) button.disabled = this.exporting;
  }
  onClose() { this.plugin.views.delete(this); this.root.empty(); }
  onunload() { this.onClose(); this.root.remove(); }
  onDataUpdated() {
    const focused = this.doc.activeElement;
    const focusLabel = focused && this.root.contains(focused) ? focused.getAttribute('aria-label') : null;
    const old = this.scrollEl ? { left: this.scrollEl.scrollLeft, top: this.scrollEl.scrollTop, first: this.model?.first, dayWidth: this.model?.dayWidth } : null;
    this.root.empty(); this.scrollEl = null;
    const fields = Object.fromEntries([['start', 'start'], ['end', 'end'], ['label', 'title'], ['status', 'status'], ['depends', 'depends_on'], ['milestone', 'milestone']].map(([field, fallback]) => [field, String(this.config.get(field === 'label' ? 'labelProperty' : field + 'Property') || fallback).trim()]));
    const entries = this.data?.data || [];
    const header = this.root.createDiv({ cls: 'vg-header' });
    const identity = header.createDiv({ cls: 'vg-identity' });
    identity.createEl('h3', { text: 'Visual Gantt' }); identity.createSpan({ cls: 'vg-brand', text: 'by LanternSquid' });
    if (entries.length > MAX_TASKS) {
      this.model = null;
      this.root.createDiv({ cls: 'vg-empty', text: `This Base includes ${entries.length} notes. Narrow its filters to ${MAX_TASKS} or fewer notes to keep the chart responsive.` });
      return;
    }
    const { tasks, edges, warnings } = makeTasks(entries, fields, { preserveOrder: Boolean(this.config.getSort?.().length) });
    const issue = fieldIssue(fields);
    if (issue) warnings.unshift(issue);
    const enableEditing = this.config.get('enableEditing') === true && !issue;
    const zoom = Object.hasOwn(ZOOM_WIDTHS, this.config.get('zoom')) ? this.config.get('zoom') : 'day';
    const dayWidth = ZOOM_WIDTHS[zoom], labelWidth = clampWidth(this.config.get('labelWidth') ?? LABEL_WIDTH);
    header.createSpan({ cls: 'vg-count', text: `${tasks.length} tasks · ${edges.length} dependencies` });
    if (enableEditing && this.plugin.lastChange && JSON.stringify(this.plugin.lastChange.fields) === JSON.stringify(fields)) {
      const undo = header.createEl('button', { text: 'Undo last date edit', cls: 'vg-undo' });
      undo.addEventListener('click', () => new UndoModal(this.app, this.plugin, fields, edges).open());
    }
    const toolbar = this.root.createDiv({ cls: 'vg-toolbar', attr: { role: 'group', 'aria-label': 'Timeline controls' } });
    const zoomLabel = toolbar.createEl('label', { cls: 'vg-control', text: 'Zoom' });
    const zoomSelect = zoomLabel.createEl('select', { attr: { 'aria-label': 'Timeline zoom' } });
    for (const [value, text] of [['day', 'Day'], ['week', 'Week'], ['month', 'Month']]) zoomSelect.createEl('option', { text, value });
    zoomSelect.value = zoom;
    zoomSelect.addEventListener('change', () => { this.config.set('zoom', zoomSelect.value); this.onDataUpdated(); });
    const widthLabel = toolbar.createEl('label', { cls: 'vg-control vg-width-control', text: 'Task width' });
    const widthInput = widthLabel.createEl('input', { type: 'range', attr: { min: '180', max: '520', step: '20', 'aria-label': 'Task column width', 'aria-valuetext': labelWidth + ' pixels' } });
    widthInput.value = String(labelWidth);
    const widthValue = widthLabel.createEl('output', { text: labelWidth + ' px' });
    widthInput.addEventListener('input', () => { widthValue.setText(widthInput.value + ' px'); widthInput.setAttribute('aria-valuetext', widthInput.value + ' pixels'); });
    widthInput.addEventListener('change', () => { this.config.set('labelWidth', clampWidth(widthInput.value)); this.onDataUpdated(); });
    const todayButton = toolbar.createEl('button', { text: 'Today', attr: { title: 'Show and jump to today' } });
    todayButton.addEventListener('click', () => {
      if (!this.model) return;
      const today = localToday();
      if (Math.max(this.model.max, today) - Math.min(this.model.min, today) > 729 * DAY_MS) { new Notice('Today is more than two years from this project. Narrow the date range first.'); return; }
      this.includeToday = true; this.jumpToday = true; this.onDataUpdated();
    });
    const projectButton = toolbar.createEl('button', { text: 'Project', attr: { title: 'Return to the scheduled project range' } });
    projectButton.addEventListener('click', () => { this.includeToday = false; this.jumpStart = true; this.onDataUpdated(); });
    const exportGroup = toolbar.createDiv({ cls: 'vg-export-controls', attr: { role: 'group', 'aria-label': 'Export timeline' } });
    this.exportStatusEl = this.root.createDiv({ cls: 'vg-export-status', attr: { role: 'status', 'aria-live': 'polite' } });
    this.exportButtons = [];
    for (const format of ['png', 'pdf']) {
      const button = exportGroup.createEl('button', { text: format.toUpperCase(), attr: { title: format === 'png' ? 'Export the full timeline as PNG' : 'Export a paginated landscape PDF' } });
      this.exportButtons.push(button);
      button.addEventListener('click', async () => {
        if (this.exporting || !this.model) return;
        this.exporting = true; this.exportFile = null; this.exportMessage = `Exporting ${format.toUpperCase()}…`; this.updateExportStatus();
        try {
          const file = await saveExport(this.app, this.model, format, this.doc, (page, total) => { this.exportMessage = `Exporting PDF page ${page} of ${total}…`; this.updateExportStatus(); });
          this.exportFile = file; this.exportMessage = `Saved ${file.path}`;
          new Notice(`Saved ${format.toUpperCase()} in Visual Gantt Exports`);
        } catch (error) { this.exportMessage = error instanceof Error ? error.message : String(error); }
        finally { this.exporting = false; this.updateExportStatus(); }
      });
    }
    this.updateExportStatus();
    const legend = this.root.createDiv({ cls: 'vg-legend', attr: { 'aria-label': 'Chart legend' } });
    for (const [cls, name] of [['vg-planned', 'Planned'], ['vg-progress', 'In progress'], ['vg-done', 'Done'], ['vg-blocked', 'Blocked'], ['vg-legend-milestone', 'Milestone'], ['vg-legend-today', 'Today']]) {
      const item = legend.createSpan({ cls: 'vg-legend-item' });
      item.createSpan({ cls: 'vg-swatch ' + cls, attr: { 'aria-hidden': 'true' } }); item.createSpan({ text: name });
    }
    legend.createSpan({ cls: 'vg-edit-state', text: enableEditing ? 'Date editing on' : 'Read only' });
    if (warnings.length) {
      const details = this.root.createEl('details', { cls: 'vg-warnings' });
      details.createEl('summary', { text: `${warnings.length} task warning(s)` });
      const list = details.createEl('ul'); warnings.slice(0, 40).forEach(text => list.createEl('li', { text }));
      if (warnings.length > 40) list.createEl('li', { text: 'Additional warnings omitted. Narrow the Base to inspect them.' });
    }
    if (!tasks.length) {
      this.model = null;
      this.root.createDiv({ cls: 'vg-empty', text: 'No scheduled notes found. Add date-only start and end properties in YYYY-MM-DD format to notes included by this Base.' });
      for (const button of toolbar.querySelectorAll('button')) button.disabled = true;
      return;
    }
    const min = Math.min(...tasks.map(task => task.start)), max = Math.max(...tasks.map(task => task.end)), today = localToday();
    const first = Math.min(min, this.includeToday ? today : min) - DAY_MS;
    const last = Math.max(max, this.includeToday ? today : max) + DAY_MS;
    const days = Math.round((last - first) / DAY_MS) + 1;
    if (days > 732) { this.model = null; this.root.createDiv({ cls: 'vg-empty', text: 'Timeline exceeds two years. Narrow the Base filters or task date range.' }); return; }
    this.model = { name: this.config.name || 'Project timeline', tasks, edges, warnings, min, max, first, days, dayWidth, labelWidth, zoom, today, showToday: this.config.get('showToday') !== false || this.includeToday };
    const scroll = this.root.createDiv({ cls: 'vg-scroll', attr: { tabindex: '0', role: 'region', 'aria-label': 'Project timeline. Scroll to see more dates and tasks.' } });
    this.scrollEl = scroll;
    const dense = tasks.length * days > 30000 && zoom !== 'month';
    const chart = scroll.createDiv({ cls: dense ? 'vg-chart vg-large' : 'vg-chart' });
    chart.style.setProperty('--vg-week-offset', -((new Date(first).getUTCDay() + 6) % 7) * dayWidth + 'px');
    for (const [key, value] of Object.entries({ days, 'label-width': labelWidth + 'px', 'day-width': dayWidth + 'px', 'row-height': ROW_HEIGHT + 'px', 'axis-height': AXIS_HEIGHT + 'px' })) chart.style.setProperty('--vg-' + key, String(value));
    chart.style.setProperty('--vg-milestone-size', milestoneSize(dayWidth) + 'px');
    chart.style.setProperty('--vg-grid-size', dayWidth * (zoom === 'month' ? 7 : 1) + 'px');
    const axis = chart.createDiv({ cls: 'vg-row vg-axis' }); axis.createDiv({ cls: 'vg-label', text: 'Task' });
    const axisDates = axis.createDiv({ cls: 'vg-track vg-axis-dates' }), monthLabels = [];
    for (let d = 0; d < days; d++) {
      const date = new Date(first + d * DAY_MS);
      if (d === 0 || date.getUTCDate() === 1) {
        let remaining = 1;
        while (d + remaining < days && new Date(first + (d + remaining) * DAY_MS).getUTCMonth() === date.getUTCMonth()) remaining++;
        const width = remaining * dayWidth;
        if (width >= 38) {
          const month = axisDates.createDiv({ cls: 'vg-month' });
          const el = month.createSpan({ cls: 'vg-month-label', text: date.toLocaleDateString('en-US', { month: width >= 110 ? 'long' : 'short', ...(width >= 75 ? { year: 'numeric' } : {}), timeZone: 'UTC' }) });
          month.style.left = d * dayWidth + 'px'; month.style.width = width + 'px'; monthLabels.push({ el, offset: d * dayWidth, width });
        }
      }
      if ((zoom === 'month' && date.getUTCDate() === 15) || (zoom !== 'month' && date.getUTCDay() === 1)) {
        const tick = axisDates.createDiv({ cls: 'vg-tick', text: zoom === 'month' ? '15' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) });
        tick.style.left = d * dayWidth + 'px';
      }
    }
    const weekends = [];
    for (let d = 0; d < days; d++) { const weekday = new Date(first + d * DAY_MS).getUTCDay(); if (weekday === 0 || weekday === 6) weekends.push(d); }
    const shadeWeekends = track => {
      // A two-year chart at month zoom avoids creating thousands of shading nodes.
      if (zoom === 'month' || dense) return;
      for (const d of weekends) { const shade = track.createDiv({ cls: 'vg-weekend', attr: { 'aria-hidden': 'true' } }); shade.style.left = d * dayWidth + 'px'; }
    };
    shadeWeekends(axisDates);
    for (const task of tasks) {
      const row = chart.createDiv({ cls: 'vg-row' });
      const label = row.createEl('button', { cls: 'vg-label vg-task-link', text: task.label });
      label.setAttribute('title', `${task.label}\n${task.path}`);
      label.addEventListener('click', () => { void this.app.workspace.openLinkText(task.path, '', false); });
      const track = row.createDiv({ cls: 'vg-track' }); shadeWeekends(track);
      const bar = track.createDiv({ cls: task.milestone ? 'vg-milestone' : 'vg-bar' });
      bar.style.left = ((task.start - first) / DAY_MS * dayWidth + (task.milestone ? dayWidth / 2 : 3)) + 'px';
      const barWidth = Math.max(2, ((task.end - task.start) / DAY_MS + 1) * dayWidth - 6);
      if (!task.milestone) bar.style.width = barWidth + 'px';
      bar.setAttribute('title', `${task.label}\n${utcLabel(task.start)} to ${utcLabel(task.end)}${task.status ? '\n' + task.status : ''}`);
      bar.addClass(statusClass(task.status));
      const barText = task.status || `${(task.end - task.start) / DAY_MS + 1}d`;
      if (!task.milestone && barWidth >= barText.length * 6 + 14) bar.createSpan({ text: barText });
      if (enableEditing) {
        bar.addClass('vg-editable'); bar.setAttribute('role', 'button'); bar.setAttribute('tabindex', '0');
        const openEdit = (dayOffset = 0) => {
          if (this.plugin.views.has(this) && !this.exporting) {
            const range = shiftRange(utcLabel(task.start), utcLabel(task.end), dayOffset);
            new RescheduleModal(this.app, task, fields, edges, range.start, range.end, receipt => { receipt.fields = { ...fields }; this.plugin.lastChange = receipt; this.plugin.refreshViews(); }).open();
          }
        };
        bar.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openEdit(); } });
        bar.addEventListener('pointerdown', event => {
          // Touch scrolls normally. Touch users can tap, or use the keyboard editor.
          if (event.button !== 0 || !event.isPrimary || (event.pointerType && event.pointerType !== 'mouse')) return;
          event.preventDefault(); const startingX = event.clientX; let offset = 0;
          bar.setPointerCapture(event.pointerId);
          const move = e => { offset = Math.round((e.clientX - startingX) / dayWidth); bar.style.translate = offset * dayWidth + 'px 0'; };
          const cleanup = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', finish); bar.removeEventListener('pointercancel', cancel); bar.style.translate = ''; };
          const finish = e => { offset = Math.round((e.clientX - startingX) / dayWidth); cleanup(); openEdit(offset); };
          const cancel = () => cleanup();
          bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', finish); bar.addEventListener('pointercancel', cancel);
        });
        bar.addEventListener('click', event => { if (event.pointerType === 'touch' || event.pointerType === 'pen') openEdit(); });
      }
      bar.setAttribute('aria-label', `${task.label}: ${task.milestone ? 'milestone on ' : ''}${utcLabel(task.start)}${task.milestone ? '' : ' through ' + utcLabel(task.end)}${task.status ? ', ' + task.status : ''}`);
    }
    drawDependencyArrows(chart, tasks, edges, first, days, dayWidth, labelWidth, this.doc);
    if (this.model.showToday && today >= first && today <= last) {
      const x = (today - first) / DAY_MS * dayWidth + dayWidth / 2;
      const marker = chart.createDiv({ cls: 'vg-today-line', attr: { 'aria-hidden': 'true' } });
      marker.style.left = labelWidth + x + 'px'; marker.style.top = AXIS_HEIGHT + 'px';
      const todayLabel = axisDates.createDiv({ cls: 'vg-today-label', text: 'Today', attr: { title: utcLabel(today) } }); todayLabel.style.left = Math.max(18, Math.min(days * dayWidth - 18, x)) + 'px';
    }
    const pinMonthLabels = () => {
      for (const month of monthLabels) month.el.style.transform = `translateX(${Math.min(Math.max(0, scroll.scrollLeft - month.offset), Math.max(0, month.width - month.el.offsetWidth))}px)`;
    };
    scroll.addEventListener('scroll', pinMonthLabels, { passive: true });
    if (old?.first != null) { scroll.scrollLeft = Math.max(0, ((old.first - first) / DAY_MS + old.left / old.dayWidth) * dayWidth); scroll.scrollTop = old.top; }
    if (this.jumpToday) { scroll.scrollLeft = Math.max(0, (today - first) / DAY_MS * dayWidth - (scroll.clientWidth - labelWidth) / 2); this.jumpToday = false; }
    if (this.jumpStart) { scroll.scrollLeft = 0; scroll.scrollTop = 0; this.jumpStart = false; }
    // Keep the date under the pointer in place after a Shift + wheel zoom.
    if (this.zoomAnchor) { scroll.scrollLeft = Math.max(0, (this.zoomAnchor.date - first) / DAY_MS * dayWidth - this.zoomAnchor.offset); this.zoomAnchor = null; }
    if (this.config.get('shiftWheelZoom') === true) scroll.addEventListener('wheel', e => {
      if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      const next = wheelZoom(zoom, e.deltaY || e.deltaX), now = Date.now();
      // Trackpads send many wheel events per gesture; step one zoom level at a time.
      if (next === zoom || now - (this.lastWheelZoom || 0) < 250) return;
      this.lastWheelZoom = now;
      const view = scroll.clientWidth - labelWidth, pointer = e.clientX - scroll.getBoundingClientRect().left - labelWidth;
      const offset = pointer >= 0 && pointer <= view ? pointer : view / 2;
      this.zoomAnchor = { date: first + (scroll.scrollLeft + offset) / dayWidth * DAY_MS, offset };
      this.config.set('zoom', next); this.onDataUpdated();
    }, { passive: false });
    pinMonthLabels();
    if (focusLabel === 'Timeline zoom') zoomSelect.focus();
    else if (focusLabel === 'Task column width') widthInput.focus();
    this.root.createDiv({ cls: 'vg-footer', text: `${utcLabel(min)} to ${utcLabel(max)} · Calendar days, inclusive · ${enableEditing ? 'Click or drag a bar to propose dates. Save confirms the change.' : 'Click a task name to open its note. Date editing is off.'}` });
  }
}
class VisualGanttPlugin extends Plugin {
  onload() {
    this.lastChange = null; this.views = new Set(); this.today = localToday();
    if (typeof this.registerBasesView !== 'function') { new Notice('Visual Gantt requires a current Obsidian version with Bases support.'); return; }
    this.registerBasesView(VIEW_TYPE, {
      name: 'Visual Gantt', icon: 'calendar-range', factory: (controller, containerEl) => new GanttView(controller, containerEl, this),
      options: () => [
        { type: 'dropdown', displayName: 'Timeline zoom', key: 'zoom', default: 'day', options: { day: 'Day', week: 'Week', month: 'Month' } },
        { type: 'toggle', displayName: 'Shift + scroll to zoom', key: 'shiftWheelZoom', default: false },
        { type: 'slider', displayName: 'Task column width', key: 'labelWidth', default: LABEL_WIDTH, min: 180, max: 520, step: 20 },
        { type: 'toggle', displayName: 'Show today marker', key: 'showToday', default: true },
        { type: 'toggle', displayName: 'Enable date editing (experimental)', key: 'enableEditing', default: false },
        { type: 'text', displayName: 'Start property', key: 'startProperty', default: 'start' },
        { type: 'text', displayName: 'End property', key: 'endProperty', default: 'end' },
        { type: 'text', displayName: 'Task title property', key: 'labelProperty', default: 'title' },
        { type: 'text', displayName: 'Status property', key: 'statusProperty', default: 'status' },
        { type: 'text', displayName: 'Dependency property', key: 'dependsProperty', default: 'depends_on' },
        { type: 'text', displayName: 'Milestone property', key: 'milestoneProperty', default: 'milestone' }
      ]
    });
    this.registerInterval(globalThis.setInterval(() => { const today = localToday(); if (today !== this.today) { this.today = today; this.refreshViews(); } }, 60000));
  }
  refreshViews() { for (const view of this.views) view.onDataUpdated(); }
  onunload() { this.lastChange = null; for (const view of this.views) view.root.empty(); this.views.clear(); }
}
module.exports = VisualGanttPlugin;
module.exports._test = { isoDate, parseDependencies, resolveGraph, makeTasks, strictDate, shiftRange, validateChange, unchangedDates, saveTaskDates, undoDateChange, sameDependencies, statusClass, localToday, clampWidth, wheelZoom, fieldIssue, verifyRelatedTasks, dependencyGeometry, planPdfPages, makeRasterPdf, drawExportCanvas, saveExport };
