// Reproduce a mobile observer which never calls back: tables must still be visible.
const assert=require('assert'),fs=require('fs'),path=require('path');
const {JSDOM}=require(process.env.NP_JSDOM_PATH||'jsdom');
const {g,call,props}=require('./harness');g.setupSystem();props.PRINTHUB_DB_ID='PH';
const auth=call('login',{code:'U001',pin:'1234'}).data;
const officer=g.readTable_('OFFICERS').rows.find(r=>r.officer_id==='OF01');officer.first_name='อำไพพรรณ';g.updateRow_('OFFICERS',officer._r,officer);
g.appendRows_('NOTICES',Array.from({length:237},(_,i)=>({notice_uid:'TABLE-'+i,fy:'2570',pay_type:'BUDGET',case_no:'TEST-'+i+'/2569',notice_kind:'หมายทดสอบ',recipient:'ข้อมูลจำลอง',officer_id:'OF01',tambon:'ทดสอบ',issued_date:'2026-10-01',delivered_date:'2026-11-01',reported_date:'2026-11-02',calc_rule:'SINGLE',calc_amount:'300',budget_unit_id:'UNIT-'+i,status:'DELIVERED'})));
const html=fs.readFileSync(path.join(__dirname,'../web/index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,observed=new Set();
w.NP_CONFIG={VERSION:'0.7.3',API_URL:'http://localhost/api'};w.matchMedia=()=>({matches:false});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
w.IntersectionObserver=class{observe(el){observed.add(el);}unobserve(el){observed.delete(el);}};
w.fetch=async(u,o)=>{const d=JSON.parse(o.body);return {json:async()=>call(d.action,d)}};
const css=fs.readFileSync(path.join(__dirname,'../web/app.css'),'utf8'),style=w.document.createElement('style');
style.textContent='.rv{opacity:0;transform:translateY(16px)}'+css.match(/\.clay\.panel\.data-panel\{[^}]+\}/)[0]+css.match(/th\.onm,td\.onm\{[^}]+\}/)[0];w.document.head.append(style);
w.eval(fs.readFileSync(path.join(__dirname,'../web/import-formats.js'),'utf8'));
let src=fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8').replace(/\}\)\(\);\s*$/,'window.__TEST={S,go};})();');w.eval(src);
const tick=()=>new Promise(r=>setTimeout(r,50)),api=w.__TEST;
function visibleTables(){const tables=[...w.document.querySelectorAll('#main table')];assert.ok(tables.length);for(const table of tables){for(let el=table;el&&el.id!=='main';el=el.parentElement){assert.notEqual(w.getComputedStyle(el).opacity,'0','table hidden by '+el.className);assert.ok(!observed.has(el),'table ancestor still waits for observer');}}}
(async()=>{
 await tick();api.S.token=auth.token;api.S.user=auth.user;api.S.fy='2570';api.go('tracking');await tick();visibleTables();assert.equal(w.document.querySelector('#trackResult tbody').rows.length,100);assert.ok(w.document.querySelector('#trackResult').textContent.includes('237'));console.log('✓ ตาราง 100 แถวแสดงทันที แม้ observer มือถือไม่ตอบกลับ');
 w.document.querySelector('#trNext').click();await tick();visibleTables();assert.equal(w.document.querySelector('#trackResult tbody').rows.length,100);w.document.querySelector('#trNext').click();await tick();visibleTables();assert.equal(w.document.querySelector('#trackResult tbody').rows.length,37);console.log('✓ หน้าถัดไปแสดงครบ 237 รายการ ไม่มีตารางหาย');
 api.go('payout');await tick();visibleTables();const names=[...w.document.querySelectorAll('#main td.onm')];assert.ok(names.some(el=>el.textContent.includes('อำไพพรรณ')));for(const el of names)assert.equal(w.getComputedStyle(el).whiteSpace,'nowrap');console.log('✓ ชื่อในตารางยังไม่เข้ารอบอยู่บรรทัดเดียว รวมจุดสีและชื่อยาว');
 w.document.querySelector('#pBl').click();await tick();visibleTables();assert.ok(w.document.querySelector('#main tbody td.onm'));console.log('✓ ตารางค้างเบิกรายเรื่องแสดงทันทีและใช้ชื่อบรรทัดเดียว');
 api.go('reports');await tick();visibleTables();console.log('✓ ตารางรายงานยังแสดงได้เมื่อไม่รอเอฟเฟกต์เลื่อน');
 dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
