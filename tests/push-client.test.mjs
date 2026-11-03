import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const source=await readFile(new URL('../src/push-client.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function setup({ios=false,standalone=false,permission='granted',hangPermission=false,hangSubscribe=false,hangUnsubscribe=false,active=false}={}){
 const calls=[],exports={};
 const subscription={endpoint:'https://web.push.apple.com/example',toJSON:()=>({keys:{p256dh:'public',auth:'secret'}}),unsubscribe:async()=>{calls.push('unsubscribe');if(hangUnsubscribe)return new Promise(()=>{});active=false;return true;}};
 const registration={getNotifications:async()=>[{close:()=>calls.push('close')}],pushManager:{getSubscription:async()=>active?subscription:null,subscribe:async options=>{calls.push(['subscribe',options]);if(hangSubscribe)return new Promise(()=>{});active=true;return subscription;}}};
 const Notification={permission,requestPermission:()=>{calls.push('permission');return hangPermission?new Promise(()=>{}):Promise.resolve(permission);}};
 const navigator={userAgent:ios?'iPhone':'Chrome',platform:ios?'iPhone':'Linux',maxTouchPoints:ios?5:0,standalone,serviceWorker:{getRegistration:async()=>registration,register:async()=>registration,ready:Promise.resolve(registration)}};
 const supabase={rpc:async(name,args)=>{calls.push([name,args]);return {data:name==='save_push_subscription'||name==='get_push_subscription'?'device-id':null,error:null};}};
 vm.runInNewContext(code,{exports,require:()=>({supabase}),navigator,window:{Notification,PushManager:{},serviceWorker:{}},Notification,matchMedia:()=>({matches:standalone}),setTimeout:fn=>setTimeout(fn,5),clearTimeout});
 return {api:exports,calls};
}
test('iPhone gives installation guidance before attempting permission; denied permission stays blocked',()=>{
 assert.equal(setup({ios:true}).api.pushSupport(),'install');
 assert.equal(setup({ios:true,standalone:true}).api.pushSupport(),'off');
 assert.equal(setup({permission:'denied'}).api.pushSupport(),'blocked');
});
test('enabling registers only the current device and disabling unsubscribes and clears visible alerts',async()=>{
 const {api,calls}=setup();const result=await api.enableDevicePush('vapid-public');assert.equal(result.mode,'on');
 assert.equal(calls[0],'permission');assert.equal(calls[1][0],'subscribe');assert.equal(calls[1][1].userVisibleOnly,true);assert.equal(calls[1][1].applicationServerKey,'vapid-public');
 assert.equal(calls[2][0],'save_push_subscription');
 await api.disableDevicePush();assert.ok(calls.includes('unsubscribe'));assert.ok(calls.includes('close'));assert.ok(calls.some(c=>Array.isArray(c)&&c[0]==='remove_push_subscription'));
});
test('permission and push-service stalls return a retryable error without registering a device',async()=>{
 for(const settings of [{hangPermission:true},{hangSubscribe:true}]){
  const {api,calls}=setup(settings);await assert.rejects(api.enableDevicePush('key'),/did not finish|could not connect/);
  assert.ok(!calls.some(c=>Array.isArray(c)&&c[0]==='save_push_subscription'));
 }
});
test('a saved device is detected after reload and sign-out clears its browser subscription',async()=>{
 const {api,calls}=setup({active:true});assert.equal((await api.devicePushState()).mode,'on');await api.clearBrowserPush();assert.ok(calls.includes('unsubscribe'));assert.ok(calls.includes('close'));
});
test('a stalled browser unsubscribe still removes the server registration and cannot block sign-out forever',async()=>{
 const {api,calls}=setup({active:true,hangUnsubscribe:true});await assert.rejects(api.disableDevicePush(),/cleanup timed out/);
 assert.ok(calls.some(c=>Array.isArray(c)&&c[0]==='remove_push_subscription'));assert.ok(calls.includes('close'));
});
