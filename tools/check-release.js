'use strict';
// Published web artifacts are checked against the actual private backend source.
// source/gas and source/web here are historical snapshots only.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),arg=process.argv.find(a=>a.startsWith('--source-root='));
assert.ok(arg,'Required: --source-root=/absolute/path/to/verified/private/source. Historical public GAS is not a release source.');
const source=path.resolve(arg.slice('--source-root='.length)),m=JSON.parse(fs.readFileSync(path.join(root,'release-manifest.json'),'utf8'));
const read=(base,p)=>fs.readFileSync(path.join(base,p)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const version=(s,k)=>(s.match(new RegExp('\\b'+k+'\\s*[:=]\\s*[\'\"]([^\'\"]+)[\'\"]'))||[])[1];
for(const [p,h] of Object.entries(m.web))assert.equal(sha(read(root,p)),h,'Published asset changed: '+p);
for(const [p,h] of Object.entries(m.backend))assert.equal(sha(read(source,'gas-clasp/'+p)),h,'Backend differs from tested candidate: '+p);
assert.equal(Object.keys(m.backend).length,18,'Complete backend required');
for(const p of Object.keys(m.web).filter(p=>p!=='config.js'))assert.deepEqual(read(root,p),read(source,'web/'+p),'Published/private web mismatch: '+p);
const ui=read(root,'app.js').toString(),cfg=read(root,'config.js').toString(),gas=read(source,'gas-clasp/Config.js').toString(),router=read(source,'gas-clasp/Code.js').toString(),ledger=read(source,'gas-clasp/Ledger.js').toString();
for(const v of [version(ui,'UI_VERSION'),version(cfg,'VERSION'),version(gas,'API_VERSION')])assert.equal(v,m.version,'Coordinated version mismatch');
const endpoint=(cfg.match(/API_URL:\s*['"]([^'"]+)['"]/)||[])[1];
assert.ok(endpoint&&sha(endpoint)===m.api_url_sha256,'Production endpoint must remain unchanged');
const routes=new Set([...router.matchAll(/^\s*(\w+):\s*\{\s*auth:/gm)].map(x=>x[1]));
for(const c of new Set([...ui.matchAll(/\bapi\(['"]([^'"]+)['"]/g)].map(x=>x[1])))assert.ok(routes.has(c),'Missing backend route: '+c);
for(const field of ['preview_snapshot','price_changes','new_rows','changed_rows'])if(ui.includes(field))assert.ok(ledger.includes(field),'Missing Ledger contract: '+field);
for(const script of ['ci/verify-source.cjs','verification/test/protected-finance-source-0736.test.js']){
 const result=cp.spawnSync(process.execPath,[path.join(source,script)],{cwd:source,stdio:'inherit'});
 assert.equal(result.status,0,'Source/financial guard failed: '+script);
}
console.log('PASS: exact web/backend artifacts, versions, original endpoint, API contracts, private mirrors and immutable financial source.');
console.log('Manifest test counts describe retained evidence; this preflight does not rerun financial integration tests or authorize payments.');
