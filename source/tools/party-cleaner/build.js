const fs=require('fs'),path=require('path');
const root=__dirname;
let html=fs.readFileSync(path.join(root,'template.html'),'utf8');
for(const [token,file] of [['ZIP',path.join(root,'jszip.min.js')],['FORMAT',path.join(root,'../../web/import-formats.js')],['CORE',path.join(root,'cleaner.js')]])html=html.replace('/*__'+token+'__*/',()=>fs.readFileSync(file,'utf8').replace(/<\/script/gi,'<\\/script'));
fs.writeFileSync(path.join(root,'notice-pay-party-cleaner-offline.html'),html);
console.log('Built offline tool with the exact shared formatter');
