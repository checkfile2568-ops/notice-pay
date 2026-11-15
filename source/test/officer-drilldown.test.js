const assert=require('assert'),fs=require('fs'),path=require('path');
const {JSDOM}=require(process.env.NP_JSDOM_PATH||'jsdom');const {g,call,props}=require('./harness');
g.setupSystem();props.PRINTHUB_DB_ID='PH';const auth=call('login',{code:'U001',pin:'1234'}).data;
for(const [id,first] of [['OF01','ผู้ส่ง ก'],['OF02','ผู้ส่ง ข'],['OF03','ไม่มีรายการ']]){const o=g.readTable_('OFFICERS').rows.find(o=>o.officer_id===id);o.first_name=first;g.updateRow_('OFFICERS',o._r,o);}
const n=(id,officer,extra={})=>Object.assign({notice_uid:id,fy:'2570',pay_type:'BUDGET',case_no:id+'/2569',notice_kind:'หมายทดสอบ',recipient:'ผู้รับจำลอง',officer_id:officer,issued_date:'2026-10-01',delivered_date:'2026-11-01',reported_date:'2026-11-02',calc_amount:'300',calc_rule:'SINGLE',budget_unit_id:id,claim_piece:id},extra);
g.appendRows_('NOTICES',[
 n('CASE-A','OF01',{calc_rule:'ONE_SAME',budget_unit_id:'UNIT-A',claim_piece:'UNIT-A'}),n('CASE-B','OF01',{calc_rule:'ONE_SAME',budget_unit_id:'UNIT-A',claim_piece:'UNIT-A',calc_amount:'0'}),
 n('WAIT-A','OF01',{delivered_date:'',reported_date:'',calc_rule:'WAIT_DELIVERY'}),n('REVIEW-A','OF01',{calc_rule:'REVIEW_RATE'}),n('CLOSED-A','OF01',{noclaim_at:'2026-11-13'}),
 n('CASE-C','OF02',{calc_amount:'500'}),n('WAIT-B','OF02',{delivered_date:'',reported_date:'',calc_rule:'WAIT_DELIVERY'}),n('CLAIMED-A','OF01',{payout_round_id:'OLD'})]);
g.appendRows_('PAYOUT_ROUNDS',[{round_id:'OLD',status:'CONFIRMED',fy:'2570',round_type:'FREE',pay_date:'2026-11-03',total:'300'}]);
const html=fs.readFileSync(path.join(__dirname,'../web/index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
const dom=new JSDOM(html,{url:'http://localhost',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
w.NP_CONFIG={VERSION:'0.7.4',API_URL:'http://localhost/api'};w.matchMedia=()=>({matches:false});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.print=()=>{};
let urls=[];w.URL.createObjectURL=b=>{urls.push(b);return 'blob:test'};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=()=>{};
w.fetch=async(u,o)=>{const d=JSON.parse(o.body);return {json:async()=>call(d.action,d)}};
w.eval(fs.readFileSync(path.join(__dirname,'../web/import-formats.js'),'utf8'));
w.eval(fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8').replace(/\}\)\(\);\s*$/,'window.__TEST={S,go};})();'));
const api=w.__TEST,tick=()=>new Promise(r=>setTimeout(r,50)),q=s=>w.document.querySelector(s);
const run=async()=>{q('#closeForm').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));await tick();};
const choose=id=>q('[data-close-officer="'+id+'"] button').click();
const filter=value=>{q('#closeStatus').value=value;q('#closeStatus').dispatchEvent(new w.Event('change'));};
const text=()=>q('#closeRows').textContent;
(async()=>{
 await tick();api.S.token=auth.token;api.S.user=auth.user;api.S.fy='2570';api.go('reports');await tick();await run();
 assert.equal(q('#closeOfficers tbody').rows.length,g.readTable_('OFFICERS').rows.length);assert.ok(q('[data-close-officer="OF03"]'));assert.ok(q('#closePrint').disabled);assert.equal(q('#closeRows').textContent,'');console.log('✓ ตารางรวมครบทุกคน รวมคนไม่มีรายการ และเริ่มด้วยคำแนะนำเลือกชื่อ');
 choose('OF01');assert.equal(q('#closeStatus').value,'');assert.ok(text().includes('WAIT-A'));assert.ok(text().includes('REVIEW-A'));assert.ok(text().includes('CLOSED-A'));assert.ok(q('#closeSelection').textContent.includes('5 ฉบับ'));filter('READY');assert.ok(text().includes('CASE-A'));assert.ok(text().includes('CASE-B'));assert.ok(!text().includes('CASE-C'));assert.ok(!text().includes('CLAIMED-A'));assert.ok(q('#closeSelection').textContent.includes('2 ฉบับ'));assert.ok(q('#closeSelection').textContent.includes('1 หน่วยเบิก'));assert.ok(q('#closeSelection').textContent.includes('300.00'));assert.equal(q('[data-close-officer="OF01"] button').getAttribute('aria-pressed'),'true');console.log('✓ แตะชื่อกรองคนตามรหัส คงหน่วยเบิกเดิม และตัดหมายเบิกแล้ว');
 q('#closeBalance').value='900';q('#closeBalance').dispatchEvent(new w.Event('input'));assert.ok(q('#closeBudget').textContent.includes('ยอดรวมทุกคน'));assert.ok(q('#closeBudget').textContent.includes('800.00'));assert.ok(q('#closeBudget').textContent.includes('100.00'));console.log('✓ งบรวมยังเทียบกับทุกคน ไม่เปลี่ยนตามชื่อที่เลือก');
 q('#closePrint').click();await tick();assert.ok(q('#printArea').textContent.includes('CASE-A'));assert.ok(!q('#printArea').textContent.includes('CASE-C'));assert.ok(q('#printArea').textContent.includes('300.00'));console.log('✓ พิมพ์เฉพาะชื่อและสถานะที่เลือก ยอดในใบพิมพ์ตรงรายการ');
 q('#closeCsv').click();await tick();const csv=await new Promise(resolve=>{const reader=new w.FileReader();reader.onload=()=>resolve(reader.result);reader.readAsText(urls.at(-1));});assert.ok(csv.includes('CASE-A'));assert.ok(!csv.includes('CASE-C'));console.log('✓ CSV มีเฉพาะรายการของคนที่เลือก');
 filter('WAIT');assert.ok(text().includes('WAIT-A'));assert.ok(!text().includes('WAIT-B'));assert.ok(q('#closeSelection').textContent.includes('ยังไม่รวมในยอดพร้อมเสนอเบิก'));filter('REVIEW');assert.ok(text().includes('REVIEW-A'));filter('NOCLAIM');assert.ok(text().includes('CLOSED-A'));assert.ok(!q('#closeSelection').textContent.includes('0.00 บาท'));assert.equal(q('#closeStatus').selectedOptions[0].textContent,'ไม่เบิกจ่าย');console.log('✓ แยกรอผล รอตรวจ และไม่เบิกจ่ายภายในคนเดียวกันได้');
 choose('OF02');assert.equal(q('#closeStatus').value,'');assert.ok(text().includes('CASE-C'));assert.ok(!text().includes('CASE-A'));choose('OF03');assert.ok(q('#closePrint').disabled);assert.ok(text().includes('ไม่พบรายการ'));console.log('✓ เปลี่ยนชื่อไม่ปนรายการ คนไม่มีรายการแสดงผลว่างชัดเจน');
 q('#closeAll').click();assert.ok(text().includes('CASE-A'));assert.ok(text().includes('CASE-C'));assert.ok(q('#closeSelection').textContent.includes('800.00'));console.log('✓ กลับดูรายการทุกคนและยอดรวมได้');
 for(const id of ['CASE-A','CASE-B']){const r=g.readTable_('NOTICES').rows.find(r=>r.notice_uid===id);r.payout_round_id='OLD';g.updateRow_('NOTICES',r._r,r);}
 await run();choose('OF01');assert.ok(!text().includes('CASE-A'));assert.ok(text().includes('WAIT-A'));assert.ok(!q('#closePrint').disabled);console.log('✓ กดตรวจสอบใหม่ รายการที่เบิกเพิ่มแล้วหายจากยอดคงค้าง');
 dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
