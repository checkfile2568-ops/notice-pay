// 0.7.19 ตัวเลขวิ่ง/แถบเลื่อนจากขวาไปซ้ายเมื่อเลื่อนเมาส์ผ่านหรือกด · ตรวจความสมดุลของตัวเลขหน้าสถิติ (ข้อมูลสมมติ)
const assert=require('assert'),fs=require('fs'),path=require('path');
const {JSDOM}=require(process.env.NP_JSDOM_PATH||'jsdom');const {g,call,props}=require('./harness');
g.setupSystem();props.PRINTHUB_DB_ID='PH';const auth=call('login',{code:'U001',pin:'1234'}).data;
for(const [id,first] of [['OF01','ผู้ส่ง ก'],['OF02','ผู้ส่ง ข'],['OF03','ไม่มีรายการ']]){const o=g.readTable_('OFFICERS').rows.find(o=>o.officer_id===id);o.first_name=first;g.updateRow_('OFFICERS',o._r,o);}
const n=(id,officer,extra={})=>Object.assign({notice_uid:id,fy:'2570',pay_type:'BUDGET',case_no:id+'/2569',notice_kind:'หมายทดสอบ',recipient:'ผู้รับจำลอง',officer_id:officer,issued_date:'2026-10-01',delivered_date:'2026-11-01',reported_date:'2026-11-02',calc_amount:'300',calc_rule:'SINGLE',budget_unit_id:id,claim_piece:id},extra);
g.appendRows_('NOTICES',[n('A1','OF01'),n('A2','OF01',{delivered_date:'',reported_date:'',calc_rule:'WAIT_DELIVERY'}),n('B1','OF02',{pay_type:'PAID',calc_amount:'600',amount_src:'600'}),n('B2','OF02',{payout_round_id:'R0'}),n('C1','OF03',{calc_amount:'500'})]);
g.appendRows_('PAYOUT_ROUNDS',[{round_id:'R0',status:'CONFIRMED',fy:'2570',round_type:'FREE',pay_date:'2026-11-03',total:'300'}]);
const html=fs.readFileSync(path.join(__dirname,'../web/index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
const dom=new JSDOM(html,{url:'http://localhost',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
w.NP_CONFIG={VERSION:'0.7.19',API_URL:'http://localhost/api'};w.matchMedia=()=>({matches:false});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
w.fetch=async(u,o)=>{const d=JSON.parse(o.body);return {json:async()=>call(d.action,d)}};
w.eval(fs.readFileSync(path.join(__dirname,'../web/import-formats.js'),'utf8'));
w.eval(fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8').replace(/\}\)\(\);\s*$/,'window.__T={S,go,enterApp};})();'));
const a=w.__T,tick=(ms)=>new Promise(r=>setTimeout(r,ms||80)),q=s=>w.document.querySelector(s),qa=s=>[...w.document.querySelectorAll(s)];
const N=s=>Number(String(s).replace(/[^\d.]/g,''))||0;
(async()=>{
  await tick();a.S.token=auth.token;a.S.user=auth.user;a.S.fy='2570';a.enterApp();await tick(200);a.go('home');await tick(900);
  // ความสมดุล: นอกงบฯ + งบประมาณ = รวม ทุกแถว · ผลรวมทุกแถว = การ์ดหมายทั้งหมด · แถบสถานะรวม 100%
  const rows=qa('#offTbl tbody tr');assert.ok(rows.length>=3,'มีแถวผู้ส่ง');
  let sum=0;rows.forEach(r=>{const c=r.querySelectorAll('td');const p=N(c[1].textContent),f=N(c[2].textContent),t=N(c[3].textContent);assert.equal(p+f,t,'แถว '+c[0].textContent+' นอกงบฯ+งบฯ=รวม');sum+=t;
    const segs=[...r.querySelectorAll('.stbar-in i')].map(i=>parseFloat(i.style.width));if(segs.length){const s=segs.reduce((x,y)=>x+y,0);assert.ok(Math.abs(s-100)<0.05,'แถบรวม 100% ได้ '+s);}});
  const tiles=qa('.kpi b[data-count]').map(b=>Number(b.dataset.count));
  assert.ok(tiles.includes(sum),'ผลรวมทุกแถว '+sum+' = การ์ดหมายทั้งหมด ('+tiles.join(',')+')');
  // เลื่อนเมาส์ผ่านแถว: ตัวเลขเริ่มจาก 0 แล้วจบที่ค่าจริง · แถบได้คลาส sweep
  const r0=rows.find(r=>N(r.querySelectorAll('td')[3].textContent)>0);const tot=r0.querySelector('b[data-rc]');const want=tot.textContent;
  r0.querySelector('td').dispatchEvent(new w.MouseEvent('mouseover',{bubbles:true}));await tick(20);
  assert.ok(N(tot.textContent)<N(want),'เริ่มนับจาก 0');assert.ok(r0.querySelector('.stbar-in').classList.contains('sweep'),'แถบเลื่อนจากขวาไปซ้าย');
  await tick(800);assert.equal(tot.textContent,want,'จบที่ค่าจริง');
  // กด (มือถือ) ที่การ์ด: ตัวเลขวิ่งใหม่และจบที่ค่าเดิม
  const card=q('.kpi b[data-count]');const cv=card.textContent;await tick(750);
  card.closest('.kpi').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));await tick(20);assert.notEqual(card.textContent,cv,'กดแล้วเริ่มนับใหม่');await tick(800);assert.equal(card.textContent,cv);
  // ตัวเลขในตารางไม่วิ่งตอนเปิดหน้า (คงเดิม) · มีเฉพาะเมื่อเลื่อนเมาส์/กด
  assert.ok(!q('#offTbl [data-count]'),'ตารางไม่ใช้ data-count (ไม่วิ่งตอนโหลด)');
  console.log('fx-0719: ผ่าน (สมดุล '+rows.length+' แถว รวม '+sum+' ฉบับ · ตัวเลขวิ่ง · แถบเลื่อน)');dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});
