/**
 * ============================================================================
 *  ระบบค่าหมาย · ไฟล์ Dashboard.gs
 *  หน้าที่ : สรุปข้อมูลที่นำเข้าแล้ว (ระยะ 1–2) · ค้นเลขคดี/เลขหมาย
 *  ระยะ 3–5 จะเพิ่มยอดเงิน สถานะเบิก/จ่าย และใบสรุป 60:40 ต่อจากหน้านี้
 * ============================================================================
 */

function currentFy_() {
  return fiscalYear_(Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd'), cfgNum_('FY_START_MONTH', 10));
}

/** ผู้ส่งหมายเห็นเฉพาะของตนเอง (ถ้าไม่มีบทบาทอื่นที่เห็นทั้งหมด) */
function scopeOfficer_(user) {
  const wide = user.roles.some(function (r) { return r !== 'COURIER'; });
  return wide ? '' : (user.officer_id || '__none__');
}

/** Read-only report coverage. An upload timestamp is never a report end date. */
function dashboardPeriod_(batches, fy) {
  const from = String(Number(fy) - 544) + '-10-01', end = String(Number(fy) - 543) + '-09-30';
  const valid = function (s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + 'T12:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0,10) === s;
  };
  const last = function (kind) {
    let latest = '';
    batches.forEach(function (b) {
      if (b.kind !== kind || b.status !== 'CONFIRMED') return;
      const f = String(b.period_from || '').slice(0,10), t = String(b.period_to || '').slice(0,10);
      if (!valid(f) || !valid(t) || f > t || f > end || t < from) return;
      const covered = t > end ? end : t;
      if (covered > latest) latest = covered;
    });
    return latest;
  };
  return {from:from,to:last('ISSUE'),result_to:last('RESULT')};
}

function apiDashboard_(ctx, d) {
  const fy = str_(d.fy, 4) || currentFy_();
  const scope = scopeOfficer_(ctx.user);
  const offs = officersAll_();
  const rows = readTable_('NOTICES').rows.filter(function (r) {
    return String(r.fy) === fy && r.calc_rule !== 'PRE_START' && (!scope || r.officer_id === scope);
  });
  const per = {};
  offs.forEach(function (o) {
    if (scope && o.officer_id !== scope) return;
    per[o.officer_id] = { officer_id: o.officer_id, name: o.name, full_name: o.full_name, color: o.color,
      paid_issued: 0, paid_delivered: 0, free_issued: 0, free_delivered: 0, flagged: 0,
      money: { wait: 0, ready: 0, claim: 0, paid: 0, check: 0 }, weeks: [0, 0, 0, 0, 0, 0] };
  });
  const tot = { total: 0, paid: 0, free: 0, issued: 0, delivered: 0, flagged: 0, no_area: 0, red: 0, adj_up: 0, adj_dn: 0, no_addr: 0, date_wait: 0,
                money: { wait: 0, ready: 0, claim: 0, paid: 0, check: 0 } };
  // กราฟเส้นรายสัปดาห์: จำนวนหมายที่ส่งแล้วใน 6 สัปดาห์ล่าสุด (นับถอยหลังจากวันนี้ หรือสิ้นปีงบถ้าเป็นปีที่ผ่านมา)
  const fyEnd = new Date(Number(fy) - 543, 8, 30);
  const endMs = Math.min(Date.now(), fyEnd.getTime() + 864e5);
  rows.forEach(function (r) {
    const p = per[r.officer_id]; if (!p) return;
    const free = r.pay_type === 'BUDGET';
    const done = r.status === 'DELIVERED';
    tot.total++; tot[free ? 'free' : 'paid']++; tot[done ? 'delivered' : 'issued']++;
    p[(free ? 'free_' : 'paid_') + (done ? 'delivered' : 'issued')]++;
    if (r.flags) { p.flagged++; tot.flagged++; }
    if (!r.area_id) tot.no_area++;                                 // ไม่พบตำบลในตารางอัตรา
    const aj = amountAdj_(r);                                      // ราคาไม่เท่าอัตรา → คิดตามอัตราตำบลแล้ว (แจ้งไว้)
    if (aj) { tot[aj.dir === 'UP' ? 'adj_up' : 'adj_dn']++; }
    if (r.pay_type === 'BUDGET' && String(r.flags || '').indexOf('หมายฟรีไม่มีที่อยู่') >= 0) tot.no_addr++;
    if (r.calc_rule === 'WAIT_ISSUE_DATE') tot.date_wait++;
    if (r.noclaim_at && !r.payout_round_id) return;               // ปิด "ไม่เบิก" แล้ว — ไม่นับยอดเงิน
    const st = moneyStatus_(r), amt = effAmount_(r) || (st === 'check' ? Number(r.amount_src) || 0 : 0);
    p.money[st] += amt; tot.money[st] += amt;
    if (r.delivered_date) {
      const wk = Math.floor((endMs - new Date(String(r.delivered_date) + 'T12:00:00').getTime()) / 6048e5);
      if (wk >= 0 && wk < 6) p.weeks[5 - wk]++;
    }
  });
  const batches = readTable_('IMPORT_BATCHES').rows;
  const lastBy = function (k) { const b = batches.filter(function (x) { return x.kind === k; }).pop(); return b ? String(b.imported_at) : ''; };
  const pendingReview = scope ? 0 : readTable_('IMPORT_REVIEW').rows.filter(function (r) { return String(r.resolved).toUpperCase() !== 'TRUE'; }).length;
  const pendingChanges = scope ? 0 : readTable_('NOTICE_CHANGES').rows.filter(function (r) { return r.status === 'PENDING'; }).length;
  const startFy = Number(cfg_('PROCESS_START_FY', '')) || 0;     // ไม่แสดงปีงบก่อนเริ่มระบบ (หมายมีเงินที่ยังรอวันที่ส่ง)
  const fys = Array.from(new Set(readTable_('NOTICES').rows.map(function (r) { return String(r.fy); }).concat([currentFy_()])))
    .filter(function (y) { return y && (!startFy || Number(y) >= startFy); }).sort().reverse();
  return { fy: fy, fys: fys, totals: tot, officers: Object.keys(per).map(function (k) { return per[k]; }),
           last_issue_import: lastBy('ISSUE'), last_result_import: lastBy('RESULT'), data_period: dashboardPeriod_(batches, fy),
           pending_review: pendingReview, pending_changes: pendingChanges, scope_officer: scope };
}

/** สถานะยอดเงิน (สีเดียวกันทุกหน้าจอ): wait=เทา รอผล · ready=ส้ม พร้อมเบิก/รอวันจ่าย · claim=ฟ้า เบิกแล้วรอจ่าย · paid=เขียว จ่ายแล้ว · check=แดง รอตรวจ */
function moneyStatus_(r) {
  const rule = String(r.calc_rule || '');
  if (rule === 'WAIT_ISSUE_DATE' || /^REVIEW/.test(rule) || amountRed_(r)) return 'check';
  if (r.payout_round_id) return 'paid';
  if (r.claim_status === 'PAID') return 'paid';
  if (r.claim_status) return 'claim';
  if (!r.delivered_date) return 'wait';
  return 'ready';
}

/** ค้นเลขคดี / เลขหมาย / ชื่อผู้รับ */
function apiNoticeSearch_(ctx, d) {
  const q = normText_(d.q).replace(/\s+/g, '').toUpperCase();
  if (q.length < 2) return { rows: [] };
  const scope = scopeOfficer_(ctx.user);
  const off = {};
  officersAll_().forEach(function (o) { off[o.officer_id] = o.name; });
  const out = readTable_('NOTICES').rows.filter(function (r) {
    if (scope && r.officer_id !== scope) return false;
    return String(r.case_no).toUpperCase().indexOf(q) >= 0 || String(r.case_ref).toUpperCase().indexOf(q) >= 0 ||
           String(r.red_no).toUpperCase().indexOf(q) >= 0 || String(r.notice_no).toUpperCase() === q;
  }).slice(0, 100).map(function (r) {
    return { notice_uid: r.notice_uid, fy: r.fy, pay_type: r.pay_type, case_no: r.case_no, case_ref: r.case_ref, notice_no: r.notice_no,
             notice_kind: r.notice_kind, amount: r.amount_src, rate: r.rate_ref,
             calc_amount: r.calc_amount, money_status: moneyStatus_(r), calc_rule: CALC_RULE_TH[r.calc_rule] || r.calc_rule || '', calc_note: r.calc_note, budget_unit_id: r.budget_unit_id,
             recipient: r.recipient, place: [r.house_no, r.moo ? 'ม.' + r.moo : '', r.tambon ? 'ต.' + r.tambon : '', r.amphoe ? 'อ.' + r.amphoe : ''].filter(String).join(' '),
             officer: off[r.officer_id] || r.officer_raw, issued_date: String(r.issued_date), delivered_date: String(r.delivered_date),
             result: r.result, status: r.status, flags: r.flags, amount_red: false, amount_ok: amountOkInfo_(r), adj: amountAdj_(r),
             date_ok: String(r.date_ok || ''), payout_round_id: r.payout_round_id, budget_unit_id: r.budget_unit_id };
  });
  return { rows: out };
}

/** ยอดที่ใช้แสดง: หมายเงินที่จ่ายแล้ว = ยอดจ่ายจริง · หมายฟรีที่มีราคาบัญชีศาล (ไฟล์ 18) = ราคาศาล · อื่น ๆ = ยอดที่ระบบคำนวณ */
function effAmount_(r) {
  if (r.payout_round_id && r.paid_amount !== '' && r.paid_amount !== undefined && r.pay_type === 'PAID') return Number(r.paid_amount) || 0;
  if (r.pay_type === 'BUDGET' && r.court_at) return Number(r.court_amount) || 0;
  return Number(r.calc_amount) || 0;
}
