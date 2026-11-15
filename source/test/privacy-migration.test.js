const assert=require('assert');const {g,call,props,spreadsheets}=require('./harness');
g.setupSystem();props.PRINTHUB_DB_ID='PH';const token=call('login',{code:'U001',pin:'1234'}).data.token;
const off=g.officersAll_()[0],area=g.readTable_('RATE_AREAS').rows[0],uid='TEST/2569|ผู้รับจำลอง|'+off.officer_id+'|หมายทดสอบ|23,24|4';
g.appendRows_('NOTICES',[{notice_uid:uid,case_no:'TEST/2569',fy:'2570',pay_type:'BUDGET',recipient:'นาย ผู้รับจำลอง',payer:'',officer_id:off.officer_id,officer_raw:off.name,area_id:area.area_id,tambon:area.tambon_name,amphoe:area.amphoe_name,issued_date:'2026-10-01',delivered_date:'2026-11-06',reported_date:'2026-11-07',calc_rule:'SINGLE',calc_amount:'300',house_no:'23',moo:'4',place_key:'ม.4',addr_type:'MOO',notice_kind:'หมายทดสอบ',budget_unit_id:'LOCKED',payout_round_id:'CONFIRMED'}]);
g.appendRows_('BUDGET_UNITS',[{unit_id:'LOCKED',notice_uids:uid,fy:'2570',officer_id:off.officer_id,status:'CLAIMED',locked:true,amount:'300',payout_round_id:'CONFIRMED'}]);
g.appendRows_('PAYOUT_ROUNDS',[{round_id:'CONFIRMED',fy:'2570',total:'300',carry_out:'7.25',status:'CONFIRMED',round_type:'FREE',lines_json:'[]'}]);
g.appendRows_('PAYOUT_ITEMS',[{round_id:'CONFIRMED',item_key:'N:'+uid,item_type:'BUDGET',notice_uids:uid,included:true,amount:'300'}]);
g.appendRows_('LEDGER',[{ledger_id:'L',source:'PAY',case_no:'TEST/2569',recipient:'นาย ผู้รับจำลอง',notice_uids:uid,amount:'300',pay_date:'2026-11-06',round_id:'CONFIRMED'}]);
g.appendRows_('IMPORT_REVIEW',[{batch_id:'B',row_no:'2',notice_uid:uid,raw_json:JSON.stringify({'เลขดำที่':'TEST/2569','หมายถึงใคร':'นาย ผู้รับจำลอง','โจทก์':'นาย โจทก์จำลอง','จำเลย':'นาง จำเลยจำลอง','ผู้วางเงิน':'นาย โจทก์จำลอง'})}]);
g.appendRows_('NOTICE_CHANGES',[{notice_uid:uid,field:'recipient',old_value:'นาย ผู้รับจำลอง',new_value:'นาง ผู้รับเก่าจำลอง'}]);
g.appendRows_('AUDIT',[{action:'TEST',target:uid,detail:JSON.stringify({notice_uid:uid,recipient:'นาย ผู้รับจำลอง'})}]);
g.journalChunks_('OLD-REQUEST','NOTICES',g.readTable_('NOTICES').rows);
g.journalChunks_('OLD-REQUEST','__request__',{mapping:{recipient:'หมายถึงใคร',case_no:'เลขดำที่'},rows:[{'เลขดำที่':'TEST/2569','หมายถึงใคร':'นาย ผู้รับจำลอง','โจทก์':'นาย โจทก์จำลอง'}]});
let n=0;function t(name,fn){fn();n++;console.log('✓ '+name);}
const before=g.privacyReadAll_(g.db_()),plan=g.privacyPlan_(before),next=plan.tables,newUid=plan.uid_map[uid];
t('รหัสเดิมมีจุลภาคต้องอ่านเต็มฉบับและคงการล็อกหน่วยเดิม',()=>{
 assert.equal(uid.split(',').length,2);const parse=g.privacyListParser_(before.NOTICES);assert.equal(parse(uid).uids[0],uid);assert.equal(parse(uid).unresolved,0);assert.equal(g.privacyCalcOptions_(before).locked.LOCKED.notice_uids[0],uid);
});
t('เปลี่ยน UID พร้อมเชื่อมรอบ หน่วยเบิก บัญชี และ Audit',()=>{
 assert.ok(/^N1-[A-F0-9]{64}$/.test(newUid));for(const x of [next.NOTICES[0].notice_uid,next.BUDGET_UNITS[0].notice_uids,next.PAYOUT_ITEMS[0].notice_uids,next.LEDGER[0].notice_uids,next.NOTICE_CHANGES[0].notice_uid])assert.equal(x,newUid);
 assert.equal(next.PAYOUT_ITEMS[0].item_key,'N:'+newUid);assert.ok(!JSON.stringify(next).includes(uid));assert.equal(next.PAYOUT_ROUNDS[0].carry_out,'7.25');
});
t('ชื่อคู่ความหายจาก raw JSON และข้อมูลกู้คืน ไม่แตะชื่อผู้ส่ง',()=>{
 const s=JSON.stringify(next);for(const name of ['ผู้รับจำลอง','โจทก์จำลอง','จำเลยจำลอง','ผู้รับเก่าจำลอง'])assert.ok(!s.includes(name),name);
 assert.equal(next.NOTICES[0].officer_raw,off.name);assert.equal(JSON.stringify(next.OFFICERS),JSON.stringify(before.OFFICERS));
 const req=next.OP_SNAPSHOTS.filter(x=>x.table_name==='__request__').sort((a,b)=>Number(a.seq)-Number(b.seq)).map(x=>JSON.parse(x.payload)).join('');assert.equal(JSON.parse(req).mapping.recipient,'หมายถึงใคร');assert.ok(JSON.parse(req).rows[0]['หมายถึงใคร'].startsWith('R1-'));
});
t('ลบชื่อซ้ำได้โดยไม่เปลี่ยนรหัสอีก และยอดการเงินตรงเดิม',()=>{const again=g.privacyPlan_(next);assert.equal(again.stats.ids,0);assert.equal(again.tables.NOTICES[0].notice_uid,newUid);assert.equal(g.privacyFinancial_(before),g.privacyFinancial_(next));assert.deepEqual(JSON.parse(JSON.stringify(g.privacyReferenceCheck_(next))),{BUDGET_UNITS:0,PAYOUT_ITEMS:0,LEDGER:0});assert.equal(g.privacyCalcCompare_(before,next,plan.uid_map).equal,true);});
const data=g.db_().getSheets().map(sh=>({name:sh.getName(),rows:JSON.parse(JSON.stringify(sh.data))}));
spreadsheets.BACKUP={getSheets:()=>data.map(s=>({getName:()=>s.name,getLastRow:()=>s.rows.length,getLastColumn:()=>Math.max(0,...s.rows.map(r=>r.length)),getRange:(r,c,nr,nc)=>({getValues:()=>Array.from({length:nr},(_,i)=>Array.from({length:nc},(_,j)=>s.rows[r-1+i]?.[c-1+j]??''))})}))};
g.SpreadsheetApp.flush=()=>{};
t('ห้ามเขียนถ้า hash เปลี่ยนหรือสำรองไม่ตรง',()=>{assert.throws(()=>g.privacyMigrationApply_('BACKUP','WRONG'));assert.equal(g.readTable_('NOTICES').rows[0].notice_uid,uid);});
t('เขียนสะดุดแล้วคืนข้อมูลและรหัสเดิมครบทุกตาราง',()=>{
 const fn=g.rewriteTable_;let once=true;
 g.rewriteTable_=function(k,rows){if(k==='PAYOUT_ITEMS'&&once){once=false;throw new Error('SIMULATED WRITE FAILURE');}return fn(k,rows);};
 assert.throws(()=>g.privacyMigrationApply_('BACKUP',g.digestJson_(before)),/SIMULATED WRITE FAILURE/);g.rewriteTable_=fn;
 assert.equal(g.digestJson_(g.privacyReadAll_(g.db_())),g.digestJson_(before));
});
t('บันทึกและคำนวณจริงบนฐานจำลอง พร้อมรักษายอดรอบและ import เดิม',()=>{
 const old=g.console.log;g.console.log=()=>{};const out=g.privacyMigrationApply_('BACKUP',g.digestJson_(before));g.console.log=old;
 assert.equal(out.mode,'APPLIED');assert.equal(out.financial_unchanged,true);assert.equal(out.remaining_recipient_names,0);assert.equal(g.readTable_('NOTICES').rows[0].notice_uid,newUid);assert.equal(g.readTable_('PAYOUT_ROUNDS').rows[0].total,'300');
 const match=g.ledgerMatch_([{case_no:'TEST/2569',recipient:'นาย ผู้รับจำลอง',officer:off.name}],g.readTable_('NOTICES').rows,g.officersAll_(),'BUDGET')[0];assert.equal(match.match,'OK');assert.equal(match.notice_uids[0],newUid);
 const mapping={case_no:'case',recipient:'party',officer:'officer',issued_date:'issued',delivered_date:'sent',pay_type:'type',tambon:'tambon',amphoe:'amphoe',house_no:'house',moo:'moo',notice_kind:'kind',amount:'amount'};
 const res=call('import_preview',{token,kind:'ISSUE',mapping,key_fields:['case_no','recipient','officer','notice_kind','house_no','moo'],rows:[{case:'TEST/2569',party:'นาย ผู้รับจำลอง',officer:off.name,issued:'2026-10-01',sent:'2026-11-06',type:'ฟรี',tambon:area.tambon_name,amphoe:area.amphoe_name,house:'23',moo:'4',kind:'หมายทดสอบ',amount:0}],options:{},file:{name:'synthetic.xlsx'}});
 assert.ok(res.ok,JSON.stringify(res));assert.equal(res.data.counts.NEW||0,0);
});
console.log('ผ่าน '+n+' ชุดทดสอบลบชื่อย้อนหลัง');
