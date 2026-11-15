/** 0.7.0: durable write journal. Snapshots stay in the private database, never in web assets. */
let TX_LOCK_HELD_ = false;
function writeLock_() {
  return TX_LOCK_HELD_ ? { waitLock: function () {}, releaseLock: function () {} } : LockService.getScriptLock();
}
function digestJson_(v) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(v)));
}
function cleanRequest_(d) {
  const out = {}; Object.keys(d).sort().forEach(function (k) { if (['token', 'action', 'request_id', 'preview_token'].indexOf(k) < 0) out[k] = d[k]; }); return out;
}
function pendingOperation_() { return readTable_('OPERATIONS').rows.filter(function (r) { return r.status === 'PENDING' || r.status === 'RESTORE_FAILED'; })[0] || null; }
function apiOperationStatus_(ctx) {
  const p = pendingOperation_();
  return { pending: p ? { request_id: p.request_id, action: p.action, at: p.updated_at, can_resume: p.user_code === ctx.user.code || hasRole_(ctx.user, ['ADMIN']) } : null };
}
function journalChunks_(id, name, value) {
  const s = JSON.stringify(value), rows = [];
  for (let i = 0; i < s.length; i += 10000) rows.push({ request_id: id, table_name: name, seq: rows.length, payload: JSON.stringify(s.slice(i, i + 10000)) });
  const keep = readTable_('OP_SNAPSHOTS').rows.filter(function (r) { return r.request_id !== id || r.table_name !== name; });
  rewriteTable_('OP_SNAPSHOTS', keep.concat(rows));
}
function journalRead_(id, name) {
  const rows = readTable_('OP_SNAPSHOTS').rows.filter(function (r) { return r.request_id === id && r.table_name === name; }).sort(function (a, b) { return Number(a.seq) - Number(b.seq); });
  if (!rows.length) throw appErr_('RECOVERY_REQUIRED', 'ไม่พบข้อมูลกู้คืน กรุณาติดต่อผู้ดูแลระบบ');
  return JSON.parse(rows.map(function (r) { return JSON.parse(r.payload); }).join(''));
}
const JOURNAL_TABLES_ = ['CONFIG', 'NOTICES', 'BUDGET_UNITS', 'NOTICE_CHANGES', 'IMPORT_BATCHES', 'IMPORT_REVIEW', 'MAP_TEMPLATES', 'PAYOUT_ROUNDS', 'PAYOUT_ITEMS', 'LEDGER'];
function restoreOperation_(id) {
  JOURNAL_TABLES_.forEach(function (name) { rewriteTable_(name, journalRead_(id, name)); });
  CFG_CACHE_ = null; bumpDataVer_();
}
function operationWrite_(ctx, d, fn) {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  TX_LOCK_HELD_ = true;
  let op = null;
  try {
    const id = str_(d.request_id || Utilities.getUuid(), 100);
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(id)) throw appErr_('BAD_REQUEST', 'รหัสคำขอไม่ถูกต้อง');
    const clean = cleanRequest_(d), hash = digestJson_(clean);
    const all = readTable_('OPERATIONS').rows;
    op = all.filter(function (r) { return r.request_id === id; })[0] || null;
    if (op && (op.user_code !== ctx.user.code || op.action !== ctx.action || op.request_hash !== hash)) throw appErr_('REQUEST_CONFLICT', 'รหัสคำขอนี้ใช้กับข้อมูลอีกชุดแล้ว');
    if (op && op.status === 'DONE') return op.result_json === '@chunks' ? journalRead_(id, '__result__') : JSON.parse(op.result_json);
    const pending = pendingOperation_();
    if (pending && pending.request_id !== id) throw appErr_('RECOVERY_REQUIRED', 'มีงานบันทึกค้าง กรุณากู้คืนงานเดิมก่อนทำรายการใหม่');
    if (op && (op.status === 'PENDING' || op.status === 'RESTORE_FAILED')) restoreOperation_(id);
    if (!op) {
      JOURNAL_TABLES_.forEach(function (name) { journalChunks_(id, name, readTable_(name).rows); });
      journalChunks_(id, '__request__', clean);
      appendRows_('OPERATIONS', [{ request_id: id, action: ctx.action, user_code: ctx.user.code, request_hash: hash, status: 'READY', created_at: now_(), updated_at: now_() }]);
      op = readTable_('OPERATIONS').rows.filter(function (r) { return r.request_id === id; })[0];
    }
    op.status = 'PENDING'; op.updated_at = now_(); updateRow_('OPERATIONS', op._r, op);
    try {
      const data = fn();
      const result = JSON.stringify(data);
      if (result.length > 28000) journalChunks_(id, '__result__', data);
      op.status = 'DONE'; op.result_json = result.length > 28000 ? '@chunks' : result; op.error = ''; op.updated_at = now_(); updateRow_('OPERATIONS', op._r, op);
      bumpDataVer_(); return data;
    } catch (err) {
      try { restoreOperation_(id); op.status = 'ROLLED_BACK'; } catch (restoreErr) { op.status = 'RESTORE_FAILED'; }
      op.error = String(err.message || err).slice(0, 300); op.updated_at = now_(); updateRow_('OPERATIONS', op._r, op);
      throw err;
    }
  } finally { TX_LOCK_HELD_ = false; lock.releaseLock(); }
}
function apiOperationResume_(ctx, d) {
  const op = readTable_('OPERATIONS').rows.filter(function (r) { return r.request_id === String(d.request_id); })[0];
  if (!op || (op.user_code !== ctx.user.code && !hasRole_(ctx.user, ['ADMIN']))) throw appErr_('FORBIDDEN', 'ไม่มีสิทธิ์กู้คืนงานนี้');
  // Admin recovery uses the original identity only after checking the original route permission.
  const route = routes_()[op.action];
  if (!route || !hasRole_(ctx.user, route.roles)) throw appErr_('FORBIDDEN', 'ไม่มีสิทธิ์ดำเนินงานประเภทนี้');
  const request = journalRead_(op.request_id, '__request__'); request.request_id = op.request_id;
  const actor = { action: op.action, user: Object.assign({}, ctx.user, { code: op.user_code }) };
  return operationWrite_(actor, request, function () { return route.fn(actor, request); });
}
function previewBind_(ctx, action, body, data) {
  const token = Utilities.getUuid(), hash = digestJson_(cleanRequest_(body));
  CacheService.getScriptCache().put('PV_' + token, JSON.stringify({ user: ctx.user.code, action: action, hash: hash }), 900);
  data.preview_token = token; return data;
}
function previewCheck_(ctx, action, body) {
  if (!body.preview_token) return; // compatibility with older clients; new UI always supplies it
  const raw = CacheService.getScriptCache().get('PV_' + String(body.preview_token));
  let p; try { p = JSON.parse(raw || 'null'); } catch (e) {}
  if (!p || p.user !== ctx.user.code || p.action !== action || p.hash !== digestJson_(cleanRequest_(body))) throw appErr_('STALE', 'ข้อมูลเปลี่ยนหรือผลตรวจหมดอายุ กรุณาตรวจสอบก่อนนำเข้าอีกครั้ง');
}

function serialWrite_(fn) {
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try { if(pendingOperation_())throw appErr_('RECOVERY_REQUIRED','มีงานบันทึกค้าง กรุณากู้คืนงานเดิมก่อน'); TX_LOCK_HELD_=true;return fn(); }
  finally {TX_LOCK_HELD_=false;lock.releaseLock();}
}
