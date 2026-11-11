import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';
const source=await readFile(new URL('../src/google-connection-token.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {captureGoogleToken,googleRefreshToken,clearGoogleToken}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
test('one-time OAuth credential survives ordinary session restoration until the calendar handoff',()=>{
 captureGoogleToken({user:{id:'owner'},provider_refresh_token:'test-only-token'},1000);
 captureGoogleToken({user:{id:'owner'}},2000);
 assert.equal(googleRefreshToken('owner',2000),'test-only-token');assert.equal(googleRefreshToken('other',2000),null);
 clearGoogleToken();assert.equal(googleRefreshToken('owner',2000),null);
});
test('sign-out, account changes and timeout clear the transient provider credential',()=>{
 const session={user:{id:'owner'},provider_refresh_token:'test-only-token'};
 captureGoogleToken(session,1000);captureGoogleToken(null);assert.equal(googleRefreshToken('owner',2000),null);
 captureGoogleToken(session,1000);captureGoogleToken({user:{id:'other'}},2000);assert.equal(googleRefreshToken('owner',2000),null);
 captureGoogleToken(session,1000);assert.equal(googleRefreshToken('owner',901001),null);
});
