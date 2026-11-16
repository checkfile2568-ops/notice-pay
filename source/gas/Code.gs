/**
 * ============================================================================
 *  ระบบค่าหมาย · ไฟล์ Code.gs   (ประตู API · router · ตรวจ token/สิทธิ์ · ตอบ JSON เสมอ)
 * ----------------------------------------------------------------------------
 *  หน้าเว็บ (GitHub Pages) เรียก POST text/plain: { action, token, ...ข้อมูล }
 *  ตอบกลับ: { ok:true, data } หรือ { ok:false, code, msg, extra }
 * ============================================================================
 */

function routes_() {
  const ALL = [];                                    // ทุกบทบาทที่เข้าระบบได้
  const ADMIN = ['ADMIN'];
  const IMPORTERS = ['NOTICE', 'FINANCE', 'ADMIN'];             // งานหมาย + การเงิน นำเข้าได้
  const WORK = ['NOTICE', 'CASE', 'FINANCE', 'COURIER', 'ADMIN']; // ทุกบทบาทยกเว้น "ดูสถิติ (ทุกคน)" — เห็นรายละเอียดคดี/ผู้รับ
  return {
    ping:            { auth: false, fn: function () { return { app: APP_NAME, version: API_VERSION, time: now_() }; } },
    search_accounts: { auth: false, fn: apiSearchAccounts_ },
    login:           { auth: false, fn: apiLogin_ },

    status:          { auth: true, roles: ALL, fn: apiStatus_ },
    logout:          { auth: true, roles: ALL, fn: apiLogout_ },
    dashboard:       { auth: true, roles: ALL, fn: apiDashboard_ },
    notice_search:   { auth: true, roles: WORK, fn: apiNoticeSearch_ },
    officers_list:   { auth: true, roles: ALL, fn: apiOfficersList_ },
    rates_list:      { auth: true, roles: ALL, fn: apiRatesList_ },

    import_templates:{ auth: true, roles: IMPORTERS, fn: apiImportTemplates_ },
    import_preview:  { auth: true, roles: IMPORTERS, fn: apiImportPreview_ },
    import_commit:   { auth: true, roles: IMPORTERS, fn: apiImportCommit_ },
    import_history:  { auth: true, roles: ['NOTICE', 'FINANCE', 'ADMIN'], fn: apiImportHistory_ },
    import_review:   { auth: true, roles: IMPORTERS, fn: apiImportReview_ },
    review_open:     { auth: true, roles: IMPORTERS, fn: apiReviewOpen_ },
    review_resolve:  { auth: true, roles: ['NOTICE', 'ADMIN'], fn: apiReviewResolve_ },

    calc_summary:    { auth: true, roles: ALL, fn: apiCalcSummary_ },
    compensation_summary: { auth: true, roles: ALL, fn: apiCompensationSummary_ },
    calc_units:      { auth: true, roles: ALL, fn: apiCalcUnits_ },
    calc_run:        { auth: true, roles: ['NOTICE', 'FINANCE', 'ADMIN'], fn: apiCalcRun_ },
    notice_checks:   { auth: true, roles: WORK, fn: apiNoticeChecks_ },
    notice_confirm_amount: { auth: true, roles: ['NOTICE', 'FINANCE', 'ADMIN'], fn: apiNoticeConfirmAmount_ },
    notice_confirm_date:   { auth: true, roles: ['NOTICE', 'FINANCE', 'ADMIN'], fn: apiNoticeConfirmDate_ },

    users_list:      { auth: true, roles: ADMIN, fn: apiUsersList_ },
    user_save:       { auth: true, roles: ADMIN, fn: apiUserSave_ },
    officer_save:    { auth: true, roles: ADMIN, fn: apiOfficerSave_ },
    config_list:     { auth: true, roles: ADMIN, fn: apiConfigList_ },

    payout_list:       { auth: true, roles: ALL, fn: apiPayoutList_ },
    payout_get:        { auth: true, roles: ALL, fn: apiPayoutGet_ },
    payout_candidates: { auth: true, roles: IMPORTERS, fn: apiPayoutCandidates_ },
    payout_confirm:    { auth: true, roles: IMPORTERS, fn: apiPayoutConfirm_ },
    payout_cancel:     { auth: true, roles: ADMIN, fn: apiPayoutCancel_ },
    payout_backlog:    { auth: true, roles: WORK, fn: apiPayoutBacklog_ },
    payout_noclaim:    { auth: true, roles: ADMIN, fn: apiPayoutNoclaim_ },
    ledger_import:     { auth: true, roles: IMPORTERS, fn: apiLedgerImport_ },
    ledger_pending:    { auth: true, roles: IMPORTERS, fn: apiLedgerPending_ },
    ledger_reconcile:  { auth: true, roles: IMPORTERS, fn: apiLedgerReconcile_ },
    tracking: { auth: true, roles: WORK, fn: apiTracking_ },
    reports: { auth: true, roles: ALL, fn: apiReports_ },
    round_payment: { auth: true, roles: ['FINANCE', 'ADMIN'], fn: apiRoundPayment_ },
    round_payment_bulk: { auth: true, roles: ['FINANCE', 'ADMIN'], fn: apiRoundPaymentBulk_ },
    operation_status: { auth: true, roles: IMPORTERS, fn: apiOperationStatus_ },
    operation_resume: { auth: true, roles: IMPORTERS, fn: apiOperationResume_ }
  };
}

function doGet(e) {
  return json_({ ok: true, data: { app: APP_NAME, version: API_VERSION, hint: 'เรียกด้วย POST' } });
}

function doPost(e) {
  let who = '';
  try {
    if (!e || !e.postData || !e.postData.contents) throw appErr_('BAD_REQUEST', 'ไม่มีข้อมูลคำขอ');
    let body;
    try { body = JSON.parse(e.postData.contents); } catch (x) { throw appErr_('BAD_REQUEST', 'รูปแบบคำขอไม่ถูกต้อง'); }
    const action = String(body.action || '');
    const r = routes_()[action];
    if (!r) throw appErr_('UNKNOWN_ACTION', 'ไม่รู้จักคำสั่ง ' + action.slice(0, 40));
    if (action !== 'ping') ensureSchema_();
    const ctx = { action: action, user: null };
    if (r.auth) {
      ctx.user = requireSession_(body.token);
      who = ctx.user.code;
      if (!hasRole_(ctx.user, r.roles)) throw appErr_('FORBIDDEN', 'บัญชีนี้ไม่มีสิทธิ์ใช้งานส่วนนี้');
    }
    if (action === 'import_preview' || action === 'import_commit' || action === 'ledger_import') body = normalizeIncomingImport_(body);
    const pendingWrite = r.auth && pendingOperation_();
    if (pendingWrite && !(body.request_id === pendingWrite.request_id && action === pendingWrite.action) && ['operation_status', 'operation_resume', 'logout'].indexOf(action) < 0) throw appErr_('RECOVERY_REQUIRED', 'มีงานบันทึกค้าง กรุณาเปิดกู้คืนงานบันทึกก่อน');
    // เร่งความเร็ว: จำผลสรุป (หน้าแรก/หน้าคำนวณ) ไว้ฝั่งเซิร์ฟเวอร์ ล้างอัตโนมัติเมื่อข้อมูลเปลี่ยน
    if (RESULT_CACHED_[action]) {
      const key = resultCacheKey_(action, ctx.user, body);
      const hit = key ? CacheService.getScriptCache().get(key) : null;
      if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
      const out = JSON.stringify({ ok: true, data: r.fn(ctx, body) });
      if (key && out.length < 90000) { try { CacheService.getScriptCache().put(key, out, 600); } catch (x) { /* เกินขนาด — ไม่จำ */ } }
      return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
    }
    const writing = JOURNALED_[action] && (action !== 'ledger_import' || body.commit === true);
    let data = writing ? operationWrite_(ctx, body, function () { if (action === 'import_commit' || action === 'ledger_import') previewCheck_(ctx, action, body); return r.fn(ctx, body); }) : (DATA_WRITES_[action] && !(action === 'ledger_import' && !body.commit) ? serialWrite_(function(){return r.fn(ctx,body);}) : r.fn(ctx, body));
    if (action === 'import_preview') data = previewBind_(ctx, 'import_commit', body, data);
    if (action === 'ledger_import' && !body.commit) data = previewBind_(ctx, 'ledger_import', Object.assign({}, body, { commit: true }), data);
    if (DATA_WRITES_[action] && !writing && (action !== 'ledger_import' || body.commit)) bumpDataVer_();
    return json_({ ok: true, data: data });
  } catch (err) {
    if (!err.appCode) {
      console.error(err && err.stack ? err.stack : err);
      audit_(who, 'ERROR', '', String(err && err.message || err).slice(0, 300));
      return json_({ ok: false, code: 'SERVER_ERROR', msg: 'ระบบขัดข้อง กรุณาลองใหม่ หากยังเป็นอยู่แจ้งผู้ดูแลระบบ' });
    }
    return json_({ ok: false, code: err.appCode, msg: err.message, extra: err.extra || null });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** Strip unmapped party columns before preview binding, journal snapshots or writes. */
function assertImportTextPrivacy078_(value, mapping, rowNo) {
  function check(v, key, depth) {
    if(depth>24)throw appErr_('BAD_REQUEST','ข้อมูลนำเข้าซ้อนกันเกินกำหนด');
    const role=key===mapping.officer?'officer':(key===mapping.case_no||key===mapping.red_no)?'case':NoticeImportFormat.privacyField(key);
    if(role==='officer'||role==='case')return;
    if(Array.isArray(v)){v.forEach(function(x){check(x,'',depth+1);});return;}
    if(v&&typeof v==='object'){Object.keys(v).forEach(function(k){check(v[k],k,depth+1);});return;}
    if(typeof v!=='string')return;
    if(/^[\[{]/.test(v.trim())){let parsed;try{parsed=JSON.parse(v);}catch(e){}if(parsed&&typeof parsed==='object'){check(parsed,'',depth+1);return;}}
    if(NoticeImportFormat.nameMatches(v).length)throw appErr_('BAD_REQUEST',rowNo?'พบคำนำหน้าชื่อในแถว '+rowNo+' กรุณาตัดชื่อด้วยเครื่องมือออฟไลน์ก่อนนำเข้า':'พบคำนำหน้าชื่อในข้อมูลประกอบไฟล์ กรุณาตรวจชื่อไฟล์ ชีต และตัวเลือก');
  }
  check(value,'',0);
}
function normalizeIncomingImport_(body) {
  const out = Object.assign({}, body);
  const ledger = body.action === 'ledger_import';
  const mapping = {};
  if (!ledger) IMPORT_FIELDS.forEach(function(f) {
    if (!body.mapping || typeof body.mapping[f.f] !== 'string') return;
    const col=body.mapping[f.f];
    if (/โจทก์|จำเลย|คู่ความ|plaintiff|defendant/i.test(col)) throw appErr_('BAD_REQUEST','ไม่รับคอลัมน์ชื่อโจทก์หรือจำเลย กรุณาตรวจหัวคอลัมน์ในไฟล์');
    mapping[f.f]=col;
  });
  out.rows = (Array.isArray(body.rows) ? body.rows : []).map(function(row, i) {
    try {
      if (!ledger) {
        const safe=NoticeImportFormat.mapped(row || {}, mapping);
        // Check every supplied column, including those which would otherwise be discarded.
        // Recipient/payer are converted first; staff and case columns retain their exceptions.
        assertImportTextPrivacy078_(Object.assign({},row||{},safe),mapping,i+1);
        return safe;
      }
      const r = {}; ['case_no','recipient','officer','amount','pay_date','received_date','receipt_no','notice_kind','tambon','result'].forEach(function(k) { if(row && row[k]!==undefined)r[k]=row[k]; });
      r.recipient = NoticeImportFormat.recipient(r.case_no,r.recipient);
      ['pay_date','received_date'].forEach(function(k) {
        if (r[k]===undefined) return; const dt=parseDate_(r[k]);
        if (dt===null) throw new Error('วันที่ไม่ถูกต้อง กรุณาใช้วัน/เดือน/ปี 4 หลัก'); r[k]=dt;
      });
      assertImportTextPrivacy078_(Object.assign({},row||{},r),{},i+1);
      return r;
    } catch(e) { throw appErr_('BAD_REQUEST', 'แถว '+(i+1)+': '+e.message); }
  });
  assertImportTextPrivacy078_({file:body.file||{},options:body.options||{},mapping:mapping},{},0);
  if (!ledger) out.mapping = mapping;
  out.privacy_version = '2';
  return out;
}

/* ---------- แคชผลสรุปฝั่งเซิร์ฟเวอร์ (10 นาที) ----------
 * คีย์ผูกกับ "รุ่นข้อมูล" (DATA_VER) — ทุกคำสั่งที่เขียนข้อมูลจะเพิ่มรุ่น ทำให้แคชเดิมไม่ถูกใช้อีก
 * คีย์รวมบทบาทและผู้ส่งที่ผูก เพราะผลลัพธ์ขึ้นกับสิทธิ์ (ขอบเขตการมองเห็น / ปุ่มคำนวณ) */
const RESULT_CACHED_ = { dashboard: 1, calc_summary: 1 };
const DATA_WRITES_ = { ledger_reconcile: 1, import_commit: 1, calc_run: 1, notice_confirm_amount: 1, notice_confirm_date: 1, officer_save: 1, user_save: 1, payout_confirm: 1, payout_cancel: 1, payout_noclaim: 1, ledger_import: 1, review_resolve: 1, round_payment: 1, round_payment_bulk: 1 };
function dataVer_() { return PropertiesService.getScriptProperties().getProperty('DATA_VER') || '0'; }
function bumpDataVer_() { PropertiesService.getScriptProperties().setProperty('DATA_VER', Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36)); }
function resultCacheKey_(action, user, body) {
  if (!user) return '';
  const fy = String(body.fy || '').replace(/\D/g, '').slice(0, 4) || 'cur';
  const who = (user.roles || []).slice().sort().join('.') + '_' + (user.officer_id || '');
  return ('R_' + API_VERSION + '_' + action + '_' + dataVer_() + '_' + fy + '_' + who).slice(0, 240);
}

const JOURNALED_ = { ledger_reconcile: 1, import_commit: 1, ledger_import: 1, payout_confirm: 1, payout_cancel: 1, payout_noclaim: 1, review_resolve: 1, round_payment: 1, round_payment_bulk: 1 };
