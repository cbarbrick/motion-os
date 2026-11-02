import assert from 'node:assert/strict';
const url=process.env.VITE_SUPABASE_URL,key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
assert.ok(url&&key,'Project configuration is required');
for(const table of ['workspaces','members','items','activity','access_grants','workspace_invites','workspace_revocations','sponsorships','sponsorship_comments','sponsorship_settings','notifications']){
 const response=await fetch(`${url}/rest/v1/${table}?select=*`,{headers:{apikey:key}});
 assert.ok([401,403].includes(response.status),`${table}: anonymous reads must be denied, got ${response.status}`);
 console.log(`${table}: anonymous access denied`);
}
const write=await fetch(`${url}/rest/v1/rpc/create_workspace`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({p_name:'Unauthorized test',p_display_name:'No user'})});
assert.ok([401,403].includes(write.status),`Anonymous RPC must fail, got ${write.status}`);
console.log('Anonymous workspace creation denied');

const join=await fetch(`${url}/rest/v1/rpc/join_workspace`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({p_token:'00000000-0000-4000-8000-000000000000',p_name:'Anonymous'})});
assert.ok([401,403].includes(join.status),`Anonymous join must fail, got ${join.status}`);
console.log('Anonymous invitation join denied');

const absentId='00000000-0000-4000-8000-000000000000';
for(const [rpc,args] of Object.entries({
 read_notifications:{p_workspace:absentId,p_id:null},
 save_sponsorship:{p_workspace:absentId,p_id:null,p_version:0,p_data:{athlete_name:'Unauthorized test'}},
 review_sponsorship:{p_id:absentId,p_version:1,p_status:'approved',p_comment:''},
 add_sponsorship_comment:{p_id:absentId,p_body:'Unauthorized test'},
 set_sponsorship_reviewer:{p_workspace:absentId,p_reviewer:null},
})){
 const response=await fetch(`${url}/rest/v1/rpc/${rpc}`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify(args)});
 assert.ok([401,403].includes(response.status),`${rpc}: anonymous execution must be denied, got ${response.status}`);
 console.log(`${rpc}: anonymous execution denied`);
}
