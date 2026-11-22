'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module._load;
class FakeTFile { constructor() { this.extension = 'md'; } }
Module._load = function(request, parent, main) {
  if (request === 'obsidian') return { Plugin: class {}, BasesView: class {}, Modal: class {}, Notice: class {}, TFile: FakeTFile };
  return original.call(this, request, parent, main);
};
const { isoDate, parseDependencies, makeTasks, strictDate, shiftRange, validateChange, unchangedDates, saveTaskDates, undoDateChange, sameDependencies, statusClass } = require('../main.js')._test;
Module._load = original;
assert.equal(isoDate('2026-02-29'), null);
assert.equal(isoDate('2028-02-29'), Date.UTC(2028, 1, 29));
assert.deepEqual(parseDependencies('[[Tasks/Discovery|Discovery]], [[Policy Review]]'), ['Tasks/Discovery', 'Policy Review']);
const entry = (name, props) => ({file:{path:`Tasks/${name}.md`,basename:name},getValue(key){return props[key.slice(5)] ?? null;}});
const sample = [
  entry('A',{start:'2026-12-01',end:'2026-12-02',title:'A',depends_on:'[[B]]'}),
  entry('B',{start:'2026-12-03',end:'2026-12-04',title:'B',depends_on:'[[A]]'}),
  entry('C',{start:'2026-12-05',end:'2026-12-05',title:'C',milestone:'true',depends_on:'[[B]]'}),
  entry('D',{start:'2026-12-07',end:'2026-12-01',title:'D'})
];
const result = makeTasks(sample,{start:'start',end:'end',label:'title',status:'status',depends:'depends_on',milestone:'milestone'});
const nullValue = {isTruthy:()=>false,toString:()=> 'null'};
const blankEntry = {file:{path:'Tasks/Discovery.md',basename:'Discovery'},getValue(key){return ({'note.start':'2026-12-01','note.end':'2026-12-03','note.title':'Discovery'})[key] ?? nullValue;}};
const blankResult = makeTasks([blankEntry],{start:'start',end:'end',label:'title',status:'status',depends:'depends_on',milestone:'milestone'});
assert.equal(blankResult.tasks.length,1);
assert.deepEqual(blankResult.tasks[0].depends,[]);
assert.deepEqual(blankResult.warnings,[]);
assert.equal(statusClass('Not Started'), 'vg-planned');
assert.equal(statusClass('In Progress'), 'vg-progress');
assert.equal(statusClass('Completed'), 'vg-done');
assert.equal(statusClass('On Hold'), 'vg-blocked');
assert.equal(statusClass(''), 'vg-planned');
assert.equal(result.tasks.length, 3);
assert.equal(result.edges.length, 3);
assert.equal(result.tasks.find(t=>t.label==='C').milestone, true);
assert.ok(result.warnings.some(w=>w.includes('Dependency cycle')));
assert.ok(result.warnings.some(w=>w.includes('end date is before')));
const missing = makeTasks([entry('X',{start:'2026-01-01',end:'2026-01-02',depends_on:'[[Unknown]]'})],{start:'start',end:'end',label:'title',status:'status',depends:'depends_on',milestone:'milestone'});
assert.ok(missing.warnings.some(w=>w.includes("isn't in this Base")));
assert.deepEqual(shiftRange('2026-12-30','2027-01-02',3), {start:'2027-01-02',end:'2027-01-05'});
assert.deepEqual(shiftRange('2027-01-02','2027-01-05',-3), {start:'2026-12-30',end:'2027-01-02'});
assert.equal(strictDate('2026-02-29'), null);
assert.equal(strictDate('2028-02-29'), '2028-02-29');
assert.equal(strictDate('2026-12-01T00:00'), null);
const a = {path:'Tasks/A.md',label:'A',start:isoDate('2026-12-01'),end:isoDate('2026-12-02'),milestone:false};
const b = {path:'Tasks/B.md',label:'B',start:isoDate('2026-12-04'),end:isoDate('2026-12-05'),milestone:false};
assert.equal(validateChange(b,'2026-12-03','2026-12-05',[{from:a,to:b}]), null);
assert.match(validateChange(b,'2026-12-02','2026-12-05',[{from:a,to:b}]),/predecessor/);
assert.match(validateChange(a,'2026-12-01','2026-12-04',[{from:a,to:b}]),/successor/);
assert.equal(unchangedDates({start:'2026-12-01',end:'2026-12-02'},{start:'start',end:'end'},a), true);
assert.equal(unchangedDates({start:'2026-12-02',end:'2026-12-02'},{start:'start',end:'end'},a), false);
(async () => {
  const fm={start:'2026-12-01',end:'2026-12-02',unrelated:'keep'};
  const fakeFile=new FakeTFile();
  const app={vault:{getAbstractFileByPath:()=>fakeFile},fileManager:{processFrontMatter:async (_file,cb)=>cb(fm)}};
  await saveTaskDates(app,a,{start:'start',end:'end'},'2026-12-02','2026-12-03',[]);
  assert.equal(fm.start,'2026-12-02');
  assert.equal(fm.end,'2026-12-03');
  assert.equal(fm.unrelated,'keep');
  await assert.rejects(saveTaskDates(app,a,{start:'start',end:'end'},'2026-12-03','2026-12-04',[]),/changed since this view loaded/);
  await assert.rejects(saveTaskDates(app,b,{start:'start',end:'end'},'2026-12-02','2026-12-05',[{from:a,to:b}]),/predecessor/);
  assert.equal(sameDependencies(['[[Tasks/A]]','[[B]]'], ['B','Tasks/A']), true);
  assert.equal(sameDependencies(['[[C]]'], ['B']), false);
  // Undo restores precisely the prior values and retains unrelated frontmatter.
  const undoTask={...a,depends:[]};
  const resetFm={start:'2026-12-01',end:'2026-12-02', unrelated:'keep'};
  const resetApp={vault:{getAbstractFileByPath:()=>fakeFile},fileManager:{processFrontMatter:async (_file,cb)=>cb(resetFm)}};
  const receipt=await saveTaskDates(resetApp, undoTask, {start:'start',end:'end',depends:'depends_on'}, '2026-12-03', '2026-12-04', []);
  await undoDateChange(resetApp, receipt, {start:'start',end:'end',depends:'depends_on'}, []);
  assert.equal(resetFm.start, '2026-12-01');
  assert.equal(resetFm.end, '2026-12-02');
  assert.equal(resetFm.unrelated, 'keep');
  // A concurrent edit must prevent undo rather than overwrite someone's dates.
  const another = await saveTaskDates(resetApp, undoTask, {start:'start',end:'end',depends:'depends_on'}, '2026-12-05', '2026-12-06', []);
  resetFm.end='2026-12-07';
  await assert.rejects(undoDateChange(resetApp, another, {start:'start',end:'end',depends:'depends_on'}, []), /changed since this view loaded/);
  resetFm.end='2026-12-06';
  resetFm.depends_on=['[[Unexpected]]'];
  await assert.rejects(undoDateChange(resetApp, another, {start:'start',end:'end',depends:'depends_on'}, []), /dependencies changed/);
  // Dependency mismatch is checked on regular edits as well.
  const stale = {...a,depends:['Previous']};
  const staleFm={start:'2026-12-01',end:'2026-12-02',depends_on:['[[Different]]']};
  const staleApp={vault:{getAbstractFileByPath:()=>fakeFile},fileManager:{processFrontMatter:async (_file,cb)=>cb(staleFm)}};
  await assert.rejects(saveTaskDates(staleApp, stale, {start:'start',end:'end',depends:'depends_on'},'2026-12-03','2026-12-04',[]), /dependencies changed/);
  await assert.rejects(undoDateChange(resetApp, {...another, fields:{start:'other',end:'end'}}, {start:'start',end:'end'}, []), /different property settings/);
  assert.ok(typeof saveTaskDates === 'function');
  console.log('All logic tests passed');
})().catch(err=>{console.error(err); process.exitCode=1});
