const assert=require('assert'), fs=require('fs'), vm=require('vm'), crypto=require('crypto');
const F=require('../web/import-formats.js');
const {g,call,props}=require('./harness');
const XLSX=require(process.env.NP_XLSX_PATH||'xlsx');
let count=0;function t(n,fn){fn();count++;console.log('✓ '+n);}
t('SHA-256 UTF-8 ตรงมาตรฐานและรหัสเดิมไม่ถูกแฮชซ้ำ',()=>{
 for(const x of ['', 'abc','ชื่อสมมติ', 'x'.repeat(300)])assert.equal(F.sha256(x),crypto.createHash('sha256').update(x).digest('hex').toUpperCase());
 const p=F.recipient('ทดสอบ/2569','นาย ผู้รับสมมติ');assert.equal(F.recipient('ทดสอบ/2569',p),p);
 assert.equal(p,F.recipient('ทดสอบ/2569','ผู้รับสมมติ'));assert.notEqual(p,F.recipient('อื่น/2569','ผู้รับสมมติ'));
});
t('วันที่ไทย ISO พร้อมเวลา และปีอธิกสุรทินเป็นรูปแบบเดียวกัน',()=>{
 for(const v of ['6/11/2569','๖/๑๑/๒๕๖๙','6 พ.ย. 69','6 พฤศจิกายน 2026','2026-11-06T23:59:59+07:00',46332])assert.equal(F.date(v),'2026-11-06');
 for(const v of ['31/2/2569','11/6/26','2026-11-06garbage','6/13/2569',60,Infinity])assert.equal(F.date(v),null);
 assert.equal(F.date('29/2/2567'),'2024-02-29');assert.equal(F.date('29/2/2569'),null);
});
t('Excel จริงชนิดวันที่และเลขอนุกรม ทั้งระบบ 1900 และ 1904',()=>{
 for(const date1904 of [false,true])for(const [day,serial] of [[6,46332],[13,46339]]) {
  const wb=XLSX.utils.book_new(), ws=XLSX.utils.aoa_to_sheet([['วันที่จ่าย'],[serial-(date1904?1462:0)]]);
  ws.A2.z='m/d/yy';wb.Workbook={WBProps:{date1904}};XLSX.utils.book_append_sheet(wb,ws,'Sheet');
  const loaded=XLSX.read(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),{type:'array',cellDates:false});
  const v=XLSX.utils.sheet_to_json(loaded.Sheets.Sheet,{header:1,raw:true})[1][0];
  assert.equal(F.date(v,loaded.Workbook.WBProps.date1904),'2026-11-'+day.toString().padStart(2,'0'));
 }
});
g.setupSystem();props.PRINTHUB_DB_ID='PH';const token=call('login',{code:'U001',pin:'1234'}).data.token;
const C=(a,d)=>{const r=call(a,{token,...d});assert.ok(r.ok,a+': '+JSON.stringify(r));return r.data;};
const officer=g.officersAll_()[0], area=g.readTable_('RATE_AREAS').rows[0];
const mapping={case_no:'case',recipient:'recipient',officer:'officer',issued_date:'issued',delivered_date:'sent',reported_date:'reported',pay_type:'type',tambon:'tambon',amphoe:'amphoe',house_no:'house',moo:'moo',notice_kind:'kind',amount:'amount',payer:'payer'};
const row={case:'TEST-PRIVACY/2569',recipient:'นาย ผู้รับสมมติ',officer:officer.name,issued:'1/11/2569',sent:'6/11/2569',reported:'7/11/2569',type:'มีเงิน',tambon:area.tambon_name,amphoe:area.amphoe_name,house:'23/1',moo:'4',kind:'หมายทดสอบ',amount:area.rate,payer:'โจทก์ชื่อสมมติ',plaintiff:'ชื่อโจทก์ไม่ส่ง',defendant:'ชื่อจำเลยไม่ส่ง'};
const req={kind:'ISSUE',mapping,key_fields:['case_no','recipient','officer','notice_kind','house_no','moo'],options:{},rows:[row],file:{name:'synthetic.xlsx',checksum:'test'}};
t('ตัดชื่อและคอลัมน์ส่วนเกินก่อนส่งและก่อนบันทึก journal',()=>{
 const outgoing=F.mapped(row,mapping);const json=JSON.stringify(outgoing);
 for(const s of ['ผู้รับสมมติ','โจทก์ชื่อสมมติ','ชื่อโจทก์ไม่ส่ง','ชื่อจำเลยไม่ส่ง'])assert.ok(!json.includes(s));
 assert.equal(outgoing.issued,'2026-11-01');assert.equal(outgoing.payer,'มีผู้วางเงิน');
 C('import_commit',req);assert.equal(g.readTable_('NOTICES').rows.length,1);
 for(const name of ['NOTICES','IMPORT_REVIEW','OPERATIONS','OP_SNAPSHOTS']){
  const text=JSON.stringify(g.readTable_(name).rows);assert.ok(!text.includes('ผู้รับสมมติ'),name);assert.ok(!text.includes('โจทก์ชื่อสมมติ'),name);
 }
});
t('นำเข้าซ้ำทั้งชื่อเดิมและรหัสจับคู่ไม่สร้างหมายเพิ่ม',()=>{
 assert.equal(C('import_preview',req).counts.SAME,1);
 C('import_commit',{...req,rows:[F.mapped(row,mapping)]});assert.equal(g.readTable_('NOTICES').rows.length,1);
});
t('คดีเดียวกันต่างผู้รับไม่ถูกยุบเป็นฉบับเดียว',()=>{
 const req2={...req,rows:[{...row,recipient:'นาง ผู้รับอีกคน'}]};assert.equal(C('import_preview',req2).counts.NEW,1);C('import_commit',req2);assert.equal(g.readTable_('NOTICES').rows.length,2);
});
t('บัญชี 30 จับคู่รหัสใหม่และรับวันที่มาตรฐานได้',()=>{
 const r={case_no:row.case,recipient:row.recipient,officer:officer.name,amount:500,pay_date:46332,received_date:'๖/๑๑/๒๕๖๙',receipt_no:'SYNTHETIC-1'};
 const normalized=g.normalizeIncomingImport_({action:'ledger_import',rows:[r]}).rows[0];assert.equal(normalized.pay_date,'2026-11-06');
 assert.equal(g.ledgerMatch_([normalized],g.readTable_('NOTICES').rows,g.officersAll_(),'PAID')[0].match,'OK');
 C('ledger_import',{kind:'PAY',rows:[r],commit:true});assert.ok(!JSON.stringify(g.readTable_('LEDGER').rows).includes('ผู้รับสมมติ'));
 assert.equal(call('ledger_import',{token,kind:'PAY',rows:[{...r,received_date:'31/2/2569'}]}).code,'BAD_REQUEST');
});
t('รายการเดิมที่เก็บชื่อยังจับคู่และคง UID กับรอบเดิม',()=>{
 const oldRow={...row,case:'LEGACY/2569',recipient:'นาง ผู้รับเดิม'};
 const rec=g.toRecord_(oldRow,mapping,{},g.buildOfficerIndex_(g.officersAll_()),g.buildAreaIndex_(g.readTable_('RATE_AREAS').rows));
 const uid=g.keyOf_(rec,req.key_fields);
 g.appendRows_('NOTICES',[{...rec,notice_uid:uid,recipient:rec.recipient_disp,fy:'2570',row_hash:g.hashOf_(rec,['pay_type','case_no','case_ref','red_no','notice_no','notice_kind','recipient','house_no','moo','tambon','amphoe','address_text','officer_id','issued_date','amount_src','payer']),result_hash:g.hashOf_(rec,['delivered_date','result']),payout_round_id:'OLD-CONFIRMED'}]);
 const p=C('import_preview',{...req,rows:[oldRow]});assert.equal(p.counts.SAME,1);assert.equal(p.counts.NEW,0);
 const r=g.ledgerMatch_([{case_no:oldRow.case,recipient:F.recipient(oldRow.case,oldRow.recipient),officer:officer.name}],g.readTable_('NOTICES').rows,g.officersAll_(),'PAID')[0];assert.equal(r.match,'OK');assert.equal(r.notice_uids[0],uid);
});
t('ประวัติรอบใช้ตัดสินสถานะแม้ pointer หาย และวันสุดท้ายรวมเวลาทั้งวัน',()=>{
 const n={notice_uid:'NO-POINTER',fy:'2570',pay_type:'BUDGET',issued_date:'2026-10-01',delivered_date:'2026-11-06T23:59:59',calc_amount:'300',calc_rule:'SINGLE'};
 g.appendRows_('NOTICES',[n]);g.appendRows_('PAYOUT_ROUNDS',[{round_id:'HISTORY-ONLY',fy:'2570',status:'CONFIRMED',payment_status:'PAID',pay_date:'2026-11-07',total:'300'}]);g.appendRows_('PAYOUT_ITEMS',[{round_id:'HISTORY-ONLY',notice_uids:n.notice_uid,included:true,amount:'300'}]);
 const r=C('tracking',{from:'2026-11-06',to:'2026-11-06'}).rows.find(r=>r.notice_uid===n.notice_uid);assert.equal(r.status,'PAID');assert.equal(r.round_id,'HISTORY-ONLY');
 assert.equal(call('tracking',{token,from:'2026-11-07',to:'2026-11-06'}).code,'BAD_REQUEST');
});
t('หมายฟรีก่อนปีงบไม่พร้อมเบิก แต่หมายมีเงินยังทำงานเดิม',()=>{
 for(const pay_type of ['BUDGET','PAID'])g.appendRows_('NOTICES',[{notice_uid:'OLD-'+pay_type,fy:'2570',pay_type,issued_date:'2026-09-30',delivered_date:'2026-11-06',calc_amount:'300',calc_rule:'PRE_START'}]);
 const r=C('tracking',{}).rows;const free=r.find(x=>x.notice_uid==='OLD-BUDGET');assert.equal(free.status,'NOCLAIM');assert.equal(free.amount,0);assert.equal(free.difference,null);assert.notEqual(r.find(x=>x.notice_uid==='OLD-PAID').status,'NOCLAIM');
});
console.log('ผ่าน '+count+' ชุดทดสอบวันที่ ความเป็นส่วนตัว และสถานะ');
