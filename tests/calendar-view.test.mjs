import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const compile=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64');
const model=compile(await readFile(new URL('../src/model.ts',import.meta.url),'utf8'));
const times=compile((await readFile(new URL('../src/event-time.ts',import.meta.url),'utf8')).replace('"./model"',JSON.stringify(model)));
const source=(await readFile(new URL('../src/calendar-view.ts',import.meta.url),'utf8')).replace('"./model"',JSON.stringify(model)).replace('"./event-time"',JSON.stringify(times));
const {calendarDays,moveCalendarDate,newCalendarEvent,timedEvents}=await import(compile(source));
process.env.TZ='America/New_York';
const event=(id,start,end,all_day=false)=>({id,starts_at:start,ends_at:end,all_day});
test('day, Monday-based week and month ranges include year and month boundaries',()=>{
 assert.deepEqual(calendarDays('2027-01-01','day'),['2027-01-01']);
 assert.deepEqual(calendarDays('2027-01-01','week'),['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']);
 const month=calendarDays('2026-11-11','month');assert.equal(month.length,42);assert.equal(month[0],'2026-10-26');assert.equal(month.at(-1),'2026-12-06');
 assert.equal(moveCalendarDate('2027-01-31','month',1),'2027-02-28');
 assert.equal(moveCalendarDate('2028-01-31','month',1),'2028-02-29');
 assert.equal(moveCalendarDate('2026-12-31','day',1),'2027-01-01');
 assert.equal(moveCalendarDate('2026-11-01','week',-1),'2026-10-25');
});
test('new events use the selected local slot and all-day dates have exclusive ends',()=>{
 const late=newCalendarEvent('2026-11-11',23);
 assert.equal(late.starts_at,'2026-11-12T04:00:00.000Z');assert.equal(late.ends_at,'2026-11-12T05:00:00.000Z');
 const allDay=newCalendarEvent('2026-12-31',9,true);
 assert.equal(allDay.starts_at,'2026-12-31T00:00:00.000Z');assert.equal(allDay.ends_at,'2027-01-01T00:00:00.000Z');assert.equal(allDay.all_day,true);
 const spring=newCalendarEvent('2027-03-14',2);assert.ok(Date.parse(spring.ends_at)>Date.parse(spring.starts_at));
 assert.equal(calendarDays('2026-11-01','week').length,7);
 assert.equal(newCalendarEvent('2026-11-01',9).starts_at,'2026-11-01T14:00:00.000Z');
});
test('overlapping events use separate columns and adjacent events reclaim full width',()=>{
 const entries=[event('a','2026-11-11T09:00:00-05:00','2026-11-11T11:00:00-05:00'),event('b','2026-11-11T09:30:00-05:00','2026-11-11T10:00:00-05:00'),event('c','2026-11-11T11:00:00-05:00','2026-11-11T12:00:00-05:00')];
 const result=timedEvents(entries,'2026-11-11');
 assert.equal(result[0].start,540);assert.equal(result[0].end,660);assert.equal(result[0].columns,2);assert.notEqual(result[0].column,result[1].column);assert.equal(result[2].columns,1);
});
test('overnight events clip to each day; midnight ends and all-day events are not duplicated',()=>{
 const overnight=event('a','2026-11-11T23:00:00-05:00','2026-11-12T01:00:00-05:00');
 assert.equal(timedEvents([overnight],'2026-11-11')[0].end,1440);
 assert.equal(timedEvents([overnight],'2026-11-12')[0].start,0);
 assert.equal(timedEvents([overnight],'2026-11-12')[0].end,60);
 const midnight={...overnight,ends_at:'2026-11-12T00:00:00-05:00'};
 assert.equal(timedEvents([midnight],'2026-11-12').length,0);
 assert.equal(timedEvents([{...overnight,all_day:true}],'2026-11-11').length,0);
 const short=event('short','2026-11-11T09:00:00-05:00','2026-11-11T09:05:00-05:00');
 assert.equal(timedEvents([short],'2026-11-11')[0].end,570);
 const legacy={...short,ends_at:null};assert.equal(timedEvents([legacy],'2026-11-11')[0].end,600);
});
