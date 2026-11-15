/**
 * ============================================================================
 *  ระบบค่าหมาย · ไฟล์ Payout.gs   (ระยะ 4–5: รอบเบิก / วันจ่าย 60:40 ตามบัญชีที่เบิกจ่ายจริง)
 * ----------------------------------------------------------------------------
 *  รอบ 1 รอบ = 1 ประเภท 1 วันที่จ่าย (ตามใบแบ่งยอดของศาล):
 *   FREE (หมายศาล/หมายฟรี) : ระบบเสนอหมายฟรีที่ส่งแล้ว ลงข้อมูลไม่เกินวันตัด ยังไม่เบิก
 *                            ราคา = บัญชีศาล (ไฟล์ 18) ถ้ามี · ไม่มีใช้ยอดที่ระบบคำนวณ
 *                            เอาออก = "ยังไม่เสนอเบิกจ่าย" ยกไปรอบหน้า · เบิกได้หลายครั้งต่อเดือน
 *   PAID (หมายเงิน)        : รายการจากบัญชีการจ่ายเงินให้เจ้าพนักงานศาลของวันที่จ่ายนั้นทั้งหมด (ยอดตามไฟล์)
 *  วันเดียวกันมีทั้ง 2 ประเภท: หมายฟรีก่อน แล้วยกเศษไปหมายเงิน
 *  60:40 : ยอดรายผู้ส่ง → 60% ผู้ส่ง · 40% กองกลาง → (กองกลาง + เศษยกมา) ÷ N ตามวิธีปัด (ปัดลงเป็นบาท เศษยกไป)
 *  เศษยกต่อเนื่องตามลำดับ วันที่จ่าย → ประเภท → เวลาบันทึก · ตั้งรอบได้เฉพาะต่อท้ายรอบล่าสุด
 *  บัญชี 60:40 เป็นบัญชีคำนวณภายใน แยกจากเอกสารเบิกจ่ายทางราชการ
 * ============================================================================
 */

var PAYOUT_REASON_TH = 'ยังไม่เสนอเบิกจ่าย';
var ROUND_TYPE_TH = { FREE: 'หมายศาล (หมายฟรี)', PAID: 'หมายเงิน (หมายมีเงิน)' };
var ROUNDING_TH = {
  DOWN_SATANG_CARRY: 'ปัดลงเป็นสตางค์ เศษยกไปรอบหน้า', UP_SATANG: 'ปัดขึ้นเป็นสตางค์ (ขาดหักรอบหน้า)',
  DOWN_BAHT_CARRY: 'ปัดลงเป็นบาท เศษยกไปรอบหน้า', UP_BAHT: 'ปัดขึ้นเป็นบาท (ขาดหักรอบหน้า)',
  NEAREST_BAHT: 'ปัดตามหลักเป็นบาท เศษยกไปรอบหน้า', EXACT: 'ปัดลงเป็นสตางค์ เศษให้ 1 คน'
};
var FREE_RULES_OK_ = /^(SINGLE|ONE_SAME|HALF|ONE_MOO)$/;

/* ---------- ส่วนคำนวณล้วน (ทดสอบได้นอก GAS) ---------- */

/**
 * แบ่ง 60:40 ของ 1 รอบ (หน่วยสตางค์ทั้งหมด)
 * lines : [{ officer_id, paid_c, budget_c }] · seats : N · policy : ROUNDING_POLICY · carryInC : เศษยกมา (สตางค์)
 */
function payoutSplit_(lines, seats, policy, carryInC) {
  var N = Math.floor(Number(seats) || 0);
  if (N < 1) throw new Error('จำนวนคนนั่งต้องมากกว่า 0');
  carryInC = Math.round(Number(carryInC) || 0);
  var out = lines.map(function (l) {
    var t = (l.paid_c || 0) + (l.budget_c || 0);
    var c60 = Math.round(t * 0.6);
    return { officer_id: l.officer_id, paid_c: l.paid_c || 0, budget_c: l.budget_c || 0, total_c: t,
             c60: c60, c40: t - c60, n_paid: l.n_paid || 0, n_budget: l.n_budget || 0 };
  });
  var sum = function (k) { return out.reduce(function (s, x) { return s + x[k]; }, 0); };
  var pool40 = sum('c40'), poolC = pool40 + carryInC;
  var p = String(policy || 'DOWN_BAHT_CARRY').toUpperCase(), ps, extra = 0;
  if (p === 'UP_SATANG') ps = Math.ceil(poolC / N);
  else if (p === 'DOWN_BAHT_CARRY') ps = Math.floor(poolC / N / 100) * 100;
  else if (p === 'UP_BAHT') ps = Math.ceil(poolC / N / 100) * 100;
  else if (p === 'NEAREST_BAHT') ps = Math.round(poolC / N / 100) * 100;
  else ps = Math.floor(poolC / N);                                           // DOWN_SATANG_CARRY / EXACT
  if (ps < 0) ps = 0;
  var paidOut = ps * N, carryOut = poolC - paidOut;
  if (p === 'EXACT') { extra = carryOut; carryOut = 0; paidOut = poolC; }    // เศษให้ 1 คน
  return { lines: out, paid_c: sum('paid_c'), budget_c: sum('budget_c'), total_c: sum('total_c'),
           c60: sum('c60'), pool40_c: pool40, carry_in_c: carryInC, pool_c: poolC, seats: N,
           per_seat_c: ps, extra_one_c: extra, paid_out_c: paidOut, carry_out_c: carryOut, policy: p };
}

function cents2_(v) { return Math.round(Number(String(v === undefined || v === null ? '' : v).replace(/,/g, '')) * 100) || 0; }
/** วันที่ลงข้อมูล (รายงานผล) — ศาลใช้ตัดช่วงเบิก · ไม่มีใช้วันที่ส่ง */
function repDate_(n) { return String(n.reported_date || n.delivered_date || '').slice(0, 10); }
/** ส่วนต่างยอดจริงกับยอดที่ระบบคำนวณ (คำเตือน ▲/▼ ไม่ใช่ยอดที่จ่าย) */
function diffNote_(actC, sysC, what) {
  if (!sysC || actC === sysC) return null;
  var d = Math.abs(actC - sysC) / 100, f = function (c) { return (c / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }); };
  return { dir: actC > sysC ? 'UP' : 'DOWN', diff: d,
           text: (actC > sysC ? '▲ ' : '▼ ') + what + ' ' + f(actC) + ' · ระบบคำนวณ ' + f(sysC) + ' (ต่าง ' + d.toLocaleString('en-US') + ' บาท)' };
}

/**
 * หมายฟรีพร้อมเบิก (รายเรื่อง)
 * opt : { cutoff:'yyyy-mm-dd' (วันที่ลงข้อมูลไม่เกิน), held, today }
 */
function payoutFreeItems_(notices, opt) {
  opt = opt || {};
  var cutoff = String(opt.cutoff || '9999-12-31'), held = opt.held || {}, today = String(opt.today || '');
  var items = [], blocked = { wait: 0, late: 0, review: 0, noclaim: 0 };
  notices.forEach(function (r) {
    if (r.pay_type !== 'BUDGET' || r.payout_round_id) return;
    if (r.noclaim_at) { blocked.noclaim++; return; }
    var rule = String(r.calc_rule || '');
    if (!FREE_RULES_OK_.test(rule)) { if (rule === 'WAIT_DELIVERY') blocked.wait++; else if (/^REVIEW|WAIT_ISSUE/.test(rule)) blocked.review++; return; }
    var rd = repDate_(r);
    if (rd > cutoff) { blocked.late++; return; }
    var sysC = cents2_(r.calc_amount), court = !!r.court_at, amtC = court ? cents2_(r.court_amount) : sysC;
    var key = 'N:' + r.notice_uid;
    var it = { key: key, type: 'BUDGET', officer_id: String(r.officer_id || ''), amount_c: amtC, sys_c: sysC, src: court ? 'COURT' : 'SYS',
               notice_uids: [String(r.notice_uid)], case_list: String(r.case_no || ''), notice_kind: String(r.notice_kind || ''),
               tambon: String(r.tambon || ''), delivered_date: String(r.delivered_date || '').slice(0, 10), report_date: rd,
               unit_id: String(r.budget_unit_id || ''), n: 1 };
    if (court) { var dn = diffNote_(amtC, sysC, 'บัญชีศาล'); if (dn) it.diff = dn; }
    if (held[key]) it.held = held[key];
    if (today && rd) it.age_days = Math.max(0, Math.round((Date.parse(today) - Date.parse(rd)) / 86400000));
    items.push(it);
  });
  items.sort(function (a, b) { return a.officer_id.localeCompare(b.officer_id) || a.report_date.localeCompare(b.report_date) || a.unit_id.localeCompare(b.unit_id) || a.key.localeCompare(b.key); });
  rule7Cap_(items, notices);
  return { items: items, blocked: blocked };
}

/**
 * 0.6.4 ตรวจราคาศาลซ้ำตามข้อ 7: หน่วยเบิกที่ระบบรวมเป็น 1 หมาย (หลายคดี ที่อยู่เดียวกัน ส่งคราวเดียวกัน · ONE_SAME)
 * แต่บัญชีศาล (ไฟล์ 18) ให้ราคาเต็มมากกว่า 1 ฉบับ → ยอดเบิกของหน่วยไม่เกิน 1 หมาย (ยอดที่ระบบรวมไว้)
 * ฉบับแรกได้ราคาศาล ฉบับต่อไปลดเหลือส่วนที่เหลือ (มักเป็น 0) — นับรวมฉบับที่เบิกไปแล้วในรอบก่อนด้วย
 * หลักฐาน: ใบเบิกจริงของศาล ผบE1140/2566+อ39/2569 ต.เชียงงา เบิก 800 ครั้งเดียว · ย711/2568+อ66/2569 ต.สนามแจง เบิก 750 ครั้งเดียว
 */
function rule7Cap_(items, notices) {
  var units = {};
  notices.forEach(function (n) {
    if (n.pay_type !== 'BUDGET' || String(n.calc_rule || '') !== 'ONE_SAME' || !n.budget_unit_id || n.noclaim_at) return;
    var u = units[n.budget_unit_id] = units[n.budget_unit_id] || { cap: 0, used: 0, court: 0 };
    u.cap += cents2_(n.calc_amount);
    if (n.court_at && cents2_(n.court_amount) > 0) u.court++;
    if (n.payout_round_id) u.used += n.court_at ? cents2_(n.court_amount) : cents2_(n.calc_amount);
  });
  var f = function (c) { return (c / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }); };
  items.forEach(function (it) {
    var u = units[it.unit_id];
    if (!u || u.court < 2 || it.src !== 'COURT') return;
    var amt = Math.min(it.amount_c, Math.max(0, u.cap - u.used));
    u.used += amt;
    if (amt >= it.amount_c) return;
    it.rule7 = { court_c: it.amount_c, cap_c: u.cap };
    it.diff = { dir: 'DOWN', diff: (it.amount_c - amt) / 100,
                text: '▼ รวมหมายตามข้อ 7 (หลายคดี ที่อยู่เดียวกัน ส่งคราวเดียวกัน = 1 หมาย ' + f(u.cap) + ' บาท) — บัญชีศาลให้ราคาซ้ำ ' + f(it.amount_c) + ' คิดเป็น ' + f(amt) };
    it.amount_c = amt;
  });
}

/**
 * หมายเงินของวันที่จ่าย (จากบัญชีการจ่ายเงิน) + หมายมีเงินที่ส่งแล้วแต่ไม่อยู่ในบัญชีจ่าย
 * ledger : แถว LEDGER · opt : { pay_date }
 */
function payoutPaidItems_(ledger, notices, opt) {
  var pd = String(opt.pay_date || '');
  var byUid = {}; notices.forEach(function (n) { byUid[String(n.notice_uid)] = n; });
  var inLedger = {};
  ledger.forEach(function (l) { if (l.source === 'PAY') String(l.notice_uids || '').split(',').filter(String).forEach(function (u) { inLedger[u] = true; }); });
  var items = ledger.filter(function (l) { return l.source === 'PAY' && String(l.pay_date) === pd && !l.round_id; }).map(function (l) {
    var uids = String(l.notice_uids || '').split(',').filter(String);
    var amtC = cents2_(l.amount);
    var sysC = uids.reduce(function (s, u) { return s + (byUid[u] ? cents2_(byUid[u].calc_amount) : 0); }, 0);
    var it = { key: 'L:' + l.ledger_id, ledger_id: String(l.ledger_id), type: 'PAID', officer_id: String(l.officer_id || ('?' + (l.officer_raw || ''))), officer_raw: String(l.officer_raw || ''),
               amount_c: amtC, notice_uids: uids, case_list: String(l.case_no || ''), receipt_no: String(l.receipt_no || ''),
               received_date: String(l.received_date || ''), match: String(l.match || ''), n: 1,
               delivered_date: uids.length && byUid[uids[0]] ? String(byUid[uids[0]].delivered_date || '').slice(0, 10) : '' };
    if (uids.length) { var dn = diffNote_(amtC, sysC, 'จ่ายจริง'); if (dn) it.diff = dn; }
    return it;
  });
  items.sort(function (a, b) { return a.officer_id.localeCompare(b.officer_id) || a.case_list.localeCompare(b.case_list); });
  var unpaid = notices.filter(function (n) {
    return n.pay_type === 'PAID' && !n.payout_round_id && !n.noclaim_at && String(n.calc_rule) === 'PAID' && n.delivered_date &&
           !inLedger[String(n.notice_uid)] && repDate_(n) < pd;
  }).map(function (n) {
    return { notice_uid: String(n.notice_uid), officer_id: String(n.officer_id || ''), case_no: String(n.case_no || ''), notice_kind: String(n.notice_kind || ''),
             amount_c: cents2_(n.calc_amount), report_date: repDate_(n) };
  });
  return { items: items, unpaid: unpaid };
}

/** รวมรายการที่เลือกเป็นยอดรายผู้ส่ง */
function payoutLines_(items) {
  var by = {};
  items.forEach(function (it) {
    var k = it.officer_id || ('?' + (it.officer_raw || ''));
    var l = by[k] = by[k] || { officer_id: k, paid_c: 0, budget_c: 0, n_paid: 0, n_budget: 0 };
    if (it.type === 'PAID') { l.paid_c += it.amount_c; l.n_paid += it.n; } else { l.budget_c += it.amount_c; l.n_budget += it.n; }
  });
  return Object.keys(by).sort().map(function (k) { return by[k]; });
}

/** ลำดับรอบสำหรับยกเศษ: วันที่จ่าย → หมายฟรีก่อนหมายเงิน */
function roundOrderKey_(r) {
  var t = String(r.round_type || (String(r.include_budget).toUpperCase() === 'TRUE' && String(r.include_paid).toUpperCase() !== 'TRUE' ? 'FREE' : 'PAID'));
  return String(r.pay_date) + '|' + (t === 'FREE' ? '1' : '2');
}
function confirmedRounds_(rows) {
  return rows.filter(function (r) { return r.status === 'CONFIRMED'; }).sort(function (a, b) {
    return roundOrderKey_(a).localeCompare(roundOrderKey_(b)) || String(a.created_at).localeCompare(String(b.created_at));
  });
}

/* ---------- ส่วน GAS ---------- */

function payoutHeld_() {
  // รายการที่เคยถูกเอาออก ("ยังไม่เสนอเบิกจ่าย") จากรอบที่ยืนยันแล้ว — แสดงป้ายในรอบถัดไป
  const rounds = {}; readTable_('PAYOUT_ROUNDS').rows.forEach(function (r) { rounds[r.round_id] = r; });
  const held = {};
  readTable_('PAYOUT_ITEMS').rows.forEach(function (it) {
    const r = rounds[it.round_id];
    if (!r || r.status !== 'CONFIRMED' || String(it.included).toUpperCase() === 'TRUE') return;
    const prev = held[it.item_key];
    if (!prev || String(r.pay_date) > prev.pay_date) held[it.item_key] = { round_id: r.round_id, pay_date: String(r.pay_date) };
  });
  return held;
}

/** เศษยกมาสำหรับรอบใหม่ + ตรวจว่าต่อท้ายรอบล่าสุด */
function carryFor_(rows, type, payDate) {
  const cs = confirmedRounds_(rows);
  const last = cs[cs.length - 1];
  const key = payDate + '|' + (type === 'FREE' ? '1' : '2');
  const ok = !last || roundOrderKey_(last) <= key;
  return { carry_c: last ? cents2_(last.carry_out) : cents2_(cfg_('OPENING_CARRY', '0')),
           from: last ? { round_id: last.round_id, pay_date: String(last.pay_date), type: last.round_type || '' } : null,
           order_ok: ok, last_key: last ? roundOrderKey_(last) : '' };
}

function payoutOpts_(d) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  const type = String(d.round_type || '').toUpperCase();
  if (!ROUND_TYPE_TH[type]) throw appErr_('BAD_REQUEST', 'เลือกประเภทรอบ (หมายฟรี หรือ หมายเงิน)');
  const payDate = iso.test(String(d.pay_date || '')) ? String(d.pay_date) : today;
  const cutoff = iso.test(String(d.cutoff || '')) ? String(d.cutoff) : payDate;
  return { type: type, payDate: payDate, cutoff: cutoff, today: today };
}

function officerNames_() {
  const m = {}; readTable_('OFFICERS').rows.forEach(function (o) { m[o.officer_id] = { name: String(o.first_name || '').trim(), full_name: (o.first_name + ' ' + (o.last_name || '')).trim(), color: o.color }; });
  return m;
}

function lastFree_(rows) {
  const fr = confirmedRounds_(rows).filter(function (r) { return r.round_type === 'FREE'; });
  const l = fr[fr.length - 1];
  return l ? { round_id: l.round_id, pay_date: String(l.pay_date), cutoff: String(l.cutoff_date), total: Number(l.total) } : null;
}

/** วันที่จ่ายในบัญชีการจ่ายเงินที่ยังไม่ตั้งรอบ */
function pendingPayDates_(ledger) {
  const by = {};
  ledger.forEach(function (l) {
    if (l.source !== 'PAY' || l.round_id) return;
    const b = by[l.pay_date] = by[l.pay_date] || { pay_date: String(l.pay_date), rows: 0, amount: 0, none: 0 };
    b.rows++; b.amount += Number(l.amount) || 0; if (l.match !== 'OK') b.none++;
  });
  return Object.keys(by).sort().map(function (k) { return by[k]; });
}

/** รายการเสนอเบิก (ไม่บันทึกอะไร) */
function apiPayoutCandidates_(ctx, d) {
  const o = payoutOpts_(d);
  const rows = readTable_('PAYOUT_ROUNDS').rows, nt = readTable_('NOTICES').rows;
  const carry = carryFor_(rows, o.type, o.payDate);
  const base = { round_type: o.type, round_type_th: ROUND_TYPE_TH[o.type], pay_date: o.payDate, cutoff: o.cutoff,
                 officers: officerNames_(), carry_in: carry.carry_c / 100, carry_from: carry.from, order_ok: carry.order_ok,
                 seats: Number(cfg_('DEFAULT_SEATS', '48')) || 48, policy: cfg_('ROUNDING_POLICY', 'DOWN_BAHT_CARRY'),
                 policy_th: ROUNDING_TH[cfg_('ROUNDING_POLICY', 'DOWN_BAHT_CARRY')] || '', last_free: lastFree_(rows),
                 free18_at: cfg_('LAST_FREE18_AT', '') };
  if (o.type === 'FREE') {
    const res = payoutFreeItems_(nt, { cutoff: o.cutoff, held: payoutHeld_(), today: o.today });
    return Object.assign(base, { snapshot: payoutSnapshot_(res.items, carry, o), items: res.items, blocked: res.blocked, source: LEDGER_KINDS.FREE18.src });
  }
  const lt = readTable_('LEDGER').rows;
  const res = payoutPaidItems_(lt, nt, { pay_date: o.payDate });
  return Object.assign(base, { snapshot: payoutSnapshot_(res.items, carry, o), items: res.items, unpaid: res.unpaid, pending_dates: pendingPayDates_(lt), source: LEDGER_KINDS.PAY.src });
}

/** ยืนยันรอบ: บันทึกรอบ + รายการ · ล็อกหมาย · คำนวณ 60:40 · จำ N ล่าสุด */
function apiPayoutConfirm_(ctx, d) {
  const seats = Number(d.seats);
  if (!(Number.isInteger(seats) && seats >= 1 && seats <= 1000)) throw appErr_('BAD_REQUEST', 'กรอกจำนวนคนนั่งงาน (N) 1–1000 คน');
  const excluded = {}; (Array.isArray(d.excluded) ? d.excluded : []).forEach(function (k) { excluded[String(k)] = true; });
  const lock = writeLock_();
  try { lock.waitLock(30000); } catch (e) { throw appErr_('BUSY', 'มีผู้อื่นกำลังนำเข้า คำนวณ หรือยืนยันรอบ กรุณาลองใหม่'); }
  try {
    const o = payoutOpts_(d);
    const rt = readTable_('PAYOUT_ROUNDS');
    const carry = carryFor_(rt.rows, o.type, o.payDate);
    if (!carry.order_ok) throw appErr_('BAD_REQUEST', 'ตั้งรอบได้เฉพาะต่อจากรอบล่าสุด (' + carry.last_key.replace('|1', ' หมายฟรี').replace('|2', ' หมายเงิน') + ') — รอบย้อนหลังให้ยกเลิกรอบหลังก่อน หรือตั้งตามลำดับวันที่');
    const nt = readTable_('NOTICES'), lt = o.type === 'PAID' ? readTable_('LEDGER') : null;
    const cand = o.type === 'FREE' ? payoutFreeItems_(nt.rows, { cutoff: o.cutoff, today: o.today }).items
                                   : payoutPaidItems_(lt.rows, nt.rows, { pay_date: o.payDate }).items;
    if (d.expect_count !== undefined && Number(d.expect_count) !== cand.length)
      throw appErr_('STALE', 'รายการเปลี่ยนไปแล้ว (มีผู้อื่นนำเข้า/ยืนยันรอบ) — กด "ดึงรายการ" ใหม่อีกครั้ง');
    const snapshot = payoutSnapshot_(cand, carry, o);
    if (String(d.client_version || '') >= '0.7.0' && !d.expect_snapshot) throw appErr_('STALE', 'กรุณาดึงรายการก่อนยืนยัน');
    if (d.expect_snapshot && d.expect_snapshot !== snapshot) throw appErr_('STALE', 'ยอดหรือรายการเปลี่ยนไปแล้ว กรุณาดึงรายการใหม่เพื่อดูยอดขาด/เกินก่อนยืนยัน', { snapshot: snapshot });
    const inc = o.type === 'PAID' ? cand : cand.filter(function (it) { return !excluded[it.key]; });     // หมายเงิน: จ่ายตามบัญชีทั้งหมด
    if (!inc.some(function (it) { return it.amount_c > 0; })) throw appErr_('BAD_REQUEST', 'ไม่มีรายการที่เสนอเบิกในรอบนี้');
    let carryC = carry.carry_c, carryNote = '';
    if (d.carry_in !== undefined && d.carry_in !== null && d.carry_in !== '') {
      const c = Math.round(Number(d.carry_in) * 100);
      if (!isFinite(c) || c < 0) throw appErr_('BAD_REQUEST', 'เศษยกมาไม่ถูกต้อง');
      if (c !== carry.carry_c) { if (!str_(d.carry_note, 200)) throw appErr_('BAD_REQUEST', 'กรุณาระบุเหตุผลที่แก้เศษยกมา'); carryC = c; carryNote = 'แก้เศษยกมาจาก ' + baht_(carry.carry_c) + ' เป็น ' + baht_(c) + (d.carry_note ? ' · ' + str_(d.carry_note, 200) : ''); }
    }
    const policy = cfg_('ROUNDING_POLICY', 'DOWN_BAHT_CARRY');
    const sp = payoutSplit_(payoutLines_(inc), seats, policy, carryC);
    const ts = now_();
    const rid = 'PR-' + o.payDate.replace(/-/g, '').slice(2) + (o.type === 'FREE' ? 'F' : 'P') + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();
    const b = function (c) { return baht_(c); };
    appendRows_('PAYOUT_ROUNDS', [{
      round_id: rid, fy: fiscalYear_(o.payDate, cfgNum_('FY_START_MONTH', 10)), pay_date: o.payDate, cutoff_date: o.type === 'FREE' ? o.cutoff : '',
      include_paid: o.type === 'PAID', include_budget: o.type === 'FREE', seat_count: seats, rounding_policy: sp.policy,
      n_items: inc.length, n_excluded: cand.length - inc.length,
      total_paid: b(sp.paid_c), total_budget: b(sp.budget_c), total: b(sp.total_c), courier60: b(sp.c60), pool40: b(sp.pool40_c),
      carry_in: b(sp.carry_in_c), pool_total: b(sp.pool_c), per_seat: b(sp.per_seat_c), paid_out: b(sp.paid_out_c),
      carry_out: b(sp.carry_out_c), extra_one: b(sp.extra_one_c),
      lines_json: JSON.stringify(sp.lines), status: 'CONFIRMED', note: str_(d.note, 300),
      created_by: ctx.user.code, created_at: ts, round_type: o.type,
      source_label: o.type === 'FREE' ? (cfg_('LAST_FREE18_AT', '') ? LEDGER_KINDS.FREE18.src : 'ยอดที่ระบบคำนวณ (ยังไม่นำเข้าไฟล์ 18)') : LEDGER_KINDS.PAY.src,
      carry_note: carryNote }]);
    appendRows_('PAYOUT_ITEMS', cand.map(function (it) {
      const notes = [o.type === 'FREE' && excluded[it.key] ? PAYOUT_REASON_TH : '',
                     it.match && it.match !== 'OK' ? 'ไม่พบหมายในระบบ' : '', it.diff ? it.diff.text : ''].filter(String);
      return { round_id: rid, item_key: it.key, item_type: it.type, officer_id: it.officer_id, amount: b(it.amount_c),
               notice_uids: it.notice_uids.join(','), case_list: it.case_list, delivered_date: it.delivered_date || it.report_date || '',
               included: o.type === 'PAID' || !excluded[it.key], reason: notes.join(' · '), created_at: ts, notice_kind: it.notice_kind || '', tambon: it.tambon || '', reported_date: it.report_date || '', reference_amount: it.sys_c === undefined ? '' : b(it.sys_c) };
    }));
    // ล็อกหมาย: payout_round_id (+ ยอดจ่ายจริงของหมายเงิน)
    const mark = {}, paid = {};
    inc.forEach(function (it) {
      it.notice_uids.forEach(function (u, i) { mark[u] = true; if (it.type === 'PAID') paid[u] = (paid[u] || 0) + (i === 0 ? it.amount_c : 0); });
    });
    const j = nt.head.indexOf('payout_round_id'), jp = nt.head.indexOf('paid_amount');
    if (nt.rows.length) {
      nt.sh.getRange(2, j + 1, nt.rows.length, 1).setNumberFormat('@').setValues(nt.rows.map(function (r) { return [mark[String(r.notice_uid)] ? rid : String(r.payout_round_id || '')]; }));
      if (o.type === 'PAID' && jp >= 0)
        nt.sh.getRange(2, jp + 1, nt.rows.length, 1).setNumberFormat('@').setValues(nt.rows.map(function (r) { const u = String(r.notice_uid); return [paid[u] !== undefined ? baht_(paid[u]) : String(r.paid_amount || '')]; }));
    }
    if (o.type === 'PAID') {
      const ids = {}; inc.forEach(function (it) { ids[it.ledger_id] = true; });
      rewriteTable_('LEDGER', lt.rows.map(function (l) { return ids[String(l.ledger_id)] ? Object.assign({}, l, { round_id: rid }) : l; }));
    } else {
      syncUnitLocks_(nt.rows.map(function (r) { return { notice_uid: r.notice_uid, budget_unit_id: r.budget_unit_id, payout_round_id: mark[String(r.notice_uid)] ? rid : r.payout_round_id }; }));
    }
    setCfg_('DEFAULT_SEATS', String(seats));                                      // จำ N ล่าสุด (รอบเก่าไม่เปลี่ยน)
    audit_(ctx.user.code, 'PAYOUT_CONFIRM', rid, { type: o.type, items: inc.length, excluded: cand.length - inc.length, total: b(sp.total_c), seats: seats, carry: carryNote });
    return apiPayoutGet_(ctx, { round_id: rid });
  } finally { lock.releaseLock(); }
}

/** สถานะล็อกของหน่วยเบิกหมายฟรีตามหมายในหน่วย: CLAIMED (เบิกครบ) · PARTIAL (บางฉบับ) · NOT_CLAIMED */
function syncUnitLocks_(noticeLite) {
  const byUnit = {};
  noticeLite.forEach(function (n) {
    if (!n.budget_unit_id) return;
    const u = byUnit[n.budget_unit_id] = byUnit[n.budget_unit_id] || { all: 0, done: 0, rids: [] };
    u.all++; if (n.payout_round_id) { u.done++; if (u.rids.indexOf(String(n.payout_round_id)) < 0) u.rids.push(String(n.payout_round_id)); }
  });
  const ut = readTable_('BUDGET_UNITS');
  if (!ut.rows.length) return;
  const h = ut.head, ci = function (c) { return h.indexOf(c); };
  const rows = ut.sh.getRange(2, 1, ut.rows.length, h.length).getValues();
  let touched = false;
  ut.rows.forEach(function (u, i) {
    const s = byUnit[u.unit_id]; if (!s) return;
    const st = s.done === 0 ? 'NOT_CLAIMED' : (s.done >= s.all ? 'CLAIMED' : 'PARTIAL');
    const rid = s.done ? (s.rids.indexOf(String(u.payout_round_id || '')) >= 0 ? String(u.payout_round_id) : s.rids[0]) : '';
    if (String(u.status) !== st || String(u.payout_round_id || '') !== rid) {
      rows[i][ci('status')] = st; rows[i][ci('payout_round_id')] = rid; rows[i][ci('locked')] = s.done ? 'TRUE' : 'FALSE';
      touched = true;
    }
  });
  if (touched) ut.sh.getRange(2, 1, rows.length, h.length).setValues(rows);
}

/** ยอดค้างเบิกรายผู้ส่ง (หมายฟรีพร้อมเบิก + หมายมีเงินส่งแล้วยังไม่อยู่ในบัญชีจ่าย) */
function backlogOf_(nt, lt, today) {
  const free = payoutFreeItems_(nt, { cutoff: '9999-12-31', held: payoutHeld_(), today: today });
  const paid = payoutPaidItems_(lt, nt, { pay_date: '9999-12-31' }).unpaid;
  return { free: free, paid: paid };
}

/** รายการรอบทั้งหมด + กล่อง "ยังไม่ได้เบิก" (ตัวเลขรวม ไม่มีชื่อผู้รับ — ทุกบทบาทดูได้) */
function apiPayoutList_(ctx, d) {
  const today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  const rt = readTable_('PAYOUT_ROUNDS').rows, nt = readTable_('NOTICES').rows, lt = readTable_('LEDGER').rows;
  const rounds = rt.map(function (r) {
    return { round_id: r.round_id, fy: r.fy, pay_date: r.pay_date, cutoff_date: r.cutoff_date, round_type: r.round_type || '',
             seats: Number(r.seat_count), n_items: Number(r.n_items), n_excluded: Number(r.n_excluded),
             total_paid: Number(r.total_paid), total_budget: Number(r.total_budget), total: Number(r.total),
             per_seat: Number(r.per_seat), carry_in: Number(r.carry_in), carry_out: Number(r.carry_out), status: r.status, created_at: r.created_at };
  }).sort(function (a, b) { return roundOrderKey_(b).localeCompare(roundOrderKey_(a)) || String(b.created_at).localeCompare(String(a.created_at)); });
  const bl = backlogOf_(nt, lt, today);
  const by = {};
  const get = function (k) { return by[k] = by[k] || { officer_id: k, paid_n: 0, paid_c: 0, budget_n: 0, budget_c: 0, held_n: 0, oldest: 0 }; };
  bl.free.items.forEach(function (it) {
    const b = get(it.officer_id); b.budget_n += it.n; b.budget_c += it.amount_c; if (it.held) b.held_n++;
    if ((it.age_days || 0) > b.oldest) b.oldest = it.age_days;
  });
  bl.paid.forEach(function (n) {
    const b = get(n.officer_id); b.paid_n++; b.paid_c += n.amount_c;
    const age = Math.max(0, Math.round((Date.parse(today) - Date.parse(n.report_date)) / 86400000)); if (age > b.oldest) b.oldest = age;
  });
  const backlog = Object.keys(by).sort().map(function (k) {
    const b = by[k]; return { officer_id: k, paid_n: b.paid_n, paid: b.paid_c / 100, budget_n: b.budget_n, budget: b.budget_c / 100, held_n: b.held_n, oldest_days: b.oldest };
  });
  const closed = nt.filter(function (n) { return n.noclaim_at && !n.payout_round_id; }).length;
  return { rounds: rounds, backlog: backlog, blocked: bl.free.blocked, closed_n: closed, officers: officerNames_(),
           pending_dates: pendingPayDates_(lt), last_free: lastFree_(rt), free18_at: cfg_('LAST_FREE18_AT', ''),
           sources: { FREE18: LEDGER_KINDS.FREE18.src, PAY: LEDGER_KINDS.PAY.src },
           can_create: hasRole_(ctx.user, ['NOTICE', 'FINANCE', 'ADMIN']), can_cancel: hasRole_(ctx.user, ['ADMIN']),
           can_detail: hasRole_(ctx.user, ['NOTICE', 'CASE', 'FINANCE', 'COURIER', 'ADMIN']) };
}

/** รายการค้างเบิก/ไม่เบิกรายเรื่อง (บทบาทที่เห็นข้อมูลคดี) */
function apiPayoutBacklog_(ctx, d) {
  const today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  const nt = readTable_('NOTICES').rows, lt = readTable_('LEDGER').rows;
  const scope = scopeOfficer_(ctx.user);
  const bl = backlogOf_(nt, lt, today);
  const keep = function (o) { return !scope || o === scope; };
  const free = bl.free.items.filter(function (it) { return keep(it.officer_id); }).map(function (it) {
    return { notice_uid: it.notice_uids[0], type: 'BUDGET', officer_id: it.officer_id, case_no: it.case_list, notice_kind: it.notice_kind,
             report_date: it.report_date, amount: it.amount_c / 100, src: it.src, held: it.held || null, age_days: it.age_days || 0 };
  });
  const paid = bl.paid.filter(function (n) { return keep(n.officer_id); }).map(function (n) {
    return { notice_uid: n.notice_uid, type: 'PAID', officer_id: n.officer_id, case_no: n.case_no, notice_kind: n.notice_kind,
             report_date: n.report_date, amount: n.amount_c / 100, age_days: Math.max(0, Math.round((Date.parse(today) - Date.parse(n.report_date)) / 86400000)) };
  });
  const closed = nt.filter(function (n) { return n.noclaim_at && !n.payout_round_id && keep(String(n.officer_id)); }).map(function (n) {
    return { notice_uid: n.notice_uid, type: n.pay_type, officer_id: n.officer_id, case_no: n.case_no, notice_kind: n.notice_kind,
             report_date: repDate_(n), amount: (n.pay_type === 'BUDGET' && n.court_at ? Number(n.court_amount) : Number(n.calc_amount)) || 0,
             reason: n.noclaim_reason, by: n.noclaim_by, at: n.noclaim_at };
  });
  return { items: free.concat(paid).sort(function (a, b) { return a.officer_id.localeCompare(b.officer_id) || a.report_date.localeCompare(b.report_date); }),
           closed: closed, officers: officerNames_(), can_close: hasRole_(ctx.user, ['ADMIN']) };
}

/** ผู้ดูแลระบบ: ปิดเป็น "ไม่เบิก" พร้อมเหตุผล · undo = เปิดคืนให้ค้างเบิก */
function apiPayoutNoclaim_(ctx, d) {
  const uids = uidsOf_(d), undo = !!d.undo, reason = str_(d.reason, 300);
  if (!undo && !reason) throw appErr_('BAD_REQUEST', 'กรุณาระบุเหตุผลที่ไม่เบิก');
  return lockedEdit_(ctx, function () {
    const want = {}; uids.forEach(function (u) { want[u] = true; });
    const ts = now_(), who = (ctx.user.code + ' ' + (ctx.user.name || '')).trim();
    let n = 0;
    readTable_('NOTICES').rows.forEach(function (r) {
      if (!want[r.notice_uid] || r.payout_round_id) return;
      if (undo) { if (!r.noclaim_at) return; r.noclaim_reason = ''; r.noclaim_by = ''; r.noclaim_at = ''; }
      else { r.noclaim_reason = reason; r.noclaim_by = who; r.noclaim_at = ts; }
      r.updated_at = ts; updateRow_('NOTICES', r._r, r); n++;
    });
    audit_(ctx.user.code, undo ? 'NOCLAIM_UNDO' : 'NOCLAIM', uids.slice(0, 50).join(','), { n: n, reason: reason });
    return { updated: n };
  });
}

/** รายละเอียดรอบ (รายการเลขคดีเฉพาะบทบาทที่เห็นข้อมูลคดี) */
function apiPayoutGet_(ctx, d) {
  const rid = str_(d.round_id, 40);
  const all = readTable_('PAYOUT_ROUNDS').rows;
  const r = all.filter(function (x) { return x.round_id === rid; })[0];
  if (!r) throw appErr_('NOT_FOUND', 'ไม่พบรอบเบิก ' + rid);
  let lines = []; try { lines = JSON.parse(r.lines_json || '[]'); } catch (e) { lines = []; }
  const scope = scopeOfficer_(ctx.user);
  if (scope) lines = lines.filter(function (l) { return l.officer_id === scope; });
  const showItems = hasRole_(ctx.user, ['NOTICE', 'CASE', 'FINANCE', 'COURIER', 'ADMIN']);
  const items = showItems ? readTable_('PAYOUT_ITEMS').rows.filter(function (it) { return it.round_id === rid && (!scope || it.officer_id === scope); }).map(function (it) {
    return { key: it.item_key, type: it.item_type, officer_id: it.officer_id, amount: Number(it.amount), case_list: it.case_list,
             n: String(it.notice_uids || '').split(',').filter(String).length, delivered_date: it.delivered_date,
             notice_kind: it.notice_kind || '', tambon: it.tambon || '', reported_date: it.reported_date || '',
             included: String(it.included).toUpperCase() === 'TRUE', reason: it.reason };
  }) : [];
  const num = function (k) { return Number(r[k] || 0); };
  const cs = confirmedRounds_(all), last = cs[cs.length - 1];
  return { round: { round_id: r.round_id, fy: r.fy, pay_date: r.pay_date, cutoff_date: r.cutoff_date, status: r.status,
                    round_type: r.round_type || '', round_type_th: ROUND_TYPE_TH[r.round_type] || '', source_label: r.source_label || '', carry_note: r.carry_note || '', payment_status: r.payment_status || '', payment_date: r.payment_date || '', payment_ref: r.payment_ref || '',
                    include_paid: String(r.include_paid).toUpperCase() === 'TRUE', include_budget: String(r.include_budget).toUpperCase() === 'TRUE',
                    seats: num('seat_count'), policy: r.rounding_policy, policy_th: ROUNDING_TH[r.rounding_policy] || r.rounding_policy,
                    total_paid: num('total_paid'), total_budget: num('total_budget'), total: num('total'), courier60: num('courier60'),
                    pool40: num('pool40'), carry_in: num('carry_in'), pool_total: num('pool_total'), per_seat: num('per_seat'),
                    paid_out: num('paid_out'), carry_out: num('carry_out'), extra_one: num('extra_one'),
                    n_items: num('n_items'), n_excluded: num('n_excluded'), note: r.note, created_by: r.created_by, created_at: r.created_at,
                    cancelled_by: r.cancelled_by, cancelled_at: r.cancelled_at, cancel_reason: r.cancel_reason },
           lines: lines.map(function (l) { return { officer_id: l.officer_id, paid: l.paid_c / 100, budget: l.budget_c / 100, total: l.total_c / 100,
                                                     c60: l.c60 / 100, c40: l.c40 / 100, n_paid: l.n_paid, n_budget: l.n_budget }; }),
           items: items, officers: officerNames_(),
           can_payment: hasRole_(ctx.user, ['FINANCE', 'ADMIN']) && r.status === 'CONFIRMED' && r.payment_status !== 'PAID',
           can_cancel: r.payment_status !== 'PAID' && hasRole_(ctx.user, ['ADMIN']) && r.status === 'CONFIRMED' && !!last && last.round_id === rid };
}

/** ยกเลิกรอบล่าสุด (ผู้ดูแลระบบ + เหตุผล) — ปลดล็อกหมาย/บัญชีจ่ายกลับเป็นพร้อมเบิก */
function apiPayoutCancel_(ctx, d) {
  const rid = str_(d.round_id, 40), reason = str_(d.reason, 300);
  if (!reason) throw appErr_('BAD_REQUEST', 'กรุณาระบุเหตุผลที่ยกเลิกรอบ');
  const lock = writeLock_();
  try { lock.waitLock(30000); } catch (e) { throw appErr_('BUSY', 'ระบบกำลังทำงานอื่น กรุณาลองใหม่'); }
  try {
    const rt = readTable_('PAYOUT_ROUNDS');
    const r = rt.rows.filter(function (x) { return x.round_id === rid; })[0];
    if (!r || r.status !== 'CONFIRMED') throw appErr_('NOT_FOUND', 'ไม่พบรอบที่ยืนยันแล้ว ' + rid);
    if (r.payment_status === 'PAID') throw appErr_('BAD_REQUEST', 'รอบที่มีหลักฐานจ่ายจริงแล้วต้องตรวจปรับปรุงผ่านผู้ดูแล ไม่ยกเลิกโดยตรง');
    const cs = confirmedRounds_(rt.rows);
    if (cs[cs.length - 1].round_id !== rid) throw appErr_('BAD_REQUEST', 'ยกเลิกได้เฉพาะรอบล่าสุด (เพื่อไม่ให้เศษยกยอดคลาดเคลื่อน)');
    const nt = readTable_('NOTICES'), j = nt.head.indexOf('payout_round_id'), jp = nt.head.indexOf('paid_amount');
    let n = 0;
    if (nt.rows.length) {
      nt.sh.getRange(2, j + 1, nt.rows.length, 1).setNumberFormat('@').setValues(nt.rows.map(function (x) { if (String(x.payout_round_id) === rid) { n++; return ['']; } return [String(x.payout_round_id || '')]; }));
      if (jp >= 0) nt.sh.getRange(2, jp + 1, nt.rows.length, 1).setNumberFormat('@').setValues(nt.rows.map(function (x) { return [String(x.payout_round_id) === rid ? '' : String(x.paid_amount || '')]; }));
    }
    syncUnitLocks_(nt.rows.map(function (x) { return { notice_uid: x.notice_uid, budget_unit_id: x.budget_unit_id, payout_round_id: String(x.payout_round_id) === rid ? '' : x.payout_round_id }; }));
    const lt = readTable_('LEDGER');
    if (lt.rows.some(function (l) { return l.round_id === rid; }))
      rewriteTable_('LEDGER', lt.rows.map(function (l) { return l.round_id === rid ? Object.assign({}, l, { round_id: '' }) : l; }));
    r.status = 'CANCELLED'; r.cancelled_by = ctx.user.code; r.cancelled_at = now_(); r.cancel_reason = reason;
    updateRow_('PAYOUT_ROUNDS', r._r, r);
    audit_(ctx.user.code, 'PAYOUT_CANCEL', rid, { reason: reason, notices: n });
    return { round_id: rid, released: n };
  } finally { lock.releaseLock(); }
}

function payoutSnapshot_(items, carry, o) {
  return digestJson_({ type: o.type, date: o.payDate, cutoff: o.cutoff, carry: carry.carry_c, policy: cfg_('ROUNDING_POLICY', 'DOWN_BAHT_CARRY'), items: items.map(function (it) { return [it.key, it.amount_c, it.officer_id, it.notice_uids, it.report_date || '', it.match || '']; }).sort(function (a,b) { return String(a[0]).localeCompare(String(b[0])); }) });
}
