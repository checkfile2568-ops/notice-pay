/** One-time owner utility: remove party names, preserve financial records and links. No API route. */
function privacyUid_(uid) {
  uid=String(uid||'');
  return !uid || /^N1-[A-F0-9]{64}$/.test(uid) ? uid : 'N1-'+NoticeImportFormat.sha256('NoticePay/notice/v1\n'+uid);
}
function privacyReadAll_(ss) {
  const out={};
  ss.getSheets().forEach(function(sh) {
    const nr=sh.getLastRow(), nc=sh.getLastColumn(); if(!nr||!nc)return;
    const grid=sh.getRange(1,1,nr,nc).getValues(),head=grid.shift().map(function(x){return String(x).trim();});
    if (!SHEETS[sh.getName()]) {
      if(grid.some(function(r){return r.some(function(v){return v!=='';});}))throw new Error('มีข้อมูลในชีตนอกโครงสร้าง ต้องตรวจสอบก่อน');
      return;
    }
    out[sh.getName()]=grid.map(function(r){const o={};head.forEach(function(h,i){if(h)o[h]=cellGet_(r[i]);});return o;});
  });
  Object.keys(SHEETS).forEach(function(k){if(!out[k])throw new Error('ไม่พบตาราง '+k);});
  return out;
}
function privacyRegex_(words) {
  const a=Array.from(new Set(words)).filter(Boolean).sort(function(a,b){return b.length-a.length;});
  return a.length ? new RegExp(a.map(function(x){return x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}).join('|'),'g') : null;
}
/** Legacy IDs may contain commas in a recipient/address. Match whole known IDs first. */
function privacyListParser_(notices) {
  const pattern=privacyRegex_(notices.map(function(n){return String(n.notice_uid||'');}));
  const re=pattern?new RegExp('(?:^|,)('+pattern.source+')(?=,|$)','g'):null;
  return function(value){
    const s=String(value||''),uids=[];if(!s)return {uids:uids,unresolved:0};
    if(!re)return {uids:uids,unresolved:s.split(',').filter(Boolean).length};
    re.lastIndex=0;let m;while((m=re.exec(s)))uids.push(m[1]);
    re.lastIndex=0;const rest=s.replace(re,'').replace(/^,+|,+$/g,'');
    return {uids:uids,unresolved:rest?rest.split(',').filter(Boolean).length:0};
  };
}
function privacyPlan_(db) {
  const map={}, names=[], caseByUid={}, stats={ids:0,recipients:0,payers:0,reviews:0,snapshot_groups:0};
  const norm=function(k){return String(k).replace(/[\s.]/g,'').toLowerCase();};
  const fields={}; IMPORT_FIELDS.forEach(function(f){[f.f].concat(f.syn||[]).forEach(function(h){fields[norm(h)]=f.f;});});
  const safeToken=/^(?:R1-[A-F0-9]{64})(?:,R1-[A-F0-9]{64})*$/;
  function remember(s){
    if(typeof s!=='string'||!s.trim()||safeToken.test(s)||/^(มีผู้วางเงิน|ไม่จัดเก็บชื่อคู่ความ|โจทก์|จำเลย)$/.test(s))return;
    [s.trim(),normName_(s)].forEach(function(x){if(x.length>=4)names.push(x);});
  }
  function uid(s){s=String(s||'');if(s&&!map[s]){map[s]=privacyUid_(s);if(map[s]!==s)stats.ids++;}return map[s]||'';}
  function collect(o, metadata) {
    if(!o || typeof o!=='object')return;
    if(Array.isArray(o)){o.forEach(function(x){collect(x,metadata);});return;}
    Object.keys(o).forEach(function(k){
      const v=o[k],f=fields[norm(k)]||k;
      if(k==='mapping'||k==='mapping_json')return;
      if(!metadata&&(f==='recipient'||f==='payer'||/โจทก์|จำเลย|plaintiff|defendant|คู่ความ/i.test(k)))remember(v);
      if(k==='notice_uid'&&v){uid(v);caseByUid[String(v)]=o.case_no||String(v).split('|')[0];}
      if(typeof v==='string'&&/^[\[{]/.test(v.trim())){try{collect(JSON.parse(v),false);}catch(e){}}
      else if(typeof v==='object')collect(v,metadata);
    });
  }
  Object.keys(db).forEach(function(k){if(k!=='USERS'&&k!=='OFFICERS'&&k!=='MAP_TEMPLATES')collect(db[k],false);});
  const groups={};
  (db.OP_SNAPSHOTS||[]).forEach(function(r){const k=String(r.request_id)+'\n'+String(r.table_name);(groups[k]=groups[k]||[]).push(r);});
  const decoded={};
  Object.keys(groups).forEach(function(k){
    const rs=groups[k].slice().sort(function(a,b){return Number(a.seq)-Number(b.seq);});
    try{decoded[k]=JSON.parse(rs.map(function(r){return JSON.parse(r.payload);}).join(''));}
    catch(e){throw new Error('ข้อมูลกู้คืนเดิมอ่านไม่ได้ ต้องตรวจสอบก่อนลบชื่อ');}
    if(!/^(USERS|OFFICERS|MAP_TEMPLATES)$/.test(String(rs[0].table_name)))collect(decoded[k],false);
  });
  const idRe=privacyRegex_(Object.keys(map).filter(function(k){return map[k]!==k;})),nameRe=privacyRegex_(names);
  function refs(s){return idRe?String(s).replace(idRe,function(x){return map[x];}):String(s);}
  function scrub(s){s=refs(s);return nameRe?s.replace(nameRe,'[ละชื่อคู่ความ]'):s;}
  function walk(o, cs, metadata) {
    if(Array.isArray(o))return o.map(function(x){return walk(x,cs,metadata);});
    if(!o||typeof o!=='object')return typeof o==='string'?scrub(o):o;
    const keys=Object.keys(o);let own=cs||'';
    keys.forEach(function(k){if((fields[norm(k)]||k)==='case_no'&&o[k])own=splitCase_(o[k]).no;});
    if(!own&&o.notice_uid)own=caseByUid[String(o.notice_uid)]||'';
    const out={};
    keys.forEach(function(k){
      const v=o[k], f=fields[norm(k)]||k;
      if(k==='mapping'||k==='mapping_json'){out[k]=v;return;}
      if(!metadata&&(f==='recipient'||(String(o.field)==='recipient'&&/^(old_value|new_value)$/.test(k)))){
        out[k]=NoticeImportFormat.recipient(own,v);if(String(v||'')!==out[k])stats.recipients++;return;
      }
      if(!metadata&&(f==='payer'||(String(o.field)==='payer'&&/^(old_value|new_value)$/.test(k)))){
        out[k]=v?'มีผู้วางเงิน':'';if(String(v||'')!==out[k])stats.payers++;return;
      }
      if(!metadata&&/โจทก์|จำเลย|plaintiff|defendant|คู่ความ/i.test(k)){out[k]='';return;}
      if(typeof v==='string'&&/^[\[{]/.test(v.trim())){
        try{out[k]=JSON.stringify(walk(JSON.parse(v),own,false));return;}
        catch(e){if(k==='raw_json')throw new Error('ข้อมูลรอตรวจเดิมอ่านไม่ได้ ต้องตรวจสอบก่อนลบชื่อ');}
      }
      if(/^(officer|officer_raw|first_name|last_name|full_name|created_by|updated_by|imported_by|decided_by|payment_by|amount_ok_by|date_ok_by|noclaim_by)$/.test(k)){out[k]=v;return;}
      out[k]=typeof v==='object'?walk(v,own,metadata):typeof v==='string'?scrub(v):v;
    });
    return out;
  }
  const output={};
  Object.keys(db).forEach(function(k){
    if(k==='OP_SNAPSHOTS')return;
    output[k]=/^(USERS|OFFICERS|MAP_TEMPLATES)$/.test(k)?JSON.parse(JSON.stringify(db[k])):walk(db[k],'',false);
  });
  output.OP_SNAPSHOTS=[];
  Object.keys(groups).forEach(function(k){
    const r=groups[k][0], data=/^(USERS|OFFICERS|MAP_TEMPLATES)$/.test(String(r.table_name))?decoded[k]:walk(decoded[k],'',false), json=JSON.stringify(data);
    for(let i=0;i<json.length;i+=10000)output.OP_SNAPSHOTS.push({request_id:r.request_id,table_name:r.table_name,seq:String(i/10000),payload:JSON.stringify(json.slice(i,i+10000))});
    stats.snapshot_groups++;
  });
  stats.reviews=(db.IMPORT_REVIEW||[]).filter(function(r,i){return JSON.stringify(r)!==JSON.stringify(output.IMPORT_REVIEW[i]);}).length;
  // The old identifier and the readable source name must not survive in the active data.
  const scan=JSON.stringify(Object.keys(output).filter(function(k){return !/^(USERS|OFFICERS|MAP_TEMPLATES)$/.test(k);}).map(function(k){return output[k];}));
  if(idRe){idRe.lastIndex=0;if(idRe.test(scan))throw new Error('ยังมีรหัสเดิมที่มีชื่อคู่ความตกค้าง');}
  if(nameRe){nameRe.lastIndex=0;if(nameRe.test(scan))throw new Error('ยังมีข้อความชื่อคู่ความตกค้าง ต้องตรวจสอบก่อนบันทึก');}
  const fieldLeak=(output.NOTICES||[]).concat(output.LEDGER||[]).filter(function(r){return r.recipient&&!safeToken.test(String(r.recipient));}).length;
  if(fieldLeak)throw new Error('ยังมีชื่อในคอลัมน์ผู้รับหมาย');
  return {tables:output,uid_map:map,stats:stats,remaining_recipient_names:fieldLeak,remaining_known_party_names:0};
}
function privacyFinancial_(db) {
  const take=function(t,cols){return (db[t]||[]).map(function(r){return cols.map(function(c){return String(r[c]||'');});});};
  return digestJson_({
    rounds:take('PAYOUT_ROUNDS',['round_id','fy','pay_date','cutoff_date','include_paid','include_budget','seat_count','rounding_policy','n_items','n_excluded','total_paid','total_budget','total','courier60','pool40','carry_in','pool_total','per_seat','paid_out','carry_out','extra_one','lines_json','status','round_type','payment_status','payment_date','payment_ref']),
    ledger:take('LEDGER',['ledger_id','source','pay_date','officer_id','case_no','receipt_no','received_date','amount','match','batch_id','round_id']),
    items:take('PAYOUT_ITEMS',['round_id','item_type','officer_id','amount','case_list','delivered_date','included','notice_kind','tambon','reported_date','reference_amount'])
  });
}
function privacyCalcOptions_(db) {
  const cfg={},ar={},br={},rules={};
  db.CONFIG.forEach(function(r){cfg[r.key]=r.value;});db.RATE_AREAS.forEach(function(r){ar[r.area_id]=Number(r.rate)||0;});db.RATE_BUDGET.forEach(function(r){br[r.amphoe_code]=Number(r.rate)||0;});db.CALC_RULES.forEach(function(r){rules[r.rule_code]=r;});
  const locked={},parseList=privacyListParser_(db.NOTICES);db.BUDGET_UNITS.forEach(function(u){if(unitLocked_(u))locked[u.unit_id]={notice_uids:parseList(u.notice_uids).uids};});
  return {areaRate:ar,budgetRate:br,mode:(rules.FREE_MULTI_CASE_SAME_MOO||{}).mode||'HALF',locked:locked,fyStartMonth:Number(cfg.FY_START_MONTH)||10,startFy:cfg.PROCESS_START_FY||'',startDate:fyStartDate_(cfg.PROCESS_START_FY||'',Number(cfg.FY_START_MONTH)||10),urbanGroup:(rules.FREE_URBAN_GROUP||{}).mode||'TAMBON',freeMax:Number((rules.FREE_MAX_RATE||{}).mode)||0};
}
function privacyCalcCompare_(before,after,map) {
  const b=calcCompute_(before.NOTICES,privacyCalcOptions_(before)),a=calcCompute_(after.NOTICES,privacyCalcOptions_(after)),changed=[];
  before.NOTICES.forEach(function(n){const old=b.byNotice[n.notice_uid],next=a.byNotice[map[n.notice_uid]||n.notice_uid];if(!!old!==!!next||old&&['calc_amount','calc_rule'].some(function(k){return String(old[k]||'')!==String(next[k]||'');}))changed.push(n.notice_uid);});
  if(changed.length){
    const idx={};after.NOTICES.forEach(function(n){idx[n.notice_uid]=n;});
    console.log(JSON.stringify({calculation_differences:before.NOTICES.filter(function(n){return changed.indexOf(n.notice_uid)>=0;}).map(function(n){
      const next=idx[map[n.notice_uid]||n.notice_uid]||{},old=b.byNotice[n.notice_uid]||{},calc=a.byNotice[next.notice_uid]||{};
      return {id:privacyUid_(n.notice_uid).slice(0,15),before_rule:old.calc_rule||'LOCKED',after_rule:calc.calc_rule||'LOCKED',before_amount:old.calc_amount,after_amount:calc.calc_amount,addr_type:n.addr_type,changed_fields:['case_no','officer_id','delivered_date','area_id','place_key','addr_type','house_no','moo','fy','payout_round_id','budget_unit_id'].filter(function(k){return String(n[k]||'')!==String(next[k]||'');})};
    })}));
    throw new Error('การลบชื่อทำให้ผลคำนวณต่าง '+changed.length+' รายการ — ยังไม่บันทึก');
  }
  return {equal:true,notices:before.NOTICES.length,units_before:b.units.length,units_after:a.units.length,warnings_before:b.warnings.length,warnings_after:a.warnings.length};
}
function privacyReferenceCheck_(db) {
  const ids={};db.NOTICES.forEach(function(n){if(ids[n.notice_uid])throw new Error('รหัสหมายซ้ำหลังย้าย');ids[n.notice_uid]=true;});
  const out={},parseList=privacyListParser_(db.NOTICES);['BUDGET_UNITS','PAYOUT_ITEMS','LEDGER'].forEach(function(k){let bad=0;db[k].forEach(function(r){bad+=parseList(r.notice_uids).unresolved;});out[k]=bad;});return out;
}
function privacyMigrationPreview_(backupId) {
  const before=privacyReadAll_(db_()),backup=privacyReadAll_(SpreadsheetApp.openById(backupId));
  if(digestJson_(before)!==digestJson_(backup))throw new Error('สำรองไม่ตรงกับข้อมูลปัจจุบัน ต้องสำรองใหม่ก่อน');
  if(pendingOperation_())throw new Error('มีงานบันทึกค้าง ต้องกู้คืนก่อนลบชื่อ');
  const plan=privacyPlan_(before),calc=privacyCalcCompare_(before,plan.tables,plan.uid_map);
  if(privacyFinancial_(before)!==privacyFinancial_(plan.tables))throw new Error('ข้อมูลการเงินเปลี่ยนระหว่างเตรียมแผน');
  if(JSON.stringify(privacyReferenceCheck_(before))!==JSON.stringify(privacyReferenceCheck_(plan.tables)))throw new Error('ความเชื่อมโยงหมายไม่ครบ');
  const report={mode:'PREVIEW',hash:digestJson_(before),rows:{},changes:plan.stats,legacy_ids_with_comma:before.NOTICES.filter(function(n){return String(n.notice_uid).indexOf(',')>=0;}).length,remaining_recipient_names:plan.remaining_recipient_names,calculation:calc,financial_unchanged:true,references:privacyReferenceCheck_(plan.tables)};
  Object.keys(before).forEach(function(k){report.rows[k]=before[k].length;});console.log(JSON.stringify(report));return report;
}
function privacyMigrationApply_(backupId,expectedHash) {
  const lock=LockService.getScriptLock();lock.waitLock(30000);TX_LOCK_HELD_=true;let original=null,writing=false;
  try{
    original=privacyReadAll_(db_());
    if(digestJson_(original)!==expectedHash||digestJson_(privacyReadAll_(SpreadsheetApp.openById(backupId)))!==expectedHash)throw new Error('ข้อมูลเปลี่ยนหลังตรวจแผน ต้องตรวจใหม่ก่อน');
    if(pendingOperation_())throw new Error('มีงานบันทึกค้าง');
    const plan=privacyPlan_(original),calc=privacyCalcCompare_(original,plan.tables,plan.uid_map),financial=privacyFinancial_(original);
    if(financial!==privacyFinancial_(plan.tables))throw new Error('ข้อมูลการเงินไม่ตรงก่อนบันทึก');
    if(JSON.stringify(privacyReferenceCheck_(original))!==JSON.stringify(privacyReferenceCheck_(plan.tables)))throw new Error('ความเชื่อมโยงไม่ตรงก่อนบันทึก');
    const changed=Object.keys(plan.tables).filter(function(k){return JSON.stringify(original[k])!==JSON.stringify(plan.tables[k]);});
    writing=true;changed.forEach(function(k){rewriteTable_(k,plan.tables[k]);});SpreadsheetApp.flush();CFG_CACHE_=null;HEAD_CACHE_={};
    const recalculation=calcRunCore_('ADMIN_PRIVACY_MIGRATION');SpreadsheetApp.flush();
    const after=privacyReadAll_(db_());
    if(financial!==privacyFinancial_(after))throw new Error('ยอดหรือสถานะการเงินเปลี่ยนหลังคำนวณ');
    if(JSON.stringify(privacyReferenceCheck_(original))!==JSON.stringify(privacyReferenceCheck_(after)))throw new Error('ความเชื่อมโยงเปลี่ยนหลังคำนวณ');
    if(privacyPlan_(after).stats.ids!==0)throw new Error('ยังมีรหัสที่ต้องย้ายตกค้าง');
    const ctx={user:{code:'ADMIN_PRIVACY_MIGRATION',roles:['ADMIN']}},tracking=trackingData_(ctx,{fy:currentFy_()}),closeout=apiCloseout_(ctx,{fy:currentFy_()});
    bumpDataVer_();setProp_('PARTY_PRIVACY_MIGRATED_AT',now_());
    const result={mode:'APPLIED',changed_tables:changed,notices:after.NOTICES.length,remaining_recipient_names:0,financial_unchanged:true,references:privacyReferenceCheck_(after),calculation:calc,recalculation:recalculation,rounds:tracking.round_summary,closeout:closeout.totals};
    audit_('ADMIN_PRIVACY_MIGRATION','PARTY_PRIVACY_REMOVE','',{notices:result.notices,tables:changed.length,financial_unchanged:true});console.log(JSON.stringify(result));return result;
  }catch(e){
    if(writing&&original){Object.keys(original).forEach(function(k){rewriteTable_(k,original[k]);});SpreadsheetApp.flush();CFG_CACHE_=null;HEAD_CACHE_={};bumpDataVer_();}
    throw e;
  }finally{TX_LOCK_HELD_=false;lock.releaseLock();}
}
