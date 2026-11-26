 'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module._load;

class Element {
  constructor(tag = 'div') {
    this.scrollLeft = 0; this.scrollTop = 0; this.clientWidth = 1000; this.offsetWidth = 80; this.tag = tag; this.children = []; this.events = {}; this.attributes = {};
    this.style = { setProperty: (key, val) => { this.style[key] = val; } };
    this.classes = [];
  }
  createDiv(options = {}) { return this.add('div', options); }
  createEl(tag, options = {}) { return this.add(tag, options); }
  createSpan(options = {}) { return this.add('span', options); }
  add(tag, options) {
    const child = new Element(tag);
    if (typeof options === 'string') options = { cls: options };
    child.attributes = { ...(options.attr || {}) };
    child.value = options.value || '';
    child.text = options.text || '';
    child.classes = (options.cls || '').split(' ').filter(Boolean);
    this.children.push(child);
    return child;
  }
  empty() { this.children = []; }
  appendChild(child) { this.children.push(child); }
  addClass(name) { this.classes.push(name); }
  removeClass(name) { this.classes = this.classes.filter(item => item !== name); }
  setAttribute(name, value) { this.attributes[name] = value; if (name === "class") this.classes = String(value).split(/\s+/); }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(name, cb) { this.events[name] = cb; }
  removeEventListener(name, cb) { if (this.events[name] === cb) delete this.events[name]; }
  setPointerCapture() {}
  get ownerDocument() { return global.document; }
  querySelectorAll() { return []; }
  remove() {}
  setText(text) { this.text = text; }
  createNode(tag) { return this.add(tag); }
}
class Plugin {
  constructor() { this.app = { workspace: { openLinkText: () => {} } }; }
  registerInterval(id) { clearInterval(id); }
  registerBasesView(id, definition) { this.registration = { id, definition }; /* documented API need not return a boolean */ }
}
class BasesView { constructor(controller) { this.app = controller.app; this.config = controller.config; this.data = controller.data; } }
let openedModal;
class Modal { open() { openedModal = this; } }
class Notice {}
class TFile {}
Module._load = function(name, parent, main) {
  if (name === 'obsidian') return { Plugin, BasesView, Modal, Notice, TFile };
  return original.call(this, name, parent, main);
};
const Warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => Warnings.push(args.join(' '));
const OriginalDate = global.Date;
global.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : ['2026-11-22T12:00:00Z'])); } };
const OriginalDoc = global.document;
global.document = { createElementNS: (_ns, tag) => {
  const el = new Element(tag);
  el.appendChild = (child) => { el.children.push(child); };
  return el;
} };
try {
  const GanttPlugin = require('../main.js');
  const plugin = new GanttPlugin();
  plugin.onload();
  assert.equal(plugin.registration.id, 'visual-gantt');
  assert.equal(Warnings.length, 0, 'registration with void return must not warn');
  const settings = Object.fromEntries(plugin.registration.definition.options().map(item => [item.key, item.default]));
  const entry = (name, props) => ({
    file: { path: `Tasks/${name}.md`, basename: name },
    getValue: key => props[key.slice(5)] ?? null
  });
  const entries = [
    entry('Discovery', { start: '2026-12-01', end: '2026-12-03', title: 'Discovery' }),
    entry('Testing', { start: '2026-12-04', end: '2026-12-06', title: 'Testing', depends_on: '[[Discovery]]' })
  ];
  const controller = { app: plugin.app,
    config: { name: 'Test project', get: key => settings[key], set: (key, value) => { settings[key] = value; } }, data: { data: entries } };
  const root = new Element();
  const view = plugin.registration.definition.factory(controller, root);
  view.onDataUpdated();
  const all = (el, out = []) => { out.push(el); el.children.forEach(child => all(child, out)); return out; };
  let nodes = all(root);
  assert.equal(nodes.filter(node => node.classes.includes('vg-task-link')).length, 2);
  assert.equal(nodes.filter(node => node.classes.includes('vg-bar')).length, 2);
  assert.equal(nodes.filter(node => node.classes.includes('vg-dependency-path')).length, 1);
  assert.ok(nodes.some(node => node.text === 'by LanternSquid'));
  assert.ok(nodes.some(node => node.text === 'December 2026'));
  assert.ok(nodes.some(node => node.classes.includes('vg-planned')));
  assert.ok(nodes.some(node => node.classes.includes('vg-weekend')));
  const arrow = nodes.find(node => node.classes.includes('vg-dependency-path'));
  assert.ok(arrow.attributes.d.startsWith('M401,102'), 'arrow starts at the first bar right edge and row center');
  assert.equal(nodes.filter(node => node.classes.includes('vg-editable')).length, 0, 'editing off by default');
  const scroller = nodes.find(node => node.classes.includes('vg-scroll'));
  scroller.scrollLeft = 100;
  scroller.events.scroll();
  const monthLabel = nodes.find(node => node.classes.includes('vg-month-label'));
  assert.equal(monthLabel.style.transform, 'translateX(74px)', 'month heading follows horizontal scrolling');
  assert.equal(scroller.events.wheel, undefined, 'Shift + scroll zoom is off by default');
  settings.shiftWheelZoom = true; settings.zoom = 'week'; view.onDataUpdated();
  const wheelScroller = all(root).find(node => node.classes.includes('vg-scroll'));
  wheelScroller.getBoundingClientRect = () => ({ left: 0 });
  let prevented = false;
  wheelScroller.events.wheel({ shiftKey: false, deltaY: -100, preventDefault() { prevented = true; } });
  assert.equal(settings.zoom, 'week', 'plain wheel keeps the zoom'); assert.equal(prevented, false);
  const anchorDate = view.model.first + (wheelScroller.scrollLeft + 180) / view.model.dayWidth * 86400000;
  wheelScroller.events.wheel({ shiftKey: true, deltaY: -100, clientX: view.model.labelWidth + 180, preventDefault() { prevented = true; } });
  assert.equal(settings.zoom, 'day', 'Shift + wheel up zooms in'); assert.equal(prevented, true);
  const zoomedScroller = all(root).find(node => node.classes.includes('vg-scroll'));
  assert.equal(zoomedScroller.scrollLeft, Math.max(0, (anchorDate - view.model.first) / 86400000 * view.model.dayWidth - 180), 'date under the pointer stays in place');
  view.lastWheelZoom = 0; zoomedScroller.getBoundingClientRect = () => ({ left: 0 });
  zoomedScroller.events.wheel({ shiftKey: true, deltaY: 0, deltaX: 100, clientX: 0, preventDefault() {} });
  assert.equal(settings.zoom, 'week', 'Shift + wheel down zooms out, including horizontal wheel deltas');
  settings.shiftWheelZoom = false; settings.zoom = 'day'; view.onDataUpdated();
  const zoomControl = all(root).find(node => node.tag === 'select');
  zoomControl.value = 'week'; zoomControl.events.change();
  assert.equal(settings.zoom, 'week');
  assert.equal(view.model.dayWidth, 9);
  let controls = all(root);
  assert.ok(!controls.some(node => node.tag === 'input' && node.attributes.type === 'range'), 'the toolbar has no width slider');
  let resizer = controls.find(node => node.attributes.role === 'separator');
  assert.equal(resizer.attributes['aria-label'], 'Task column width');
  resizer.setPointerCapture = () => {}; const chartNode = controls.find(node => node.classes.includes('vg-chart'));
  resizer.events.pointerdown({ button: 0, isPrimary: true, clientX: 500, pointerId: 1, preventDefault() {}, stopPropagation() {} });
  resizer.events.pointermove({ clientX: 583 });
  assert.equal(chartNode.style['--vg-label-width'], '383px', 'the column follows the pointer while dragging');
  assert.equal(resizer.attributes['aria-valuenow'], '383', 'the separator value follows the drag');
  resizer.events.pointerup({ clientX: 583 });
  assert.equal(settings.labelWidth, 380, 'a drag saves the width snapped to 20 pixels');
  assert.equal(view.model.labelWidth, 380);
  controls = all(root); resizer = controls.find(node => node.attributes.role === 'separator');
  resizer.events.keydown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(view.model.labelWidth, 400, 'arrow keys resize the column');
  controls = all(root); resizer = controls.find(node => node.attributes.role === 'separator');
  resizer.events.keydown({ key: 'End', preventDefault() {} });
  assert.equal(view.model.labelWidth, 520);
  controls = all(root); resizer = controls.find(node => node.attributes.role === 'separator');
  resizer.events.dblclick();
  assert.equal(view.model.labelWidth, 300, 'double-click resets the width');
  settings.labelWidth = 380; view.onDataUpdated();
  controls = all(root);
  controls.find(node => node.tag === 'button' && node.text === 'Today').events.click();
  assert.ok(view.model.first <= require('../main.js')._test.localToday());
  assert.ok(all(root).some(node => node.classes.includes('vg-today-line')));
  all(root).find(node => node.tag === 'button' && node.text === 'Project').events.click();
  assert.equal(view.model.first, Date.UTC(2026,10,30));
  settings.labelWidth = 300;
  settings.enableEditing = true;
  view.onDataUpdated();
  nodes = all(root);
  assert.equal(nodes.filter(node => node.classes.includes('vg-editable')).length, 2);
  assert.equal(nodes.filter(node => node.classes.includes('vg-bar') && node.attributes.role === 'button').length, 2);
  const editable = nodes.find(node => node.classes.includes('vg-editable'));
  editable.removeEventListener = name => { delete editable.events[name]; };
  editable.events.pointerdown({ button: 0, isPrimary: true, pointerType: 'mouse', pointerId: 1, clientX: 100, preventDefault() {} });
  editable.events.pointerup({ clientX: 109 });
  assert.equal(openedModal.nextStart, '2026-12-02', 'a week-scale drag uses 9 pixels per day');
  assert.equal(openedModal.nextEnd, '2026-12-04');
  editable.events.keydown({ key: 'Enter', preventDefault() {} });
  assert.equal(openedModal.nextStart, '2026-12-01', 'keyboard opens without shifting dates');
  settings.enableEditing = false;
  view.data = { data: [] }; view.onDataUpdated();
  assert.ok(all(root).some(node => node.classes.includes('vg-empty')));
  view.data = { data: Array(501).fill(entries[0]) }; view.onDataUpdated();
  assert.ok(all(root).some(node => /500 or fewer/.test(node.text)));
  settings.zoom = 'day';
  view.data = { data: Array.from({ length: 500 }, (_, i) => entry('Long ' + i, {start:'2026-01-01',end:'2027-12-31'})) };
  view.onDataUpdated();
  assert.equal(view.model.tasks.length, 500);
  assert.ok(all(root).some(node => node.classes.includes('vg-large')));
  assert.ok(all(root).length < 10000, 'long charts use CSS shading instead of hundreds of thousands of cells');
  view.onClose();
  plugin.onunload();
  console.log('Registration and mocked rendering smoke tests passed');
} finally {
  global.Date = OriginalDate;
  global.document = OriginalDoc;
  console.warn = originalWarn;
  Module._load = original;
}
