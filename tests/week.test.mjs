import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/model.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {isInWeek,isOnTask,taskPeople}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
test('team week uses Monday through Sunday across month and year boundaries',()=>{
 const task={kind:'task',week_of:null};
 for(const due_date of ['2026-12-28','2026-12-31','2027-01-03']) assert.equal(isInWeek({...task,due_date},'2026-12-28'),true);
 for(const due_date of ['2026-12-27','2027-01-04',null]) assert.equal(isInWeek({...task,due_date},'2026-12-28'),false);
});
test('explicit weekly assignments take precedence; private to-dos are never included',()=>{
 assert.equal(isInWeek({kind:'task',week_of:'2026-10-26',due_date:null},'2026-10-26'),true);
 assert.equal(isInWeek({kind:'task',week_of:'2026-11-02',due_date:'2026-10-27'},'2026-10-26'),false);
 assert.equal(isInWeek({kind:'todo',week_of:'2026-10-26',due_date:'2026-10-27'},'2026-10-26'),false);
});

test('task owner and collaborators share weekly work without duplicate people',()=>{
 const t={kind:'task',assignee_id:'alex',collaborator_ids:['alex','char'],week_of:'2026-10-26'};
 assert.deepEqual(taskPeople(t),['alex','char']);
 assert.equal(isOnTask(t,'char') && isInWeek(t,'2026-10-26'),true);
 assert.equal(isOnTask(t,'david'),false);
 assert.equal(isOnTask({...t,kind:'todo'},'char'),false);
 assert.equal(isOnTask({kind:'task',assignee_id:'alex'},'alex'),true);
});
