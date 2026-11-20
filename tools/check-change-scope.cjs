'use strict';
// Dependency-free PR scope guard. This does NOT certify live GAS, financial sums, or deployment.
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const argv = process.argv;
const ix = argv.indexOf('--base');
if (ix < 0 || !argv[ix + 1]) {
  console.error('Usage: node tools/check-change-scope.cjs --base origin/main');
  process.exit(2);
}
const git = args => cp.execFileSync('git', args, {encoding:'utf8',maxBuffer:8*1024*1024}).trim();
const base = git(['merge-base',argv[ix+1],'HEAD']);
const names = git(['diff','--name-only','--diff-filter=ACDMRT',base,'HEAD']).split(/\r?\n/).filter(Boolean);
const manifests = names.filter(n=>/^change-control\/requests\/[A-Za-z0-9_-]+\.json$/.test(n));
const die = msg => { console.error('CHANGE SCOPE BLOCKED:',msg);process.exit(1); };
if (manifests.length !== 1) die('Each PR must change exactly one change-control/requests/<ID>.json');
let m;
try { m=JSON.parse(fs.readFileSync(manifests[0],'utf8')); } catch(e) {die('Invalid manifest: '+e.message);}
if (!m.id || !/^[A-Za-z0-9_-]+$/.test(m.id)) die('Invalid change ID');
if (!['copy-only','tooling-only','runtime'].includes(m.change_type)) die('Unknown change_type');
if (!Array.isArray(m.allowed_files) || !m.allowed_files.length) die('Specify exact allowed_files');
if (new Set(m.allowed_files).size !== m.allowed_files.length) die('Duplicate allowed paths');
if (m.allowed_files.some(n => typeof n!=='string'||!n||n.startsWith('/')||n.includes('..')||n.includes('\\'))) die('Unsafe manifest path');
const allowed=new Set([...m.allowed_files,manifests[0]]);
const excess=names.filter(n=>!allowed.has(n));
if(excess.length) die('Unapproved files: '+excess.join(', '));
const missing=m.allowed_files.filter(n=>!names.includes(n));
if(missing.length) die('Over-broad manifest (files not changed): '+missing.join(', '));
if(m.change_type==='tooling-only'){
  const invalid=m.allowed_files.filter(n=>
    !n.startsWith('docs/') &&
    !n.startsWith('.github/') &&
    n!=='tools/check-change-scope.cjs' &&
    !n.startsWith('change-control/requests/'));
  if(invalid.length)die('Tooling-only PR touches runtime/guarded files: '+invalid.join(', '));
}
if(m.change_type==='copy-only'){
  if (!Array.isArray(m.exact_replacements)||!m.exact_replacements.length)die('Copy-only requires exact_replacements');
  const byFile=new Map();
  for(const item of m.exact_replacements){
    if(!item || typeof item.file!=='string' || !m.allowed_files.includes(item.file) ||
       typeof item.from!=='string'||!item.from||
       typeof item.to!=='string'||!item.to||item.from===item.to) die('Invalid exact replacement');
    const list=byFile.get(item.file)||[];list.push(item);byFile.set(item.file,list);
  }
  for(const file of m.allowed_files){
    const items=byFile.get(file);
    if(!items||!items.length)die('Missing exact replacement rules for '+file);
    let original;
    try {original=cp.execFileSync('git',['show',base+':'+file],{encoding:'utf8',maxBuffer:8*1024*1024});}
    catch(e){die('Unable to read baseline file '+file);}
    let expected=original;
    for(const r of items){
      if(expected.split(r.from).length!==2) die('Replacement not uniquely present in base: '+file);
      expected=expected.replace(r.from,r.to);
    }
    let actual;
    try {actual=fs.readFileSync(path.resolve(file),'utf8');}catch(e){die('Unable to read candidate file '+file);}
    if(actual!==expected)die('Unexpected code/data changed outside approved literal replacements in '+file);
  }
}
if(m.change_type==='runtime'){
  if(!m.impact_map||!m.tests||!m.rollback)die('Runtime change requires impact_map, tests, rollback');
  console.log('RUNTIME scope only: financial, integration and deployment evidence are NOT verified.');
}
console.log('CHANGE SCOPE PASS:',m.id, m.change_type,'files:',names.length);
console.log('Scope check is not a release approval; run tools/check-release.js and live integration/regression gates.');
