/** Owner-only utilities; deliberately no API route. Logs counts, never source text. */
function freeTextWalk078_(value, key) {
  const role=NoticeImportFormat.privacyField(key);
  if(role==='officer'||role==='case')return {value:value,count:0};
  if(Array.isArray(value)){let count=0;const out=value.map(function(x){const r=freeTextWalk078_(x,'');count+=r.count;return r.value;});return {value:out,count:count};}
  if(value&&typeof value==='object'){const out={};let count=0;Object.keys(value).forEach(function(k){const r=freeTextWalk078_(value[k],k);out[k]=r.value;count+=r.count;});return {value:out,count:count};}
  if(typeof value!=='string')return {value:value,count:0};
  if(/^[\[{]/.test(value.trim())){let parsed;try{parsed=JSON.parse(value);}catch(e){}if(parsed&&typeof parsed==='object'){const r=freeTextWalk078_(parsed,'');return {value:r.count?JSON.stringify(r.value):value,count:r.count};}}
  const r=NoticeImportFormat.redactNames(value);return {value:r.text,count:r.count};
}
function freeTextAudit078_(db) {
  const s={notice_rows:0,notice_points:0,review_rows:0,review_points:0,invalid_review_json:0};
  (db.NOTICES||[]).forEach(function(n){const count=NoticeImportFormat.nameMatches(n.result).length;if(count){s.notice_rows++;s.notice_points+=count;}});
  (db.IMPORT_REVIEW||[]).forEach(function(r){if(!r.raw_json)return;let parsed;try{parsed=JSON.parse(r.raw_json);}catch(e){s.invalid_review_json++;return;}const n=freeTextWalk078_(parsed,'').count;if(n){s.review_rows++;s.review_points+=n;}});return s;
}
function freeTextInvariant078_(db) {
  const invariant=JSON.parse(JSON.stringify(db));
  invariant.NOTICES.forEach(function(n){delete n.result;delete n.result_hash;});
  invariant.IMPORT_REVIEW.forEach(function(r){delete r.raw_json;});
  return digestJson_(invariant);
}
function freeTextPlan078_(db) {
  const before=freeTextAudit078_(db);if(before.invalid_review_json)throw new Error('มี raw_json ที่อ่านไม่ได้ '+before.invalid_review_json+' แถว ต้องตรวจโครงสร้างก่อนล้าง');
  const out=JSON.parse(JSON.stringify(db));
  out.NOTICES.forEach(function(n){const r=NoticeImportFormat.redactNames(n.result);if(r.count){n.result=r.text;n.result_hash=n.delivered_date?hashOf_(n,RESULT_HASH_FIELDS):'';}});
  out.IMPORT_REVIEW.forEach(function(r){if(!r.raw_json)return;const next=freeTextWalk078_(JSON.parse(r.raw_json),'');if(next.count)r.raw_json=JSON.stringify(next.value);});
  if(freeTextInvariant078_(out)!==freeTextInvariant078_(db))throw new Error('ข้อมูลนอกช่องข้อความเปลี่ยน — ยังไม่บันทึก');
  const remaining=freeTextAudit078_(out);if(remaining.notice_points||remaining.review_points)throw new Error('ยังพบคำนำหน้าชื่อหลังเตรียมแผน — ยังไม่บันทึก');
  return {tables:out,changes:before,remaining:remaining};
}
function auditFreeText078() {
  const before=privacyReadAll_(db_()),hash=digestJson_(before),counts=freeTextAudit078_(before);
  if(digestJson_(privacyReadAll_(db_()))!==hash)throw new Error('ข้อมูลเปลี่ยนระหว่างตรวจ ต้องตรวจใหม่');
  const result={mode:'READ_ONLY',version:'0.7.8',unchanged:true,hash:hash,counts:counts};console.log(JSON.stringify(result));return result;
}
function previewFreeTextCleanup078(backupId) {
  backupId=backupId||prop_('FREE_TEXT_BACKUP_ID');if(!backupId)throw new Error('ยังไม่ได้ระบุสำรองส่วนตัว');
  const before=privacyReadAll_(db_()),hash=digestJson_(before);
  if(digestJson_(privacyReadAll_(SpreadsheetApp.openById(backupId)))!==hash)throw new Error('สำรองไม่ตรงกับฐานปัจจุบัน');
  if(pendingOperation_())throw new Error('มีงานบันทึกค้าง ต้องกู้คืนก่อน');
  const plan=freeTextPlan078_(before);privacyCalcCompare_(before,plan.tables,{});
  if(privacyFinancial_(before)!==privacyFinancial_(plan.tables))throw new Error('ยอดการเงินไม่ตรง — ยังไม่บันทึก');
  const result={mode:'PREVIEW',hash:hash,changes:plan.changes,remaining:plan.remaining,backup_matches:true,financial_unchanged:true,calculation_unchanged:true};console.log(JSON.stringify(result));return result;
}
function applyFreeTextCleanup078(backupId,expectedHash) {
  backupId=backupId||prop_('FREE_TEXT_BACKUP_ID');expectedHash=expectedHash||prop_('FREE_TEXT_EXPECTED_HASH');
  const lock=LockService.getScriptLock();lock.waitLock(30000);TX_LOCK_HELD_=true;let original=null,writing=false;
  try{
    original=privacyReadAll_(db_());
    if(!backupId||!expectedHash||digestJson_(original)!==expectedHash||digestJson_(privacyReadAll_(SpreadsheetApp.openById(backupId)))!==expectedHash)throw new Error('hash หรือสำรองไม่ตรง ต้องตรวจใหม่ก่อน');
    if(pendingOperation_())throw new Error('มีงานบันทึกค้าง');
    const plan=freeTextPlan078_(original);privacyCalcCompare_(original,plan.tables,{});
    const invariant=freeTextInvariant078_(original),financial=privacyFinancial_(original),changed=['NOTICES','IMPORT_REVIEW'].filter(k=>JSON.stringify(original[k])!==JSON.stringify(plan.tables[k]));
    writing=true;changed.forEach(function(k){rewriteTable_(k,plan.tables[k]);});SpreadsheetApp.flush();CFG_CACHE_=null;HEAD_CACHE_={};
    const after=privacyReadAll_(db_()),remaining=freeTextAudit078_(after);
    if(digestJson_(after)!==digestJson_(plan.tables)||invariant!==freeTextInvariant078_(after)||financial!==privacyFinancial_(after)||remaining.notice_points||remaining.review_points)throw new Error('ผลอ่านกลับหรือยอดไม่ตรงหลังล้าง');
    privacyCalcCompare_(original,after,{});bumpDataVer_();setProp_('FREE_TEXT_MIGRATED_AT',now_());
    audit_('ADMIN_PRIVACY_MIGRATION','FREE_TEXT_PRIVACY_REMOVE','',{notice_rows:plan.changes.notice_rows,review_rows:plan.changes.review_rows,financial_unchanged:true});
    const result={mode:'APPLIED',version:'0.7.8',changed_tables:changed,changes:plan.changes,remaining:remaining,financial_unchanged:true,calculation_unchanged:true};console.log(JSON.stringify(result));return result;
  }catch(e){
    if(writing&&original){['NOTICES','IMPORT_REVIEW'].forEach(k=>rewriteTable_(k,original[k]));SpreadsheetApp.flush();CFG_CACHE_=null;HEAD_CACHE_={};bumpDataVer_();}
    throw e;
  }finally{TX_LOCK_HELD_=false;lock.releaseLock();}
}
