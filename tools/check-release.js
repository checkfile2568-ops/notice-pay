'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const failures = [];
const fail = s => failures.push(s);
const ui = read('app.js'), src = read('source/web/app.js'), cfg = read('config.js');
const routesSrc = read('source/gas/Code.gs'), gasCfg = read('source/gas/Config.gs'), ledger = read('source/gas/Ledger.gs');
const vers = (s,k) => (s.match(new RegExp('\\b'+k+'\\s*[:=]\\s*[\'"]([^\'"]+)[\'"]'))||[])[1];
const uiV = vers(ui,'UI_VERSION'), srcV = vers(src,'UI_VERSION'), cfgV = vers(cfg,'VERSION'), gasV = vers(gasCfg,'API_VERSION');
const calls = [...new Set([...ui.matchAll(/\bapi\(['"]([^'"]+)['"]/g)].map(m=>m[1]))].sort();
const routes = new Set([...routesSrc.matchAll(/^\s*(\w+):\s*\{\s*auth:/gm)].map(m=>m[1]));
for(const c of calls) if(!routes.has(c)) fail('Missing GAS route: '+c);
if (ui !== src) fail('Published app.js differs from source/web/app.js used by tests');
if(!uiV||!srcV||!cfgV||!gasV||new Set([uiV,srcV,cfgV,gasV]).size!==1) fail('Version mismatch: '+JSON.stringify({uiV,srcV,cfgV,gasV}));
for(const field of ['preview_snapshot','price_changes','new_rows','changed_rows']) if(ui.includes(field)&&!ledger.includes(field)) fail('Missing Ledger contract field: '+field);
const protectedBlobs = {
 'config.js':'51afb412f751c5047ef9e899ddbcca2492f95b47',
 'source/gas/Calc.gs':'629bb9834696926250353a87019c2cc3c44355a5',
 'source/gas/Core.gs':'5256849e331a4f3d8e9131e673c2becbdedc7b03',
 'source/gas/Payout.gs':'0effd09610ea94e05f1166c6ecd9f2db3f11249c'
};
// Audit snapshot, not certified. Changes require an explicit reviewed baseline update.
for(const [p,expected] of Object.entries(protectedBlobs)){
 const b=fs.readFileSync(path.join(root,p));
 const sha=crypto.createHash('sha1').update('blob '+b.length+'\\0'.replace('\\0','\0')).update(b).digest('hex');
 if(sha!==expected) fail('Protected snapshot changed; review and authorize before updating baseline: '+p);
}
console.log('Static preflight:', calls.length, 'literal UI calls;', routes.size, 'GAS routes');
for(const f of failures) console.error('FAIL:',f);
if(failures.length) process.exitCode=1;
else console.log('Static preflight passed; live deployment and regression evidence still required.');
