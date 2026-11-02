import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const compile=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64');
const model=compile(await readFile(new URL('../src/model.ts',import.meta.url),'utf8'));
const source=(await readFile(new URL('../src/event-time.ts',import.meta.url),'utf8')).replace('"./model"',JSON.stringify(model));
const {eventStartDay,eventEndDay,eventOnDay,eventTimeLabel}=await import(compile(source));
process.env.TZ='America/New_York';
test('all-day events keep calendar dates across time zones and exclusive end dates',()=>{
 const e={starts_at:'2026-10-30T00:00:00Z',ends_at:'2026-11-02T00:00:00Z',all_day:true};
 for(const tz of ['America/New_York','Pacific/Honolulu','Asia/Tokyo']) {
  process.env.TZ=tz;
  assert.equal(eventStartDay(e),'2026-10-30');assert.equal(eventEndDay(e),'2026-11-01');
  assert.equal(eventOnDay(e,'2026-11-01'),true);assert.equal(eventOnDay(e,'2026-11-02'),false);
  assert.equal(eventTimeLabel(e),'All day');
 }
 process.env.TZ='America/New_York';
});
test('overnight and month-spanning timed events appear on each covered local day',()=>{
 const e={starts_at:'2026-11-01T03:00:00Z',ends_at:'2026-11-01T07:00:00Z',all_day:false};
 assert.equal(eventStartDay(e),'2026-10-31');assert.equal(eventEndDay(e),'2026-11-01');
 assert.equal(eventOnDay(e,'2026-10-31'),true);assert.equal(eventOnDay(e,'2026-11-01'),true);
 assert.equal(eventOnDay(e,'2026-11-02'),false);
 const midnight={...e,ends_at:'2026-11-01T04:00:00Z'};assert.equal(eventEndDay(midnight),'2026-10-31');
});
test('old events without end times remain visible on their original date',()=>{
 const old={starts_at:'2026-10-30T15:00:00Z',ends_at:null,all_day:false};
 assert.equal(eventOnDay(old,'2026-10-30'),true);assert.equal(eventOnDay(old,'2026-10-31'),false);
});
