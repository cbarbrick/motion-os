import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import ts from 'typescript';
// Vercel emits ESM files rather than bundling every dependency. Import the
// emitted entry points in Node so a successful typecheck cannot hide bad paths.
test('every emitted Vercel endpoint imports successfully in the Node ESM runtime',async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url));
 await mkdir(join(root,'output'),{recursive:true});
 const temp=await mkdtemp(join(root,'output','server-imports-'));
 async function compile(dir){
  for(const entry of await readdir(join(root,dir),{withFileTypes:true})){
   const path=join(dir,entry.name);
   if(entry.isDirectory()){await compile(path);continue;}
   if(!path.endsWith('.ts'))continue;
   const result=ts.transpileModule(await readFile(join(root,path),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
   await mkdir(join(temp,dir),{recursive:true});
   await writeFile(join(temp,path.replace(/\.ts$/,'.js')),result);
  }
 }
 try{
  await compile('server');await compile('api');
  for(const file of await readdir(join(temp,'api'))){
   const entry=await import(pathToFileURL(join(temp,'api',file)).href);
   assert.equal(typeof entry.default.fetch,'function',file);
  }
 }finally{await rm(temp,{recursive:true,force:true});}
});
