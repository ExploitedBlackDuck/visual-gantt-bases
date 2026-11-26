// Regression tests by LanternSquid.
'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const load = Module._load;
class TFile { constructor(path) { this.path = path; this.extension = 'md'; } }
Module._load = function (name, ...args) {
  if (name === 'obsidian') return { Plugin: class {}, BasesView: class {}, Modal: class {}, Notice: class {}, TFile,
    getFrontMatterInfo: text => ({ exists: true, frontmatter: text }), parseYaml: JSON.parse };
  return load.call(this, name, ...args);
};
const t = require('../main.js')._test; Module._load = load;
const fields = { start: 'start', end: 'end', label: 'title', status: 'status', depends: 'depends_on', milestone: 'milestone' };
const task = (path, start, end, depends = []) => ({ path, label: path, start: t.isoDate(start), end: t.isoDate(end), depends, milestone: start === end });
const a = task('A.md', '2026-12-01', '2026-12-02');
const b = task('B.md', '2026-12-04', '2026-12-05', ['A']);
function fixture() {
  const data = { 'A.md': { start: '2026-12-01', end: '2026-12-02' }, 'B.md': { start: '2026-12-04', end: '2026-12-05', depends_on: ['[[A]]'], keep: 'unchanged' } };
  const files = new Map(Object.keys(data).map(path => [path, new TFile(path)]));
  const app = { vault: { getAbstractFileByPath: path => files.get(path), read: async file => JSON.stringify(data[file.path]) }, fileManager: { processFrontMatter: async (file, fn) => fn(data[file.path]) } };
  const edges = [{ from: a, to: b }]; edges.snapshot = [a, b];
  return { data, files, app, edges };
}
(async () => {
  assert.equal(t.isoDate('2026-12-01T12:00:00'), null);
  assert.equal(t.isoDate('0099-01-01'), -59042995200000);
  assert.equal(t.strictDate(new Date('2026-12-01T12:00:00Z')), null);
  assert.deepEqual(t.parseDependencies(['[[Sales, Inc]]', 'Plain, comma']), ['Sales, Inc', 'Plain, comma']);
  const list = { isTruthy: () => true, length: () => 2, get: i => ({ toString: () => ['[[Sales, Inc]]', '[[B]]'][i] }) };
  assert.deepEqual(t.parseDependencies(list), ['Sales, Inc', 'B']);
  assert.deepEqual(t.parseDependencies([null, {isTruthy:()=>false,toString:()=> 'null'}]), []);
  const graph = t.resolveGraph([a, { ...b, depends: ['Wrong/A'] }]);
  assert.equal(graph.edges.length, 0); assert.match(graph.warnings[0], /isn't in this Base/);
  const ambiguous = t.resolveGraph([a, {...a,path:'a.md'},b]);
  assert.ok(ambiguous.warnings.some(warning => warning.includes('ambiguous')));
  const chain = Array.from({ length: 5000 }, (_, i) => task(`T${i}.md`, '2026-01-01', '2026-01-02', i ? [`T${i - 1}`] : []));
  assert.equal(t.resolveGraph(chain).edges.length, 4999);
  assert.ok(t.fieldIssue({ ...fields, start: 'end' }));
  assert.ok(t.fieldIssue({ ...fields, start: '__proto__' }));
  assert.ok(t.fieldIssue({ ...fields, end: 'depends_on' }));
  assert.equal(t.fieldIssue(fields), null);
  let f = fixture();
  const receipt = await t.saveTaskDates(f.app, b, fields, '2026-12-05', '2026-12-06', f.edges);
  assert.equal(f.data['B.md'].start, '2026-12-05'); assert.equal(f.data['B.md'].keep, 'unchanged');
  await t.undoDateChange(f.app, receipt, fields, f.edges);
  assert.equal(f.data['B.md'].start, '2026-12-04');
  f = fixture(); f.data['A.md'].end = '2026-12-03';
  await assert.rejects(t.saveTaskDates(f.app, b, fields, '2026-12-05', '2026-12-06', f.edges), /Related task.*changed/);
  assert.equal(f.data['B.md'].start, '2026-12-04');
  f = fixture(); f.data['A.md'].depends_on = ['[[B]]'];
  await assert.rejects(t.saveTaskDates(f.app, b, fields, '2026-12-05', '2026-12-06', f.edges), /Related task.*changed/);
  f = fixture(); f.data['B.md'].milestone = true;
  await assert.rejects(t.saveTaskDates(f.app, b, fields, '2026-12-05', '2026-12-06', f.edges), /milestone changed/);
  f = fixture(); f.files.delete('A.md');
  await assert.rejects(t.saveTaskDates(f.app, b, fields, '2026-12-05', '2026-12-06', f.edges), /no longer exists/);
  f = fixture();
  let releaseRead; const gate = new Promise(resolve => { releaseRead = resolve; });
  f.app.vault.read = async file => { await gate; return JSON.stringify(f.data[file.path]); };
  const firstSave = t.saveTaskDates(f.app, b, fields, '2026-12-05', '2026-12-06', f.edges);
  await assert.rejects(t.saveTaskDates(f.app, b, fields, '2026-12-06', '2026-12-07', f.edges), /Another date edit/);
  releaseRead(); await firstSave;
  await assert.rejects(t.undoDateChange(f.app, receipt, fields, []), /different set of tasks/);
  const originalTask = { ...b, start: t.isoDate('2026-12-05'), end: t.isoDate('2026-12-06') };
  f.app.fileManager.processFrontMatter = async () => { throw Error('disk failure'); };
  await assert.rejects(t.saveTaskDates(f.app, originalTask, fields, '2026-12-06', '2026-12-07', []), /disk failure/);
  // A failed save must release the per-vault lock.
  f.app.fileManager.processFrontMatter = async (file, fn) => fn(f.data[file.path]);
  await t.saveTaskDates(f.app, originalTask, fields, '2026-12-06', '2026-12-07', []);
  const model = { tasks: Array(21).fill(a), days: 60, labelWidth: 300, dayWidth: 26 };
  const pages = t.planPdfPages(model);
  assert.equal(pages.length, 6); assert.equal(pages[0].days, 30); assert.equal(pages.at(-1).count, 1);
  assert.equal(t.planPdfPages({ ...model, tasks: Array(12).fill(a), days: 31, labelWidth: 320 }).length, 2, 'padding must not create almost-empty pages');
  assert.throws(() => t.planPdfPages({ ...model, tasks: Array(500).fill(a), days: 730 }), /100 pages/);
  assert.deepEqual(t.ZOOM_ORDER, ['month', 'week', 'day']);
  assert.equal(t.wheelZoom('month', -100), 'week'); assert.equal(t.wheelZoom('week', -1), 'day'); assert.equal(t.wheelZoom('day', -1), 'day');
  assert.equal(t.wheelZoom('day', 100), 'week'); assert.equal(t.wheelZoom('month', 1), 'month'); assert.equal(t.wheelZoom('week', 0), 'week'); assert.equal(t.wheelZoom('bad', 1), 'bad');
  assert.equal(t.clampWidth(10000), 520); assert.equal(t.clampWidth(0), 180); assert.equal(t.clampWidth('bad'), 300);
  const now = new Date(2026, 10, 22, 23, 59); assert.equal(t.localToday(now), t.isoDate('2026-11-22'));
  console.log('Reliability, concurrency, list, date, graph, and PDF pagination tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
