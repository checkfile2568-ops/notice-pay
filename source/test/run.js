const fs=require('fs'),path=require('path'),cp=require('child_process');
const files=fs.readdirSync(__dirname).filter(x=>x.endsWith('.test.js')).sort().concat('gas.smoke.js');
for(const file of files){console.log('\n'+file);const r=cp.spawnSync(process.execPath,[path.join(__dirname,file)],{stdio:'inherit',env:process.env});if(r.status!==0)process.exit(r.status||1);}
