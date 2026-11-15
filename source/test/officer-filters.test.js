const assert=require('assert'),fs=require('fs'),path=require('path');
const {JSDOM}=require(process.env.NP_JSDOM_PATH||'jsdom');const {g,call,props}=require('./harness');
g.setupSystem();props.PRINTHUB_DB_ID='PH';const auth=call('login',{code:'U001',pin:'1234'}).data;
const n=(id,officer,extra={})=>Object.assign({notice_uid:id,case_no:'SYNTHETIC-'+id+'/2569',fy:'2570',pay_type:'BUDGET',recipient:'R1-'+'A'.repeat(64),officer_id:officer,issued_date:'2026-10-01',delivered_date:'2026-11-01',reported_date:'2026-11-02',calc_amount:'300',calc_rule:'SINGLE',claim_piece:id,budget_unit_id:id},extra);
g.appendRows_('NOTICES',[n('A','OF01',{calc_rule:'ONE_SAME',claim_piece:'U',budget_unit_id:'U'}),n('B','OF01',{calc_amount:'0',calc_rule:'ONE_SAME',claim_piece:'U',budget_unit_id:'U'}),n('WAIT','OF01',{delivered_date:'',calc_rule:'WAIT_DELIVERY'}),n('REVIEW','OF01',{calc_rule:'REVIEW_RATE'}),n('CLOSED','OF01',{noclaim_at:'2026-11-01'}),n('CLAIMED','OF01',{payout_round_id:'R'}),n('HISTORY','OF01'),n('OTHER','OF02',{calc_amount:'500'}),n('PAID1','OF01',{pay_type:'PAID',calc_amount:'100',calc_rule:'PAID'}),n('PAID2','OF02',{pay_type:'PAID',calc_amount:'900',calc_rule:'PAID'})]);
g.appendRows_('PAYOUT_ROUNDS',[{round_id:'R',fy:'2570',status:'CONFIRMED',round_type:'FREE',total:'300'}]);g.appendRows_('PAYOUT_ITEMS',[{round_id:'R',notice_uids:'HISTORY',included:'TRUE',amount:'300'}]);
let checks=0;function t(name,fn){fn();checks++;console.log('✓ '+name);}
const tables=['NOTICES','BUDGET_UNITS','PAYOUT_ROUNDS','PAYOUT_ITEMS','LEDGER'];const before=tables.map(k=>JSON.stringify(g.readTable_(k).rows));
const data=g.apiCalcSummary_({user:auth.user},{fy:'2570'});
t('หมายฟรียังไม่เบิกรวมทุกสถานะและไม่รวม pointer/ประวัติที่เบิกแล้ว',()=>{const p=data.officers.find(x=>x.officer_id==='OF01');assert.equal(p.pending_free_n,5);assert.equal(p.pending_ready_n,2);assert.equal(p.pending_wait_n,1);assert.equal(p.pending_review_n,1);assert.equal(p.pending_noclaim_n,1);assert.equal(p.pending_ready_amount,300);assert.equal(p.pending_ready_units,1);assert.equal(data.totals.pending_ready_amount,800);assert.equal(data.totals.pending_free_n,6);assert.deepEqual(tables.map(k=>JSON.stringify(g.readTable_(k).rows)),before);});
t('สิทธิ์ผู้ส่งเห็นยอดตนเอง ส่วนบัญชีสถิติไม่ได้รับรายการคดี',()=>{const own=g.apiCalcSummary_({user:{roles:['COURIER'],officer_id:'OF01'}},{fy:'2570'});assert.equal(own.officers.length,1);assert.equal(own.totals.pending_free_n,5);assert.equal(own.totals.pending_ready_amount,300);const viewer=g.apiCalcSummary_({user:{roles:['VIEWER']}},{fy:'2570'});assert.ok(!JSON.stringify(viewer).includes('SYNTHETIC-'));assert.equal(viewer.totals.pending_free_n,6);});
t('เซิร์ฟเวอร์ปฏิเสธการจับคู่ชื่อโจทก์จำเลยเข้าช่องอื่นก่อนบันทึก',()=>{const r=call('import_preview',{token:auth.token,kind:'ISSUE',mapping:{case_no:'ชื่อโจทก์'},rows:[{'ชื่อโจทก์':'ข้อมูลจำลองต้องไม่บันทึก'}],options:{}});assert.equal(r.code,'BAD_REQUEST');assert.deepEqual(tables.map(k=>JSON.stringify(g.readTable_(k).rows)),before);});
const html=fs.readFileSync(path.join(__dirname,'../web/index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');const dom=new JSDOM(html,{url:'http://localhost',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
w.NP_CONFIG={VERSION:'0.7.6',API_URL:'http://localhost/api'};w.matchMedia=()=>({matches:false});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
w.fetch=async(u,o)=>{const b=JSON.parse(o.body);return{json:async()=>call(b.action,b)}};let exported;w.NP_EXPORT={png:async spec=>{exported=spec;},clear:()=>{}};
w.eval(fs.readFileSync(path.join(__dirname,'../web/import-formats.js'),'utf8'));w.eval(fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8').replace(/\}\)\(\);\s*$/,'window.__TEST={S,go,IM,drawMap,importBody};})();'));
const q=s=>w.document.querySelector(s),api=w.__TEST,tick=()=>new Promise(r=>setTimeout(r,70));
const select=mode=>{q('#calcMode').value=mode;q('#calcMode').dispatchEvent(new w.Event('change'));};
const money=()=>Array.from(q('#calcOff tbody').querySelectorAll('tr[data-officer]')).map(r=>Number(r.lastElementChild.dataset.v));
(async()=>{
 await tick();api.S.token=auth.token;api.S.user=auth.user;api.S.fy='2570';api.go('calc');await tick();
 t('เลือกมีเงิน ฟรี รวม และฟรียังไม่เบิกได้ โดยเรียงเฉพาะช่องเงินสุดท้าย',()=>{
  for(const mode of ['ALL','PAID','FREE','FREE_PENDING']){select(mode);const hs=q('#calcOff thead').querySelectorAll('th');assert.equal(q('#calcOff').querySelectorAll('th[data-sort]').length,1);assert.equal(hs[hs.length-1].getAttribute('data-sort'),'');assert.equal(q('#calcOff').querySelectorAll('.srt button').length,2);assert.equal(q('#calcOff tbody').lastElementChild.className,'sum');}
  assert.equal(Number(q('#calcOff tr[data-officer="OF01"]').lastElementChild.dataset.v),300);assert.ok(q('#calcFilterNote').textContent.includes('รอตรวจ'));assert.ok(q('#calcFilterNote').textContent.includes('ไม่เบิกจ่าย'));
 });
 t('ลูกศรขึ้นมากไปน้อย ลูกศรลงน้อยไปมาก และยอดรวมอยู่ท้าย',()=>{
  select('PAID');q('#calcOff [data-d="desc"]').click();assert.deepEqual(money(),money().slice().sort((a,b)=>b-a));assert.equal(money()[0],900);q('#calcOff [data-d="desc"]').click();assert.equal(money()[0],900);q('#calcOff [data-d="asc"]').click();assert.deepEqual(money(),money().slice().sort((a,b)=>a-b));assert.equal(q('#calcOff tbody').lastElementChild.className,'sum');
 });
 select('FREE_PENDING');q('#calcOff [data-d="desc"]').click();q('#calcPng').click();await tick();
 t('PNG ใช้ประเภทและลำดับเดียวกับตาราง ไม่ปนยอดประเภทอื่น',()=>{assert.ok(exported.subtitle.includes('หมายฟรีทั้งหมดที่ยังไม่เบิก'));assert.ok(exported.headers.at(-1).includes('ยอดพร้อมเสนอเบิก'));assert.equal(exported.rows[0].at(-1),'500.00');assert.equal(exported.rows.at(-1).at(-1),'800.00');assert.equal(exported.rows.at(-1).sum,true);});
 api.go('import');await tick();const meta=api.IM.meta;Object.assign(api.IM,{meta,kind:'ISSUE',headers:['คดี','ผู้รับ','ผู้วางเงิน','ผู้ส่ง','ชนิด','ราคา'],mapping:{case_no:'คดี',recipient:'ผู้รับ',payer:'ผู้วางเงิน',officer:'ผู้ส่ง',notice_kind:'ชนิด',amount:'ราคา'},keys:['case_no','recipient','officer','notice_kind'],opts:{},rows:[{'คดี':'TEST/2569','ผู้รับ':'คู่ความจำลองไม่แสดง','ผู้วางเงิน':'ชื่อผู้วางเงินจำลอง','ผู้ส่ง':'เจ้าหน้าที่จำลอง','ชนิด':'หมายทดสอบ','ราคา':0}],rowNos:[2],file:{name:'synthetic.xlsx',size:1,checksum:'test'},sheet:'Sheet'});api.drawMap();
 t('หน้าจับคู่ไม่มีช่องชื่อคู่ความ ผู้วางเงิน หรือตัวอย่างชื่อ และยังกันซ้ำได้',()=>{
  assert.equal(q('.msel[data-f="recipient"]'),null);assert.equal(q('.msel[data-f="payer"]'),null);assert.ok(!q('#imMap').textContent.includes('คู่ความจำลองไม่แสดง'));assert.ok(!q('#imMap').textContent.includes('ชื่อผู้วางเงินจำลอง'));
  const box=q('.kchk[data-f="notice_kind"]');box.checked=false;box.dispatchEvent(new w.Event('change'));assert.ok(api.IM.keys.includes('recipient'));const body=JSON.stringify(api.importBody());assert.ok(!body.includes('คู่ความจำลองไม่แสดง'));assert.ok(!body.includes('ชื่อผู้วางเงินจำลอง'));assert.ok(body.includes('R1-'));
 });
 console.log('ผ่าน '+checks+' ชุดทดสอบตัวกรอง ยอดเงิน และช่องนำเข้า');dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
