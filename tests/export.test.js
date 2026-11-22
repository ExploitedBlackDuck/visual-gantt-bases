// Export format checks by LanternSquid.
'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'obsidian') return { Plugin: class {}, BasesView: class {}, Modal: class {}, Notice: class {}, TFile: class {} };
  return original.call(this, name, ...args);
};
const { makeRasterPdf, drawExportCanvas } = require('../main.js')._test;
Module._load = original;
const jpeg = Buffer.from(require('./jpeg-fixture.json').base64, 'base64');
const bytes = new Uint8Array(makeRasterPdf([{ width: 2, height: 2, bytes: jpeg }, { width: 2, height: 2, bytes: jpeg }]));
const text = Buffer.from(bytes).toString('latin1');
assert.ok(text.startsWith('%PDF-1.4\n'));
assert.match(text, /\/Count 2\b/); assert.match(text, /\/Author \(LanternSquid\)/);
assert.equal((text.match(/\/Subtype \/Image/g) || []).length, 2);
const startxref = Number(text.match(/startxref\n(\d+)/)[1]);
assert.equal(text.slice(startxref, startxref + 4), 'xref');
const section = text.slice(startxref).split('\n'), count = Number(section[1].split(' ')[1]);
for (let i = 1; i < count; i++) {
  const offset = Number(section[i + 2].slice(0, 10));
  assert.ok(text.slice(offset).startsWith(`${i} 0 obj\n`), 'PDF byte offset points to object ' + i);
}
assert.ok(Buffer.from(bytes).includes(jpeg), 'JPEG bytes survive PDF embedding');
assert.throws(() => drawExportCanvas(null, { tasks: Array(500), labelWidth: 300, dayWidth: 26 }, { row: 0, count: 500, day: 0, days: 730 }), /PNG is too large/);
console.log('PDF structure, cross-reference offsets, embedded image, and PNG limits passed');
