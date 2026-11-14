/** 0.7.0: read-only tracing from notice to financial round. Existing monetary rules are unchanged. */
var TRACK_STATUS_TH_ = { WAIT: 'รอผลการส่ง', REVIEW: 'รอตรวจข้อมูล', READY: 'พร้อมเบิก / ยังไม่พบประวัติรอบ', HELD: 'เลื่อนไปรอบหน้า', ROUND: 'อยู่ในรอบยืนยันแล้ว', PAID: 'จ่ายเงินจริงแล้ว', NOCLAIM: 'ปิดไม่เบิก' };
function trackingData_(ctx, d) {
  const scope = scopeOfficer_(ctx.user), rounds = {}, history = {}, held = payoutHeld_();
  readTable_('PAYOUT_ROUNDS').rows.forEach(function (r) { rounds[r.round_id] = r; });
  readTable_('PAYOUT_ITEMS').rows.forEach(function (it) {
    if (String(it.included).toUpperCase() !== 'TRUE') return;
    const r = rounds[it.round_id]; if (!r || r.status !== 'CONFIRMED') return;
    String(it.notice_uids || '').split(',').filter(String).forEach(function (u) { (history[u] = history[u] || []).push({ round_id: r.round_id, pay_date: r.pay_date, amount: Number(it.amount) || 0, payment_status: r.payment_status || '', payment_date: r.payment_date || '', payment_ref: r.payment_ref || '' }); });
  });
  const unitMembers = {}; readTable_('NOTICES').rows.forEach(function (n) { if (n.budget_unit_id) (unitMembers[n.budget_unit_id] = unitMembers[n.budget_unit_id] || []).push(n.notice_uid); });
  const names = officerNames_(), q = normText_(d.q || '').replace(/\s+/g, '').toUpperCase();
  const fy = String(d.fy || ''), type = String(d.pay_type || ''), status = String(d.status || ''), officer = scope || String(d.officer_id || '');
  const list = readTable_('NOTICES').rows.filter(function (n) {
    if (d.unit_id && n.budget_unit_id !== String(d.unit_id)) return false;
    if (officer && n.officer_id !== officer) return false;
    if (fy && String(n.fy) !== fy) return false;
    if (type && n.pay_type !== type) return false;
    if (d.from && String(n.delivered_date || n.issued_date) < String(d.from)) return false;
    if (d.to && String(n.delivered_date || n.issued_date) > String(d.to)) return false;
    return !q || [n.case_no, n.case_ref, n.red_no, n.notice_no, n.recipient].some(function (v) { return normText_(v).replace(/\s+/g, '').toUpperCase().indexOf(q) >= 0; });
  }).map(function (n) {
    const r = rounds[n.payout_round_id], hs = history[n.notice_uid] || [];
    let st = n.noclaim_at ? 'NOCLAIM' : !n.delivered_date ? 'WAIT' : /^REVIEW|WAIT_ISSUE/.test(String(n.calc_rule)) ? 'REVIEW' : held['N:' + n.notice_uid] ? 'HELD' : 'READY';
    if (r && r.status === 'CONFIRMED') st = r.payment_status === 'PAID' ? 'PAID' : 'ROUND';
    const reference = n.calc_amount === '' || n.calc_amount === undefined ? null : Number(n.calc_amount);
    const actual = effAmount_(n), diff = reference === null ? null : Math.round((actual - reference) * 100) / 100;
    return { notice_uid: n.notice_uid, fy: n.fy, pay_type: n.pay_type, case_no: n.case_no, notice_kind: n.notice_kind, recipient: n.recipient,
      officer_id: n.officer_id, officer: (names[n.officer_id] || {}).name || n.officer_raw, tambon: n.tambon, issued_date: String(n.issued_date || '').slice(0, 10), delivered_date: String(n.delivered_date || '').slice(0, 10), reported_date: String(n.reported_date || '').slice(0, 10),
      reference: reference, amount: actual, difference: diff, source: n.pay_type === 'PAID' && n.payout_round_id && n.paid_amount !== '' ? 'ยอดจ่ายตามบัญชี' : n.pay_type === 'BUDGET' && n.court_at ? 'ราคาบัญชีศาล ประเภท 18' : 'ยอดระบบคำนวณ',
      status: st, status_th: TRACK_STATUS_TH_[st], round_id: r && r.status === 'CONFIRMED' ? r.round_id : '', round_date: r ? r.pay_date : '', payment_date: r ? r.payment_date || '' : '', payment_ref: r ? r.payment_ref || '' : '',
      unit_id: n.budget_unit_id || '', grouped_count: n.budget_unit_id ? (unitMembers[n.budget_unit_id] || []).length : 1, flags: n.flags || '', history: hs };
  }).filter(function (r) { return !status || r.status === status; });
  const totals = { count: list.length, amount: 0, shortage: 0, excess: 0, shortage_n: 0, excess_n: 0, statuses: {} }, per = {};
  list.forEach(function (r) {
    totals.amount += Math.round(r.amount * 100); totals.statuses[r.status] = (totals.statuses[r.status] || 0) + 1;
    if (r.difference < 0) { totals.shortage += Math.round(-r.difference * 100); totals.shortage_n++; }
    if (r.difference > 0) { totals.excess += Math.round(r.difference * 100); totals.excess_n++; }
    const p = per[r.officer_id] = per[r.officer_id] || { officer_id: r.officer_id, officer: r.officer, count: 0, amount: 0, shortage: 0, excess: 0 };
    p.count++; p.amount += Math.round(r.amount * 100); p.shortage += Math.round(Math.max(0, -(r.difference || 0)) * 100); p.excess += Math.round(Math.max(0, r.difference || 0) * 100);
  });
  ['amount', 'shortage', 'excess'].forEach(function (k) { totals[k] /= 100; Object.keys(per).forEach(function (id) { per[id][k] /= 100; }); });
  const ledger = readTable_('LEDGER').rows.filter(function(l){return l.source==='PAY' && (!officer || l.officer_id===officer) && (!fy || fiscalYear_(String(l.pay_date),10)===fy);});
  const controls={count:ledger.length,amount:0,unmatched_n:0,unmatched_amount:0}; ledger.forEach(function(l){controls.amount+=cents2_(l.amount);if(l.match!=='OK'){controls.unmatched_n++;controls.unmatched_amount+=cents2_(l.amount);}}); controls.amount/=100;controls.unmatched_amount/=100;
  const rr=Object.keys(rounds).map(function(k){return rounds[k];}).filter(function(r){return r.status==='CONFIRMED' && (!fy || r.fy===fy) && (!type || r.round_type===(type==='BUDGET'?'FREE':'PAID'));});
  const rc={count:rr.length,amount:rr.reduce(function(a,r){if(!officer)return a+cents2_(r.total);let lines=[];try{lines=JSON.parse(r.lines_json||'[]');}catch(e){}return a+lines.filter(function(l){return l.officer_id===officer;}).reduce(function(t,l){return t+l.total_c;},0);},0)/100};
  return { ledger_summary:controls,round_summary:rc,rows: list, totals: totals, officers: names, per_officer: Object.keys(per).map(function (id) { return per[id]; }), last_imports: lastImports_(), statuses: TRACK_STATUS_TH_, scope_officer: scope };
}
function apiTracking_(ctx, d) {
  const out = trackingData_(ctx, d), page = Math.max(1, Math.floor(Number(d.page) || 1));
  out.total_rows = out.rows.length; out.page = page; out.rows = out.rows.slice((page - 1) * 100, page * 100); return out;
}
function apiReports_(ctx, d) {
  if (d.report_mode === 'closeout') return apiCloseout_(ctx, d);
  const out = trackingData_(ctx, d); delete out.rows; return out;
}
function apiRoundPayment_(ctx, d) {
  const ref = str_(d.payment_ref, 200), date = String(d.payment_date || '');
  if (!ref || !validIso_(date)) throw appErr_('BAD_REQUEST', 'ระบุวันที่จ่ายจริงและเลขที่หลักฐาน');
  const table = readTable_('PAYOUT_ROUNDS'), r = table.rows.filter(function (x) { return x.round_id === String(d.round_id); })[0];
  if (!r || r.status !== 'CONFIRMED') throw appErr_('NOT_FOUND', 'ไม่พบรอบที่ยืนยันแล้ว');
  if (r.payment_status === 'PAID') throw appErr_('ALREADY_PAID', 'รอบนี้บันทึกจ่ายจริงแล้ว');
  r.payment_status = 'PAID'; r.payment_date = date; r.payment_ref = ref; r.payment_by = ctx.user.code; r.payment_at = now_();
  updateRow_('PAYOUT_ROUNDS', r._r, r); audit_(ctx.user.code, 'ROUND_PAYMENT', r.round_id, { date: date, reference: ref }); return { round_id: r.round_id, payment_date: date };
}
function validIso_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const d = new Date(String(s) + 'T12:00:00Z'); return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === String(s);
}

/** รายงานปัจจุบันสำหรับประเมินงบ: อ่านอย่างเดียว ไม่เปลี่ยนยอด/เศษ/สถานะรอบ */
function apiCloseout_(ctx, d) {
  if (!hasRole_(ctx.user, ['FINANCE', 'NOTICE', 'ADMIN'])) throw appErr_('FORBIDDEN', 'รายงานตรวจสอบก่อนปิดงบสำหรับงานหมายและการเงิน');
  const fy = String(d.fy || currentFy_());
  if (!/^25\d{2}$/.test(fy)) throw appErr_('BAD_REQUEST', 'ระบุปีงบประมาณ พ.ศ. 4 หลัก');
  const lock = writeLock_(); lock.waitLock(30000);
  try {
    const today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
    return closeoutData_(readTable_('NOTICES').rows, readTable_('PAYOUT_ROUNDS').rows,
      readTable_('PAYOUT_ITEMS').rows, officerNames_(), fy, today, readTable_('BUDGET_UNITS').rows);
  } finally { lock.releaseLock(); }
}
function closeoutData_(notices, rounds, payoutItems, names, fy, today, budgetUnits) {
  const year = Number(fy) - 543, from = (year - 1) + '-10-01', end = year + '-09-30';
  if (today < from) throw appErr_('BAD_REQUEST', 'ยังไม่เริ่มปีงบประมาณที่เลือก');
  const to = today < end ? today : end, expired = today > end;
  const confirmed = {}, claimed = {}, legacyUnits = {}, lockedUnits = {};
  rounds.forEach(function(r) { if (r.status === 'CONFIRMED') confirmed[r.round_id] = r; });
  payoutItems.forEach(function(it) {
    if (!confirmed[it.round_id] || String(it.included).toUpperCase() !== 'TRUE') return;
    String(it.notice_uids || '').split(',').filter(String).forEach(function(uid) { claimed[uid] = true; });
  });
  (budgetUnits || []).forEach(function(u) {
    if (u.claim_ref || /^(CLAIMED|PAID)$/.test(String(u.status || ''))) legacyUnits[u.unit_id] = true;
    else if (unitLocked_(u) && !confirmed[u.payout_round_id]) lockedUnits[u.unit_id] = true;
  });
  // ใช้ตัวคำนวณเสนอเบิกเดิม รวม rule7Cap_ และราคาบัญชี 18 ไม่เขียนกลับตาราง
  const candidates = {};
  payoutFreeItems_(notices, { cutoff: to, today: today }).items.forEach(function(it) { candidates[it.notice_uids[0]] = it; });
  const totals = { count: 0, ready_n: 0, ready_units: 0, ready_amount: 0, wait_n: 0, review_n: 0, noclaim_n: 0, excluded_claimed: 0 };
  const units = {}, per = {}, rows = [];
  notices.forEach(function(n) {
    if (n.pay_type !== 'BUDGET' || String(n.fy) !== fy) return;
    const issued = String(n.issued_date || '').slice(0, 10), delivered = String(n.delivered_date || '').slice(0, 10);
    if (issued && issued > to) return;
    if (claimed[n.notice_uid] || confirmed[n.payout_round_id] || n.claim_status || legacyUnits[n.budget_unit_id]) { totals.excluded_claimed++; return; }
    const it = candidates[n.notice_uid], rule = String(n.calc_rule || '');
    let status = 'REVIEW', reason = 'รอตรวจข้อมูลก่อนเสนอเบิก', amountC = 0;
    if (expired || n.noclaim_at || (issued && issued < from) || rule === 'PRE_START') {
      status = 'NOCLAIM'; reason = expired ? 'ไม่เบิกจ่าย — ไม่ได้เบิกภายในปีงบประมาณ' : n.noclaim_at ? 'ไม่เบิกจ่าย — ปิดไม่เบิกไว้แล้ว' : 'ไม่เบิกจ่าย — จ่ายหมายก่อนเริ่มปีงบประมาณ';
    } else if (n.payout_round_id || lockedUnits[n.budget_unit_id]) {
      reason = 'มีรหัสรอบเดิมที่ต้องตรวจสอบประวัติ';
    } else if (!delivered) {
      status = 'WAIT'; reason = 'ยังไม่มีข้อมูลผลส่ง — ยังประเมินยอดเบิกไม่ได้';
    } else if (delivered < from || delivered > to) {
      reason = 'วันที่ส่งอยู่นอกช่วงตรวจสอบ';
    } else if (it) {
      status = 'READY'; reason = it.amount_c === 0 ? 'รวมยอดในหน่วยเบิกเดียวกัน — ไม่นับเงินซ้ำ' : it.held ? 'มีผลส่งแล้ว — เคยเลื่อนไปรอบหน้า' : 'มีผลส่งแล้ว — ยังไม่พบการเบิก';
      amountC = it.amount_c;
    } else if (repDate_(n) > to) {
      reason = 'วันที่รายงานผลอยู่นอกช่วงตรวจสอบ';
    }
    const oid = String(n.officer_id || ''), unit = String(n.claim_piece || n.budget_unit_id || n.notice_uid);
    const p = per[oid] = per[oid] || { officer_id: oid, officer: (names[oid] || {}).full_name || (names[oid] || {}).name || n.officer_raw || oid,
      count: 0, ready_n: 0, ready_units: 0, ready_amount: 0, wait_n: 0, review_n: 0, noclaim_n: 0 };
    totals.count++; p.count++;
    const k = status === 'READY' ? 'ready_n' : status === 'WAIT' ? 'wait_n' : status === 'NOCLAIM' ? 'noclaim_n' : 'review_n';
    totals[k]++; p[k]++;
    if (status === 'READY') {
      totals.ready_amount += amountC; p.ready_amount += amountC;
      if (!units[unit]) { units[unit] = true; totals.ready_units++; p.ready_units++; }
    }
    rows.push({ notice_uid: n.notice_uid, case_no: n.case_no, notice_no: n.notice_no || '', notice_kind: n.notice_kind || '',
      recipient: n.recipient || '', officer_id: oid, officer: p.officer,
      place: [n.house_no, n.moo ? 'ม.' + n.moo : '', n.place_key && !/^X:/.test(n.place_key) ? n.place_key.replace(/^GOV:/, 'หน่วยงาน ') : '', n.tambon ? 'ต.' + n.tambon : '', n.amphoe ? 'อ.' + n.amphoe : ''].filter(String).join(' '),
      issued_date: issued, delivered_date: delivered, report_date: repDate_(n), unit_id: unit,
      amount: amountC / 100, reference: it ? it.amount_c / 100 : effAmount_(n), source: it && it.src === 'COURT' ? 'บัญชีศาล 18 / ตรวจรวมหน่วยเดิม' : 'คำนวณตามกฎเดิม',
      status: status, reason: reason });
  });
  totals.ready_amount /= 100;
  const officers = Object.keys(per).map(function(id) { per[id].ready_amount /= 100; return per[id]; }).sort(function(a,b) { return a.officer.localeCompare(b.officer, 'th'); });
  rows.sort(function(a,b) { return String(a.officer).localeCompare(String(b.officer), 'th') || String(a.case_no).localeCompare(String(b.case_no), 'th') || String(a.notice_uid).localeCompare(String(b.notice_uid)); });
  return { report_mode: 'closeout', report_version: '0.7.2', fy: fy, from: from, to: to, fiscal_end: end, checked_at: now_(), today: today, expired: expired,
    rows: rows, per_officer: officers, totals: totals, last_imports: lastImports_(), data_period: dashboardPeriod_(readTable_('IMPORT_BATCHES').rows, fy) };
}

/** Owner-run read-only verification; no route and no persistent state changes. */
function verifyCloseoutReadOnly() {
  const tables = ['NOTICES','BUDGET_UNITS','LEDGER','PAYOUT_ROUNDS','PAYOUT_ITEMS','RATE_AREAS','RATE_BUDGET','CALC_RULES','CONFIG'];
  const hash = function() {
    DB_CACHE_ = null; HEAD_CACHE_ = {};
    return tables.map(function(k) { const rows = readTable_(k).rows; return { table: k, rows: rows.length, hash: Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(rows))) }; });
  };
  const before = hash(), report = apiCloseout_({user:{roles:['ADMIN']}},{fy:currentFy_()}), after = hash();
  const rateMap = {}; readTable_('RATE_AREAS').rows.forEach(function(a) { rateMap[a.area_id] = a; });
  const names = officerNames_(), adjustments = readTable_('NOTICES').rows.filter(function(n) { return n.fy === currentFy_() && amountAdj_(n); }).map(function(n) {
    const a = rateMap[n.area_id] || {}, adj = amountAdj_(n);
    return { officer: (names[n.officer_id] || {}).name || n.officer_raw, tambon: n.tambon, amphoe: n.amphoe,
      file: adj.src, rate_snapshot: adj.rate, rate_current: Number(a.rate) || 0, calculated: Number(n.calc_amount) || 0,
      matches_area: resolveArea_(n.amphoe,n.tambon,buildAreaIndex_(readTable_('RATE_AREAS').rows)) === n.area_id, difference: adj.diff, direction: adj.dir };
  });
  const rounds = readTable_('PAYOUT_ROUNDS').rows.filter(function(r) {return r.status==='CONFIRMED';});
  console.log(JSON.stringify({verification:'closeout-0.7.2',unchanged:JSON.stringify(before)===JSON.stringify(after),before:before,after:after,
    report:report.totals,period:report.data_period,rounds:rounds.length,round_total:rounds.reduce(function(s,r){return s+cents2_(r.total);},0)/100,adjustments:adjustments}));
}
