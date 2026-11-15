const assert=require('assert'),F=require('../web/import-formats');
const {g,call,props,spreadsheets}=require('./harness');let n=0;function t(name,fn){fn();n++;console.log('✓ '+name);}
t('คำนำหน้าทุกกลุ่มใช้กฎเดียวกันและตัดไม่เกิน 2 คำ',()=>{
 for(const prefix of ['นาย','นาง','นางสาว','น.ส.','นส.','ด.ช.','ด.ญ.','เด็กชาย','เด็กหญิง','คุณ','ว่าที่ร้อยตรี','ว่าที่ ร้อยตรี','ดร.','นพ.','พญ.','พระครู','พระมหา','พระอธิการ','สามเณร','แม่ชี','Mr.','Mrs.','Ms.','Miss','พลตำรวจเอก','พันตำรวจตรี','สิบตำรวจเอก','พ.ต.อ.','ร.ต.ท.','ด.ต.','ส.ต.อ.','พลเรือเอก','นาวาอากาศโท','พันจ่าอากาศเอก','พ.อ.อ.','พล.อ.','จ.ส.อ.','พ.ต.อ.หญิง']){
  const r=F.redactNames('ส่งได้ '+prefix+' สมมติ นามทดสอบ รับแทน');assert.equal(r.text,'ส่งได้ [ตัดชื่อ] รับแทน',prefix);assert.equal(F.nameMatches(r.text).length,0);
 }
 assert.equal(F.redactNames('นาย สมมติ นามทดสอบ คงข้อความ').text,'[ตัดชื่อ] คงข้อความ');
 assert.equal(F.redactNames('นางสาวสมมติ นามทดสอบ รับแทน').text,'[ตัดชื่อ] รับแทน');assert.equal(F.nameMatches('Missing').length,0);
});
t('คงซอย ถนน พื้นที่และกฎหมายตามข้อยกเว้น',()=>{
 for(const s of ['ซอยนายเลิศ','ซอย นายเลิศ','ซ. นายสมมติ','ถนน คุณสมมติ','ถ. นางสมมติ','ต. นายสมมติ','อ. นายสมมติ','หมู่บ้าน นางสมมติ','พระราชบัญญัติ พ.ร.บ. พระราชกำหนด พระราชกฤษฎีกา'])assert.equal(F.redactNames(s).text,s);
 assert.equal(F.redactNames('นาย สมมติ พระราชบัญญัติทดสอบ').text,'[ตัดชื่อ] พระราชบัญญัติทดสอบ');
});
g.setupSystem();props.PRINTHUB_DB_ID='PH';const token=call('login',{code:'U001',pin:'1234'}).data.token,off=g.officersAll_()[0],area=g.readTable_('RATE_AREAS').rows[0];
const mapping={case_no:'เลขดำที่',recipient:'หมายถึงใคร',officer:'ผู้ส่งหมาย',issued_date:'วันที่จ่ายหมาย',delivered_date:'วันที่ส่งหมาย',result:'ผลการส่งหมาย',pay_type:'ประเภท',tambon:'ตำบล',amphoe:'อำเภอ',house_no:'บ้าน',moo:'หมู่',notice_kind:'ชนิด',amount:'ราคา'};
const row={'เลขดำที่':'TEST078/2569','หมายถึงใคร':'นาย ผู้รับสมมติ','ผู้ส่งหมาย':off.name,'วันที่จ่ายหมาย':'1/11/2569','วันที่ส่งหมาย':'6/11/2569','ผลการส่งหมาย':'ส่งได้','ประเภท':'ฟรี','ตำบล':area.tambon_name,'อำเภอ':area.amphoe_name,'บ้าน':'23','หมู่':'4','ชนิด':'หมายทดสอบ','ราคา':0};
const req={token,kind:'ISSUE',mapping,key_fields:['case_no','recipient','officer','notice_kind','house_no','moo'],options:{},file:{name:'synthetic.xlsx'},rows:[row]};
t('หลังบ้านกั้นชื่อในผลและช่องส่วนเกินก่อน journal และการบันทึก',()=>{
 const before=g.digestJson_(g.privacyReadAll_(g.db_()));
 for(const extra of [{'ผลการส่งหมาย':'ส่งได้ นาย ผลสมมติ นามทดสอบ รับแทน'},{หมายเหตุที่ไม่ได้จับคู่:'นางสาว หมายเหตุสมมติ นามทดสอบ'},{other:{nested:'Mr. John Example'}}]){
  const result=call('import_commit',{...req,rows:[{...row,...extra}]});assert.equal(result.code,'BAD_REQUEST');assert.ok(!result.msg.includes('สมมติ')&&!result.msg.includes('John'));assert.equal(g.digestJson_(g.privacyReadAll_(g.db_())),before);
 }
 const ledger=call('ledger_import',{token,kind:'PAY',commit:true,rows:[{case_no:'TEST078/2569',recipient:'ผู้รับสมมติ',officer:off.name,result:'นาย ผลสมมติ นามทดสอบ',amount:300}]});assert.equal(ledger.code,'BAD_REQUEST');assert.equal(g.digestJson_(g.privacyReadAll_(g.db_())),before);
});
t('ข้อยกเว้นผู้ส่ง เลขคดี R1 และสถานที่ผ่าน และไฟล์สะอาดซ้ำเป็นเดิม',()=>{
 const safe={...row,'ประเภท':'มีเงิน','ราคา':area.rate,'ผลการส่งหมาย':'ส่งได้ [ตัดชื่อ] รับแทน','ที่ตั้ง':'ซอยนายเลิศ พระราชบัญญัติทดสอบ'};
 const first=call('import_commit',{...req,rows:[safe]});assert.ok(first.ok,JSON.stringify(first));
 const repeat=call('import_preview',{...req,rows:[F.mapped(safe,mapping)]});assert.ok(repeat.ok,JSON.stringify(repeat));assert.equal(repeat.data.counts.SAME,1);
 const change=call('import_preview',{...req,rows:[{...safe,'ผลการส่งหมาย':'ส่งได้ [ตัดชื่อ]'}]});assert.ok(change.ok);assert.equal(change.data.counts.CHANGED,1);
 const staff=g.normalizeIncomingImport_({action:'import_preview',mapping,rows:[{...safe,'ผู้ส่งหมาย':'นาย เจ้าหน้าที่สมมติ นามทดสอบ'}]});assert.equal(staff.rows[0]['ผู้ส่งหมาย'],'นาย เจ้าหน้าที่สมมติ นามทดสอบ');
});
g.readTable_('NOTICES').rows.forEach(r=>{r.result='ส่งได้ นางสาว ผลเดิมสมมติ นามทดสอบ รับแทน';g.updateRow_('NOTICES',r._r,r);});
g.appendRows_('IMPORT_REVIEW',[{review_id:'SYN078',raw_json:JSON.stringify({'ผลการส่งหมาย':'นาย ข้อความสมมติ นามทดสอบ รับแทน','ผู้ส่งหมาย':'นาย เจ้าหน้าที่สมมติ','เลขดำที่':'นาย เลขคดีคงเดิม/2569','หมายเหตุ':'ซอยนายเลิศ'})}]);
const before=g.privacyReadAll_(g.db_()),plan=g.freeTextPlan078_(before);
t('ตรวจฐานอ่านอย่างเดียวและแผนล้างไม่เปลี่ยนยอด รหัส หรือผู้ส่ง',()=>{
 const hash=g.digestJson_(before),audit=g.freeTextAudit078_(before);assert.equal(audit.notice_rows,1);assert.equal(audit.review_rows,1);assert.equal(g.digestJson_(g.privacyReadAll_(g.db_())),hash);assert.equal(g.freeTextInvariant078_(before),g.freeTextInvariant078_(plan.tables));assert.equal(g.privacyFinancial_(before),g.privacyFinancial_(plan.tables));assert.equal(plan.tables.NOTICES[0].result,'ส่งได้ [ตัดชื่อ] รับแทน');assert.equal(plan.remaining.notice_points,0);assert.equal(plan.remaining.review_points,0);assert.equal(JSON.parse(plan.tables.IMPORT_REVIEW[0].raw_json)['ผู้ส่งหมาย'],'นาย เจ้าหน้าที่สมมติ');assert.equal(g.freeTextPlan078_(plan.tables).changes.notice_rows,0);
});
const saved=g.db_().getSheets().map(sh=>({name:sh.getName(),data:JSON.parse(JSON.stringify(sh.data))}));spreadsheets.BACKUP078={getSheets:()=>saved.map(sh=>({getName:()=>sh.name,getLastRow:()=>sh.data.length,getLastColumn:()=>Math.max(0,...sh.data.map(r=>r.length)),getRange:(r,c,nr,nc)=>({getValues:()=>Array.from({length:nr},(_,i)=>Array.from({length:nc},(_,j)=>sh.data[r-1+i]?.[c-1+j]??''))})}))};g.SpreadsheetApp.flush=()=>{};
t('hash ผิดห้ามเขียน และเขียนสะดุดต้องคืนค่าเดิม',()=>{
 assert.throws(()=>g.applyFreeTextCleanup078('BACKUP078','WRONG'));
 const rewrite=g.rewriteTable_;let once=true;g.rewriteTable_=function(k,rs){if(k==='IMPORT_REVIEW'&&once){once=false;throw Error('SIMULATED');}return rewrite(k,rs);};assert.throws(()=>g.applyFreeTextCleanup078('BACKUP078',g.digestJson_(before)),/SIMULATED/);g.rewriteTable_=rewrite;assert.equal(g.digestJson_(g.privacyReadAll_(g.db_())),g.digestJson_(before));
});
t('สำรองตรงแล้วล้างได้ อ่านกลับไม่เหลือชื่อและยอดเดิม',()=>{
 const log=g.console.log;g.console.log=()=>{};const result=g.applyFreeTextCleanup078('BACKUP078',g.digestJson_(before));g.console.log=log;assert.equal(result.financial_unchanged,true);assert.equal(result.calculation_unchanged,true);assert.equal(result.remaining.notice_points,0);assert.equal(result.remaining.review_points,0);assert.equal(g.privacyFinancial_(g.privacyReadAll_(g.db_())),g.privacyFinancial_(before));
});
console.log('ผ่าน '+n+' ชุดทดสอบข้อความอิสระ 0.7.8');
