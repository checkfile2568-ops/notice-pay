/**
 * ============================================================================
 *  ระบบค่าหมาย · ไฟล์ Ledger.gs   (ระยะ 5: นำเข้าบัญชีที่เบิก/จ่ายจริงจากระบบงานหมาย)
 * ----------------------------------------------------------------------------
 *  PAY    : บัญชีการจ่ายเงินให้เจ้าพนักงานศาล (หมายมีเงินที่จ่ายจริง · มีวันที่จ่ายรายแถว)
 *           → เก็บในชีต LEDGER แยกตามวันที่จ่าย · ใช้ตั้งรอบหมายมีเงิน (ยอดตามไฟล์)
 *  FREE18 : บัญชีหมาย › ประเภท 18. บัญชีจ่ายหมาย พนักงานศาลนี้ส่ง หมายฟรี
 *           → ราคาหมายฟรีรายเรื่องที่ศาลคิด (รวมหมายตามข้อ 7 แล้ว ฉบับที่รวมได้ราคา 0) → NOTICES.court_amount
 *  ไฟล์ทั้งสองอ่านฝั่งหน้าเว็บ ส่งมาเฉพาะคอลัมน์ที่ใช้ (ไม่ส่งโจทก์/จำเลย/ผู้วางเงิน)
 *  จับคู่รายเรื่องด้วย เลขดำ (บรรทัดแรก) + ชื่อผู้รับ · แถวผู้รับหลายคน (คั่นด้วย ,) แยกจับคู่ทีละชื่อ
 * ============================================================================
 */

var LEDGER_KINDS = {
  PAY: { th: 'บัญชีการจ่ายเงินให้เจ้าพนักงานศาล (ประเภท 30)', type: 'PAID',
         src: 'บัญชีเบิกจ่ายหมาย › ประเภท 30. บัญชีการจ่ายเงินให้เจ้าพนักงานศาล (แบบหลายใบเสร็จ)' },
  FREE18: { th: 'บัญชีจ่ายหมาย หมายฟรี (ประเภท 18)', type: 'BUDGET',
            src: 'บัญชีหมาย › ประเภท 18. บัญชีจ่ายหมาย พนักงานศาลนี้ส่ง หมายฟรี' }
};

/* ---------- ส่วนคำนวณล้วน ---------- */

/**
 * จับคู่แถวบัญชีกับหมายในระบบ
 * rows : [{ case_no, recipient, officer, ... }] · notices : แถว NOTICES · officers : OFFICERS · payType : 'PAID'|'BUDGET'
 * คืนแถวเดิม + { officer_id, notice_uids:[], match:'OK'|'NONE'|'TYPE' }
 */
function ledgerMatch_(rows, notices, officers, payType) {
  var offIdx = buildOfficerIndex_(officers);
  var idx = {};
  notices.forEach(function (n) {
    var k = normCase_(n.case_no) + '|' + NoticeImportFormat.recipient(n.case_no, n.recipient);
    (idx[k] = idx[k] || []).push(n);
  });
  var used = {};
  return rows.map(function (r) {
    var cs = normCase_(String(r.case_no || '').split(/\r?\n/)[0]);
    var off = resolveOfficer_(r.officer, offIdx);
    var privateRecipient = NoticeImportFormat.recipient(cs, r.recipient);
    var whole = idx[cs + '|' + privateRecipient] || [];
    var names = whole.length ? [privateRecipient] : privateRecipient.split(/\s*,\s*/).filter(String);
    var hits = [], unresolved = [], reasons = [], other = false, ambiguous = false;
    names.forEach(function (nm) {
      var all = idx[cs + '|' + nm] || [];
      var c = all.filter(function (n) { return n.pay_type === payType && (!n.officer_id || n.officer_id === off); });
      if (!c.length) { unresolved.push(nm); if (all.length) { other = true; reasons.push('ประเภทหรือผู้ส่งไม่ตรง'); } return; }
      var score = function (n) { return (r.tambon && normPlace_(n.tambon) === normPlace_(r.tambon) ? 2 : 0) + (r.notice_kind && kindOk_(r.notice_kind, {obj:n}) ? 1 : 0); };
      var max = Math.max.apply(null, c.map(score)), best = c.filter(function (n) { return score(n) === max; });
      if (best.length !== 1) { ambiguous = true; unresolved.push(nm); reasons.push('มีหมายหลายฉบับที่หลักฐานเท่ากัน'); return; }
      var n = best[0]; used[n.notice_uid] = true; if (hits.indexOf(String(n.notice_uid)) < 0) hits.push(String(n.notice_uid));
    });
    var match = ambiguous ? 'AMBIGUOUS' : hits.length && unresolved.length ? 'PARTIAL' : hits.length ? 'OK' : other ? 'TYPE' : 'NONE';
    return Object.assign({}, r, { case_no: cs, officer_id: off, notice_uids: hits, match: match, match_reason: reasons.join(' · '), unmatched_recipients: unresolved });
  });
}

/* ---------- ส่วน GAS ---------- */

function ledgerRows_(d, kind) {
  const rows = Array.isArray(d.rows) ? d.rows : [];
  if (!rows.length) throw appErr_('BAD_REQUEST', 'ไม่พบรายการในไฟล์');
  if (rows.length > cfgNum_('IMPORT_MAX_ROWS', 20000)) throw appErr_('BAD_REQUEST', 'จำนวนแถวเกินกำหนด');
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  return rows.map(function (r, i) {
    const amt = Number(String(r.amount === undefined ? '' : r.amount).replace(/,/g, ''));
    if (!isFinite(amt) || amt < 0) throw appErr_('BAD_REQUEST', 'แถว ' + (i + 1) + ': ราคาไม่ถูกต้อง');
    const o = { case_no: str_(r.case_no, 80), recipient: NoticeImportFormat.recipient(r.case_no, str_(r.recipient, 2000)), officer: str_(r.officer, 120), amount: amt };
    if (kind === 'PAY') {
      o.pay_date = parseDate_(r.pay_date); o.received_date = parseDate_(r.received_date);
      if (!o.pay_date) throw appErr_('BAD_REQUEST', 'แถว ' + (i + 1) + ': วันที่จ่ายไม่ถูกต้อง ใช้วัน/เดือน/ปี 4 หลัก');
      if (o.received_date === null) throw appErr_('BAD_REQUEST', 'แถว ' + (i + 1) + ': วันที่รับเงินไม่ถูกต้อง');
      o.receipt_no = str_(r.receipt_no, 60);
    } else {
      o.notice_kind = str_(r.notice_kind, 120); o.tambon = str_(r.tambon, 80); o.result = str_(r.result, 120);
    }
    return o;
  });
}

/** ตรวจก่อนนำเข้า / นำเข้า (commit:true) */
function apiLedgerImport_(ctx, d) {
  const kind = String(d.kind || '').toUpperCase();
  const K = LEDGER_KINDS[kind];
  if (!K) throw appErr_('BAD_REQUEST', 'ไม่รู้จักชนิดไฟล์');
  const rows = ledgerRows_(d, kind);
  if (kind === 'PAY') { const seen = {}; rows.forEach(function (r, i) { const k = digestJson_([r.pay_date, r.officer, r.case_no, r.recipient, r.receipt_no, r.received_date, r.amount]); if (seen[k]) throw appErr_('DUPLICATE', 'พบแถวธุรกรรมเหมือนกันในไฟล์ แถว ' + seen[k] + ' และ ' + (i + 1) + ' กรุณาตรวจต้นฉบับ'); seen[k] = i + 1; }); }
  const lock = d.commit ? writeLock_() : null;
  if (lock) { try { lock.waitLock(30000); } catch (e) { throw appErr_('BUSY', 'มีผู้อื่นกำลังนำเข้าหรือยืนยันรอบ กรุณาลองใหม่'); } }
  try {
    const nt = readTable_('NOTICES');
    const m = ledgerMatch_(rows, nt.rows, officersAll_(), K.type);
    if (kind === 'PAY') { const seen = {}; m.forEach(function(r,i){const k=ledgerTransactionKey_(r);if(seen[k])throw appErr_('DUPLICATE','ข้อมูลใบเสร็จและรายการเดียวกันซ้ำหรือยอดขัดกัน แถว '+seen[k]+' และ '+(i+1));seen[k]=i+1;}); }
    return kind === 'PAY' ? ledgerPay_(ctx, d, m, nt) : ledgerFree_(ctx, d, m, nt);
  } finally { if (lock) lock.releaseLock(); }
}

function ledgerSummary_(m) {
  const s = { rows: m.length, amount: 0, ok: 0, ok_amount: 0, none: 0, none_amount: 0, type: 0, no_officer: 0 };
  m.forEach(function (r) {
    s.amount += r.amount;
    if (r.match === 'OK') { s.ok++; s.ok_amount += r.amount; } else { s.none++; s.none_amount += r.amount; if (r.match === 'TYPE') s.type++; }
    if (!r.officer_id) s.no_officer++;
  });
  return s;
}

/** ช่วงวันที่ของไฟล์: หัวรายงาน "ตั้งแต่วันที่ … ถึงวันที่ …" · ไม่มี → วันที่จ่ายน้อยสุด–มากสุด (PAY) · ไฟล์ 18 ไม่มีช่วงวันที่ */
function ledgerPeriod_(d, kind) {
  const f = parseDate_(str_(d.period_from, 60)) || '', t = parseDate_(str_(d.period_to, 60)) || '';
  if (f && t) return { from: f, to: t };
  if (kind !== 'PAY') return { from: '', to: '' };
  const ds = (Array.isArray(d.rows) ? d.rows : []).map(function (r) { return String(r && r.pay_date || '').slice(0, 10); })
    .filter(function (s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }).sort();
  return { from: ds[0] || '', to: ds[ds.length - 1] || '' };
}

function batchLog_(ctx, d, kind, n, note) {
  const id = newId_(kind === 'PAY' ? 'PAY' : 'F18');
  const f = d.file || {};
  appendRows_('IMPORT_BATCHES', [{ batch_id: id, kind: kind, file_name: str_(f.name, 200), file_size: Number(f.size) || 0,
    checksum: str_(f.checksum, 80), sheet_name: str_(d.sheet, 80), rows_total: n, n_new: n, n_same: 0, n_changed: 0,
    n_ambiguous: 0, n_error: 0, n_held: 0, n_outside: 0, status: 'CONFIRMED', imported_by: ctx.user.code, imported_at: now_(), note: note,
    period_from: ledgerPeriod_(d, kind).from, period_to: ledgerPeriod_(d, kind).to }]);
  return id;
}

/** PAY: แยกตามวันที่จ่าย · วันที่ที่ยืนยันรอบแล้วไม่แตะ · วันที่ยังไม่ยืนยัน แทนที่ด้วยข้อมูลไฟล์ล่าสุด */
function ledgerPay_(ctx, d, m, nt) {
  const lt = readTable_('LEDGER');
  const lockedDates = {};
  lt.rows.forEach(function (r) { if (r.source === 'PAY' && r.round_id) lockedDates[r.pay_date] = r.round_id; });
  const byDate = {};
  m.forEach(function (r) {
    const b = byDate[r.pay_date] = byDate[r.pay_date] || { pay_date: r.pay_date, rows: 0, amount: 0, ok: 0, none: 0, none_amount: 0, locked: lockedDates[r.pay_date] || '' };
    b.rows++; b.amount += r.amount; if (r.match === 'OK') b.ok++; else { b.none++; b.none_amount += r.amount; }
  });
  const dates = Object.keys(byDate).sort().map(function (k) { return byDate[k]; });
  const off = {}; officersAll_().forEach(function (o) { off[o.officer_id] = o.name; });
  const perOff = {};
  m.forEach(function (r) { const k = r.officer_id || ('? ' + r.officer); perOff[k] = (perOff[k] || 0) + r.amount; });
  const res = { kind: 'PAY', kind_th: LEDGER_KINDS.PAY.th, source: LEDGER_KINDS.PAY.src, summary: ledgerSummary_(m), dates: dates,
                officers: Object.keys(perOff).map(function (k) { return { officer_id: k, name: off[k] || k, amount: perOff[k] }; }),
                samples_none: m.filter(function (r) { return r.match !== 'OK'; }).slice(0, 30).map(function (r) {
                  return { pay_date: r.pay_date, case_no: r.case_no, recipient: r.recipient, received_date: r.received_date, amount: r.amount, match: r.match }; }) };
  if (!d.commit) return res;
  const keep = lt.rows.slice();
  const transactionKey = ledgerTransactionKey_;
  const existing = {}, collisions={}; keep.forEach(function (r, i) { const k=transactionKey(r);if(existing[k]!==undefined)collisions[k]=true;existing[k] = i; });
  const ts = now_(), batch = batchLog_(ctx, d, 'PAY', m.length, dates.length + ' วันจ่าย');
  let seq = 0, skipped = 0;
  const fresh = [];
  m.forEach(function (r) {
    if (lockedDates[r.pay_date]) { skipped++; return; }
    const record = { ledger_id: batch + '-' + (++seq), source: 'PAY', pay_date: r.pay_date, officer_id: r.officer_id, officer_raw: r.officer,
      case_no: r.case_no, recipient: r.recipient, receipt_no: r.receipt_no, received_date: r.received_date, amount: String(r.amount), notice_uids: r.notice_uids.join(','), match: r.match, batch_id: batch, round_id: '', created_at: ts };
    const k = transactionKey(record), at = existing[k];
    if(collisions[k])throw appErr_('AMBIGUOUS','ธุรกรรมนี้มีประวัติซ้ำในฐาน กรุณาตรวจรายการเดิมก่อนปรับยอด');
    if (at !== undefined) { record.ledger_id = keep[at].ledger_id; keep[at] = record; }
    else { existing[k] = keep.length; keep.push(record); }
    fresh.push(record);
  });
  rewriteTable_('LEDGER', keep);
  audit_(ctx.user.code, 'LEDGER_PAY', batch, { rows: fresh.length, skipped_locked: skipped, dates: dates.length });
  return Object.assign(res, { batch_id: batch, imported: fresh.length, skipped_locked: skipped });
}

/** FREE18: ราคาหมายฟรีรายเรื่องตามบัญชีศาล → NOTICES.court_amount (หมายที่เข้ารอบเบิกแล้วไม่แตะ) */
function ledgerFree_(ctx, d, m, nt) {
  const byUid = {};
  m.forEach(function (r) { if (r.match !== 'OK') return; r.notice_uids.forEach(function (u) { byUid[u] = (byUid[u] || 0) + r.amount; }); });
  let same = 0, up = 0, down = 0, locked = 0, changed = 0;
  nt.rows.forEach(function (n) {
    const v = byUid[n.notice_uid]; if (v === undefined) return;
    if (n.payout_round_id) { locked++; return; }
    const sys = Number(n.calc_amount || 0);
    if (Math.abs(sys - v) < 0.005) same++; else if (v > sys) up++; else down++;
    if (String(n.court_amount) !== String(v) || !n.court_at) changed++;
  });
  const sysFree = nt.rows.filter(function (n) { return n.pay_type === 'BUDGET'; }).length;
  const res = { kind: 'FREE18', kind_th: LEDGER_KINDS.FREE18.th, source: LEDGER_KINDS.FREE18.src, summary: ledgerSummary_(m),
                compare: { same: same, court_more: up, court_less: down, locked: locked, system_free: sysFree,
                           system_not_in_file: nt.rows.filter(function (n) { return n.pay_type === 'BUDGET' && byUid[n.notice_uid] === undefined; }).length },
                changed: changed,
                samples_none: m.filter(function (r) { return r.match !== 'OK'; }).slice(0, 30).map(function (r) {
                  return { case_no: r.case_no, recipient: r.recipient, notice_kind: r.notice_kind, amount: r.amount, match: r.match }; }) };
  if (!d.commit) return res;
  const ts = now_(), batch = batchLog_(ctx, d, 'FREE18', m.length, 'ราคาหมายฟรีตามบัญชีศาล');
  const ja = nt.head.indexOf('court_amount'), jt = nt.head.indexOf('court_at');
  if (ja < 0 || jt < 0) throw appErr_('NOT_INSTALLED', 'ชีต NOTICES ยังไม่มีคอลัมน์ราคาศาล — รัน setupSystem');
  if (nt.rows.length) {
    const va = nt.rows.map(function (n) { const v = byUid[n.notice_uid]; return [v === undefined || n.payout_round_id ? String(n.court_amount || '') : String(v)]; });
    const vt = nt.rows.map(function (n) { const v = byUid[n.notice_uid]; return [v === undefined || n.payout_round_id ? String(n.court_at || '') : ts]; });
    nt.sh.getRange(2, ja + 1, va.length, 1).setNumberFormat('@').setValues(va);
    nt.sh.getRange(2, jt + 1, vt.length, 1).setNumberFormat('@').setValues(vt);
  }
  setCfg_('LAST_FREE18_AT', ts);
  audit_(ctx.user.code, 'LEDGER_FREE18', batch, { rows: m.length, matched: Object.keys(byUid).length, locked: locked });
  return Object.assign(res, { batch_id: batch, imported: Object.keys(byUid).length - locked });
}

/** เขียนชีตใหม่ทั้งตาราง (ใช้กับ LEDGER ที่ขนาดเล็ก) */
function rewriteTable_(name, objs) {
  const sh = sheet_(name), head = headOf_(name, sh);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, head.length).clearContent();
  if (objs.length) ensureGrid_(sh, objs.length + 1, head.length);
  if (objs.length) sh.getRange(2, 1, objs.length, head.length).setNumberFormat('@').setValues(objs.map(function (o) { return toRow_(name, o); }));
}

function ledgerTransactionKey_(r){return digestJson_([String(r.pay_date),String(r.officer_id),normCase_(r.case_no),NoticeImportFormat.recipient(r.case_no,r.recipient),String(r.receipt_no||''),String(r.received_date||'')]);}
