/**
 * ============================================================================
 *  ระบบค่าหมาย · ไฟล์ Calc.gs   (ระยะ 3 · คำนวณค่าหมาย)
 *  หน้าที่ : คิดยอดเงินรายหมาย · รวมหมายฟรีเป็น "หน่วยเบิก" ตามระเบียบ ก.บ.ศ. 2562 ข้อ 7
 * ----------------------------------------------------------------------------
 *  หมายมีเงิน : ยอด = "ราคา" ในบัญชีจ่ายหมาย (เงินที่วางจริง) ไม่คิดใหม่
 *  หมายฟรี   : อัตรา อ.เมืองลพบุรี = RATE_BUDGET (300) · อำเภออื่น = อัตราตำบล (RATE_AREAS)
 *              "คราวเดียวกัน" = ผู้ส่งเดียวกัน + วันที่ส่งเดียวกัน + ตำบลเดียวกัน + หมู่เดียวกัน
 *              (ไม่มีหมู่ → ใช้หน่วยงาน/ถนน/ซอยแทน ตาม place_key ที่ได้จากการนำเข้า)
 *              ในคราวเดียวกัน รวม "ที่อยู่เดียวกัน" หรือ "คดีเดียวกัน" เป็นหน่วยย่อย
 *                · หน่วยย่อยเดียว            = เต็มอัตรา 1 หมาย      ข้อ 7(1)(2)
 *                · หลายหน่วยย่อย (HALF)     = หน่วยละกึ่งหนึ่ง      ข้อ 7(3)
 *                · หลายหน่วยย่อย (ONE)      = เต็มอัตรา 1 หมาย (ทางเลือกในชีต CALC_RULES)
 *  ยังไม่มีวันที่ส่ง → ยังไม่คิด (รอไฟล์ผลหมาย) · ผลส่งได้/ไม่ได้ ไม่มีผลต่อเงิน (ข้อตกลงหน้างาน)
 *  หน่วยเบิกที่ล็อกแล้ว (เข้ารอบจ่าย/บัญชีเบิก) ไม่คำนวณทับ — หมายที่มาทีหลังขึ้น "รอตรวจ"
 *  ส่วนตรรกะล้วน (calcCompute_) ทดสอบด้วย node ได้ (test/calc.test.js)
 * ============================================================================
 */

var CALC_RULE_TH = {
  PAID: 'หมายมีเงิน · ตามราคาที่วาง',
  SINGLE: 'หมายฟรี · 1 ฉบับ เต็มอัตรา',
  ONE_SAME: 'หมายฟรี · ที่อยู่/คดีเดียวกัน คราวเดียวกัน = 1 หมาย (ข้อ 7(1)(2))',
  HALF: 'หมายฟรี · หลายคดีต่างบ้าน หมู่เดียวกัน = หมายละกึ่งหนึ่ง (ข้อ 7(3))',
  ONE_MOO: 'หมายฟรี · หมู่เดียวกัน คราวเดียวกัน = 1 หมาย (ตั้งค่า ONE)',
  WAIT_DELIVERY: 'รอวันที่ส่ง (ยังไม่คิดเงิน)',
  REVIEW_RATE: 'รอตรวจ · ไม่พบอัตรา',
  REVIEW_LATE: 'รอตรวจ · หมายเข้ามาหลังหน่วยเบิกถูกล็อก',
  PRE_START: 'ก่อนเริ่มปีงบ · ไม่นับ',
  WAIT_ISSUE_DATE: 'อาจจ่ายเดือน ก.ย. · รอยืนยันวันที่จ่าย (ยังไม่คิดเงิน)'
};

/* ---------- ตรรกะล้วน ---------- */
function cents_(v) { return Math.round(Number(v) * 100); }
function baht_(c) { return String(Math.round(c) / 100); }

/**
 * notices : [{ notice_uid, pay_type, case_no, house_no, moo, place_key, addr_type, area_id, officer_id,
 *              delivered_date, amount_src, fy }]
 * opt     : { areaRate:{area_id:rate}, budgetRate:{amphoe_code:rate}, mode:'HALF'|'ONE',
 *              locked:{unit_id:{notice_uids:[...]}}, fyStartMonth, startFy, startDate }
 *  หมายก่อนเริ่มปีงบ: หมายฟรีที่จ่ายก่อนวันเริ่ม ไม่นับ · หมายมีเงินนับเมื่อวันที่ส่งอยู่ในปีงบที่เริ่มแล้ว
 * คืน     : { byNotice:{uid:{calc_amount,calc_rule,calc_note,budget_unit_id}}, units:[...], warnings:[...] }
 */
function calcCompute_(notices, opt) {
  opt = opt || {};
  var mode = String(opt.mode || 'HALF').toUpperCase() === 'ONE' ? 'ONE' : 'HALF';
  var locked = opt.locked || {};
  var startFy = Number(opt.startFy) || 0, startDate = String(opt.startDate || '');
  var lockedUid = {};
  Object.keys(locked).forEach(function (u) { (locked[u].notice_uids || []).forEach(function (n) { lockedUid[n] = u; }); });
  var byNotice = {}, warnings = [], groups = {};

  var inRound = opt.inRound || {}, fyStartM = opt.fyStartMonth || 10;
  notices.forEach(function (n) {
    var uid = String(n.notice_uid);
    if (n.split_parent_uid) {
      byNotice[uid] = { calc_amount: '0', calc_rule: 'SPLIT_COPY', calc_note: 'ฉบับแยกนับจำนวน ร่วมยอดกับฉบับต้นทาง ไม่คิดเงินเพิ่ม', budget_unit_id: n.budget_unit_id || '', claim_piece: n.claim_piece || '' };
      return;
    }
    if (lockedUid[uid]) return;                                   // อยู่ในหน่วยที่ล็อกแล้ว — ไม่แตะ
    if (n.payout_round_id || inRound[uid]) return;                // 0.7.10 อยู่ในรอบยืนยันแล้ว (รวมประวัติรอบ) — คงยอดเดิม ไม่คำนวณทับ
    // ไฟล์ 50 คร่อมวันเริ่มปีงบ และยังไม่มีวันที่จ่ายจากไฟล์ 42 → ยังไม่รู้ว่านับหรือไม่ ยังไม่คิดเงิน
    // งานหมายยืนยันเองได้: BEFORE = จ่ายเดือน ก.ย. (ก่อนเริ่มปีงบ) ไม่นับ · AFTER = จ่ายตั้งแต่วันเริ่ม คิดตามปกติ
    // 0.7.10 หมายมีเงินนับตามวันที่ส่ง: มีวันที่ส่งแล้วไม่ต้องรอยืนยันวันที่จ่าย · ยืนยัน ก.ย. แต่ยังไม่มีวันที่ส่ง = ก่อนเริ่มปีงบ ไม่นับจนกว่าจะมีวันที่ส่งในปีงบใหม่
    var unsure = String(n.flags || '').indexOf(FLAG_DATE_UNSURE) >= 0 && !n.issued_date;
    if (unsure && n.pay_type === 'PAID' && (n.delivered_date || String(n.date_ok || '') === 'BEFORE')) {
      var dd = String(n.delivered_date || '').slice(0, 10);
      if (!dd) {
        byNotice[uid] = { calc_amount: '', calc_rule: 'PRE_START', budget_unit_id: '',
          calc_note: 'จ่ายเดือน ก.ย. — ยังไม่มีวันที่ส่งในปีงบที่เริ่มแล้ว จึงไม่นับในปีงบใหม่' };
        return;
      }
      if (startDate && dd < startDate) {
        byNotice[uid] = { calc_amount: '', calc_rule: 'PRE_START', budget_unit_id: '',
          calc_note: 'หมายมีเงินส่งก่อนเริ่มปีงบ — ไม่นับ' };
        return;
      }
      unsure = false;                                             // ส่งในปีงบแล้ว — คิดตามปกติ (ไม่ใช้ช่อง fy เดิม)
      n = Object.assign({}, n, { fy: fiscalYear_(dd, fyStartM) || n.fy });
    }
    if (unsure) {
      var dok = String(n.date_ok || '');
      if (dok === 'BEFORE') {
        byNotice[uid] = { calc_amount: '', calc_rule: 'PRE_START', budget_unit_id: '',
          calc_note: 'จ่ายเดือน ก.ย. (ก่อนเริ่มปีงบ) — ยืนยันโดย ' + (n.date_ok_by || 'งานหมาย') };
        return;
      }
      if (dok !== 'AFTER') {
        byNotice[uid] = { calc_amount: '', calc_rule: 'WAIT_ISSUE_DATE', budget_unit_id: '',
          calc_note: 'อาจจ่ายเดือน ก.ย. — ไม่พบวันที่จ่ายในไฟล์ 42 (หมายฟรีจ่ายก่อนวันเริ่มปีงบไม่นับ · หมายมีเงินนับตามวันที่ส่ง)' };
        return;
      }
    }
    var preFy = startFy && Number(n.fy) && Number(n.fy) < startFy;
    var preFree = n.pay_type === 'BUDGET' && n.issued_date && ((startDate && String(n.issued_date) < startDate) ||
      // 0.7.10 ทุกปีงบ: หมายฟรีจ่ายหมายปีงบหนึ่ง แต่ส่งในปีงบถัดไป → ไม่นับในปีงบใหม่ (ไม่รวมหน่วยกับหมายของปีใหม่)
      (n.delivered_date && fiscalYear_(String(n.issued_date).slice(0, 10), fyStartM) < fiscalYear_(String(n.delivered_date).slice(0, 10), fyStartM)));
    if (preFy || preFree) {
      byNotice[uid] = { calc_amount: '', calc_rule: 'PRE_START', budget_unit_id: '',
        calc_note: n.pay_type === 'PAID' ? 'จ่ายก่อนเริ่มปีงบ — นับเมื่อวันที่ส่งอยู่ในปีงบที่เริ่มแล้ว' : 'หมายฟรีจ่ายก่อนเริ่มปีงบ — ไม่นับ' };
      return;
    }
    if (n.pay_type === 'PAID') {
      var adj = amountAdj_(n);                                    // ราคาไม่เท่าอัตราตำบล → คิดตามอัตราตำบล
      var a = adj ? baht_(cents_(adj.rate)) : (String(n.amount_src || '') === '' ? '' : baht_(cents_(n.amount_src)));
      byNotice[uid] = { calc_amount: a, calc_rule: 'PAID', calc_note: adj ? adjNote_(adj) : (a === '' ? 'ไม่มีราคา' : ''), budget_unit_id: '' };
      return;
    }
    if (n.pay_type !== 'BUDGET') return;
    if (!n.delivered_date) { byNotice[uid] = { calc_amount: '', calc_rule: 'WAIT_DELIVERY', calc_note: '', budget_unit_id: '' }; return; }
    var rate = budgetRateOf_(n.area_id, opt);
    if (!rate) { byNotice[uid] = { calc_amount: '', calc_rule: 'REVIEW_RATE', calc_note: 'ไม่พบอัตราของตำบล', budget_unit_id: '' }; return; }
    var place = n.place_key || (n.moo ? 'ม.' + n.moo : '');
    var urbanTambon = n.addr_type === 'URBAN' && String(opt.urbanGroup || 'TAMBON') !== 'ROAD';
    if (urbanTambon && place) place = 'เขตเมือง';                 // ไม่มีหมู่: ทั้งตำบลเป็นกลุ่มเดียวกัน (ตามบัญชีของศาล)
    var noPlace = !place;
    if (noPlace) place = 'X:' + uid;                              // ไม่มีที่อยู่ → นับแยกฉบับ
    var gk = [n.officer_id, n.delivered_date, n.area_id, place].join('|');
    var g = groups[gk] = groups[gk] || { key: gk, officer_id: n.officer_id, delivered_date: n.delivered_date,
      area_id: n.area_id, place_key: place, addr_type: n.addr_type || '', rate: rate, items: [] };
    g.items.push({ n: n, uid: uid, noPlace: noPlace, street: urbanTambon ? String(n.place_key || '') : '' });
  });

  var units = [];
  Object.keys(groups).sort().forEach(function (gk) {
    var g = groups[gk];
    var fy = fiscalYear_(g.delivered_date, opt.fyStartMonth || 10);
    var base = 'BU-' + fy + '-' + fnv_(gk).toUpperCase();
    if (locked[base]) {                                           // คราวนี้ถูกล็อกไปแล้ว หมายใหม่ห้ามรวมเอง
      g.items.forEach(function (it) {
        byNotice[it.uid] = { calc_amount: '', calc_rule: 'REVIEW_LATE', calc_note: 'คราวเดียวกับ ' + base + ' ที่ล็อกแล้ว', budget_unit_id: '' };
      });
      warnings.push({ type: 'LATE', unit_id: base, officer_id: g.officer_id, date: g.delivered_date, area_id: g.area_id,
        place_key: g.place_key, count: g.items.length, text: 'หมายฟรี ' + g.items.length + ' ฉบับ เข้ามาหลังหน่วยเบิก ' + base + ' ถูกล็อก' });
      return;
    }
    // หน่วยย่อย: ที่อยู่เดียวกัน หรือ คดีเดียวกัน (union-find)
    var parent = g.items.map(function (_, i) { return i; });
    var find = function (i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    var join = function (a, b) { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
    var seenAddr = {}, seenCase = {};
    g.items.forEach(function (it, i) {
      var addr = it.noPlace ? '' : (g.addr_type === 'GOV' ? g.place_key : (it.n.house_no ? 'H:' + String(it.n.house_no).replace(/\s+/g, '') + (it.street ? '@' + it.street.replace(/\s+/g, '') : '') : ''));
      if (addr) { if (seenAddr[addr] !== undefined) join(seenAddr[addr], i); else seenAddr[addr] = i; }
      var cs = String(it.n.case_no || '');
      if (cs) { if (seenCase[cs] !== undefined) join(seenCase[cs], i); else seenCase[cs] = i; }
    });
    var comps = {};
    g.items.forEach(function (it, i) { var r = find(i); (comps[r] = comps[r] || []).push(it); });
    var compList = Object.keys(comps).map(function (k) { return comps[k]; });
    var k = compList.length, rateC = cents_(g.rate);
    var rule, mult, totalC;
    if (g.items.length === 1) { rule = 'SINGLE'; mult = 1; totalC = rateC; }
    else if (k === 1) { rule = 'ONE_SAME'; mult = 1; totalC = rateC; }
    else if (mode === 'HALF') { rule = 'HALF'; mult = 0.5; totalC = Math.round(rateC / 2) * k; }
    else { rule = 'ONE_MOO'; mult = 1 / k; totalC = rateC; }
    // แบ่งยอดลงรายฉบับ (เศษสตางค์ไปฉบับสุดท้าย) — ผลรวมรายฉบับ = ยอดหน่วยเบิกเสมอ
    var compC = compList.map(function (c, i) {
      if (rule === 'ONE_MOO') { var each = Math.floor(totalC / k); return i === k - 1 ? totalC - each * (k - 1) : each; }
      return rule === 'HALF' ? Math.round(rateC / 2) : rateC;
    });
    compList.forEach(function (c, ci) {
      var each = Math.floor(compC[ci] / c.length);
      c.forEach(function (it, j) {
        var amt = j === c.length - 1 ? compC[ci] - each * (c.length - 1) : each;
        byNotice[it.uid] = { calc_amount: baht_(amt), calc_rule: rule,
          calc_note: it.noPlace ? 'ไม่มีที่อยู่ นับแยกฉบับ' : (c.length > 1 ? 'รวม ' + c.length + ' ฉบับเป็น 1 หมาย' : ''), budget_unit_id: base,
          claim_piece: rule === 'HALF' ? base + '#' + (ci + 1) : base };   // ชิ้นเบิก: ข้อ 7(3) แยกรายบ้าน · กรณีอื่นทั้งหน่วย
      });
    });
    units.push({ unit_id: base, fy: fy, officer_id: g.officer_id, delivered_date: g.delivered_date, area_id: g.area_id,
      place_key: g.place_key, addr_type: g.addr_type, rule_code: rule, notice_count: g.items.length, sub_units: k,
      rate_base: String(g.rate), multiplier: String(mult), amount: baht_(totalC),
      notice_uids: g.items.map(function (it) { return it.uid; }).join(','),
      case_list: Array.from(new Set(g.items.map(function (it) { return String(it.n.case_no || ''); }))).filter(String).join(', ') });
    if (g.items.some(function (it) { return it.noPlace; }))
      warnings.push({ type: 'NO_ADDRESS', unit_id: base, officer_id: g.officer_id, date: g.delivered_date, area_id: g.area_id,
        count: g.items.length, text: 'หมายฟรีไม่มีที่อยู่ นับเต็มอัตราแยกฉบับ — ควรตรวจกับต้นฉบับ' });
  });

  // ข้อ 7: วันเดียวกัน หมู่เดียวกัน แต่แยก 2 ผู้ส่งขึ้นไป → แจ้งงานหมาย (ไม่ตัดยอด)
  var cross = {};
  units.forEach(function (u) {
    if (/^X:/.test(u.place_key)) return;
    var ck = [u.delivered_date, u.area_id, u.place_key].join('|');
    (cross[ck] = cross[ck] || []).push(u);
  });
  Object.keys(cross).forEach(function (ck) {
    var us = cross[ck];
    var offs = Array.from(new Set(us.map(function (u) { return u.officer_id; })));
    if (offs.length > 1) warnings.push({ type: 'CROSS_OFFICER', unit_id: us.map(function (u) { return u.unit_id; }).join(','),
      officer_id: offs.join(','), date: us[0].delivered_date, area_id: us[0].area_id, place_key: us[0].place_key,
      count: us.reduce(function (s, u) { return s + u.notice_count; }, 0),
      text: 'วันเดียวกัน พื้นที่เดียวกัน แยกผู้ส่ง ' + offs.length + ' คน (ข้อ 7) — แจ้งงานหมายตรวจ ไม่ตัดยอด' });
  });
  return { byNotice: byNotice, units: units, warnings: warnings };
}

/** อัตราหมายฟรีของพื้นที่: อำเภอที่มีอัตราในบัญชีท้ายระเบียบ (RATE_BUDGET) ใช้อัตรานั้น · อำเภออื่นใช้อัตราตำบล */
function budgetRateOf_(areaId, opt) {
  if (!areaId) return 0;
  var am = String(areaId).slice(0, 4);
  var b = (opt.budgetRate || {})[am];
  var r = b ? Number(b) : (Number((opt.areaRate || {})[areaId]) || 0);
  var mx = Number(opt.freeMax) || 0;                              // หมายฟรีไม่เกินอัตราสูงสุด (FREE_MAX_RATE)
  return mx > 0 && r > mx ? mx : r;
}

/* ---------- ส่วน GAS ---------- */
/** 0.7.13 ตัวเลือกอัตราหมายฟรีจากชีต (ชุดเดียวกับ calcRunCore_) */
function freeRateOpt_() {
  const areaRate = {}; readTable_('RATE_AREAS').rows.forEach(function (a) { areaRate[a.area_id] = Number(a.rate) || 0; });
  const budgetRate = {}; readTable_('RATE_BUDGET').rows.forEach(function (b) { if (b.amphoe_code) budgetRate[String(b.amphoe_code)] = Number(b.rate) || 0; });
  const fm = readTable_('CALC_RULES').rows.filter(function (r) { return r.rule_code === 'FREE_MAX_RATE'; })[0];
  return { areaRate: areaRate, budgetRate: budgetRate, freeMax: Number((fm || {}).mode) || 0 };
}
function unitLocked_(u) {
  return !!(u.payout_round_id || u.claim_ref || String(u.locked).toUpperCase() === 'TRUE' ||
            (u.status && u.status !== 'NOT_CLAIMED'));
}

/** คำนวณทั้งระบบและบันทึก (ใช้ทั้งปุ่ม "คำนวณใหม่" และหลังนำเข้า) — ผู้เรียกต้องถือล็อกเอง */
function calcRunCore_(byUser) {
  const t0 = Date.now();
  const nt = readTable_('NOTICES');
  const areaRate = {}; readTable_('RATE_AREAS').rows.forEach(function (a) { areaRate[a.area_id] = Number(a.rate) || 0; });
  const budgetRate = {}; readTable_('RATE_BUDGET').rows.forEach(function (b) { if (b.amphoe_code) budgetRate[String(b.amphoe_code)] = Number(b.rate) || 0; });
  const rulesT = readTable_('CALC_RULES').rows;
  const rule = rulesT.filter(function (r) { return r.rule_code === 'FREE_MULTI_CASE_SAME_MOO'; })[0];
  const urbanRule = rulesT.filter(function (r) { return r.rule_code === 'FREE_URBAN_GROUP'; })[0];
  const ut = readTable_('BUDGET_UNITS');
  const locked = {}, keep = [];
  const inRound = roundLinks_(readTable_('PAYOUT_ROUNDS').rows, readTable_('PAYOUT_ITEMS').rows);   // 0.7.10 ประวัติรอบยืนยัน
  ut.rows.forEach(function (u) {
    const uids = String(u.notice_uids || '').split(',').filter(String);
    if (unitLocked_(u) || uids.some(function (x) { return inRound[x]; })) { locked[u.unit_id] = { notice_uids: uids }; keep.push(u); }
  });
  const res = calcCompute_(nt.rows, { areaRate: areaRate, budgetRate: budgetRate, mode: rule ? rule.mode : 'HALF',
                                       locked: locked, inRound: inRound, fyStartMonth: cfgNum_('FY_START_MONTH', 10),
                                       startFy: cfg_('PROCESS_START_FY', ''),
                                       startDate: fyStartDate_(cfg_('PROCESS_START_FY', ''), cfgNum_('FY_START_MONTH', 10)),
                                       urbanGroup: (urbanRule && urbanRule.mode) || 'TAMBON',
                                       freeMax: Number((rulesT.filter(function (r) { return r.rule_code === 'FREE_MAX_RATE'; })[0] || {}).mode) || 0 });
  const ts = now_();

  // เขียนคอลัมน์ผลคำนวณของ NOTICES ทีเดียว (เร็วกว่าเขียนทีละแถว)
  const cols = ['calc_amount', 'calc_rule', 'calc_note', 'budget_unit_id', 'claim_piece'];
  const head = nt.head;
  let changed = 0;
  cols.forEach(function (c) {
    const j = head.indexOf(c);
    if (j < 0) throw appErr_('NOT_INSTALLED', 'ชีต NOTICES ยังไม่มีคอลัมน์ ' + c + ' — รัน setupSystem อีกครั้ง');
    if (!nt.rows.length) return;
    const vals = nt.rows.map(function (r) {
      const x = res.byNotice[String(r.notice_uid)];
      const v = x ? String(x[c] === undefined || x[c] === null ? '' : x[c]) : String(r[c] || '');
      if (x && v !== String(r[c] || '')) changed++;
      return [cellPut_(v)];
    });
    nt.sh.getRange(2, j + 1, vals.length, 1).setNumberFormat('@').setValues(vals);
  });

  // หน่วยเบิก: เก็บหน่วยที่ล็อก + เขียนหน่วยที่คำนวณใหม่ทั้งหมด
  const old = {}; ut.rows.forEach(function (u) { old[u.unit_id] = u; });
  const fresh = res.units.map(function (u) {
    const o = old[u.unit_id] || {};
    return Object.assign({}, u, { status: 'NOT_CLAIMED', payout_round_id: '', claim_ref: '', locked: false,
      rule_version: rule ? (rule.mode + '@' + (rule.effective_from || '')) : 'HALF', computed_at: ts,
      created_at: o.created_at || ts });
  });
  const all = keep.concat(fresh);
  const sh = ut.sh, uh = headOf_('BUDGET_UNITS', sh);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, uh.length).clearContent();
  if (all.length) sh.getRange(2, 1, all.length, uh.length).setNumberFormat('@')
    .setValues(all.map(function (o) { return toRow_('BUDGET_UNITS', o); }));

  const sum = { notices: nt.rows.length, units: fresh.length, locked_units: keep.length, warnings: res.warnings.length,
                changed_cells: changed, ms: Date.now() - t0 };
  setCfg_('CALC_LAST_RUN', ts);
  setCfg_('CALC_WARNINGS_JSON', JSON.stringify(res.warnings).slice(0, 45000));
  audit_(byUser || 'SYSTEM', 'CALC', '', sum);
  return sum;
}

function setCfg_(key, value) {
  const t = readTable_('CONFIG');
  const r = t.rows.filter(function (x) { return x.key === key; })[0];
  if (r) { r.value = value; updateRow_('CONFIG', r._r, r); }
  else appendRows_('CONFIG', [{ key: key, value: value, description: 'ระบบบันทึกเอง' }]);
  CFG_CACHE_ = null;
}

/** ปุ่ม "คำนวณใหม่" */
function apiCalcRun_(ctx) {
  const lock = writeLock_();
  try { lock.waitLock(30000); } catch (e) { throw appErr_('BUSY', 'มีผู้อื่นกำลังนำเข้าหรือคำนวณ กรุณาลองใหม่อีกครั้ง'); }
  try { return calcRunCore_(ctx.user.code); } finally { lock.releaseLock(); }
}

/* ---------- ตรวจยืนยัน: ยอดเงินไม่ตรงอัตราตำบล · วันที่จ่ายไม่แน่ชัด (ไฟล์ 50 คร่อมวันเริ่มปีงบ) ---------- */
/**
 * หมายมีเงินที่ราคาไม่เท่าอัตราตำบล (ตั้งแต่ 0.5.1): คิดเงินตามอัตราตำบลอัตโนมัติ ไม่ต้องยืนยัน
 *  UP   ▲ ราคาไฟล์เกินอัตรา — ส่วนเกินไม่นำมาคิด/แบ่ง แสดงข้อความไว้
 *  DOWN ▼ ราคาไฟล์ต่ำกว่าอัตรา — ปรับขึ้นเป็นอัตราตำบล แสดงอักษรสีแดง
 * ราคาตามไฟล์ (amount_src) และประวัติการยืนยันเดิม (amount_ok_*) เก็บไว้ตามเดิม
 */
function amountAdj_(r) {
  if (!r || r.pay_type !== 'PAID' || String(r.flags || '').indexOf(FLAG_PRICE_NE_RATE) < 0) return null;
  var src = Number(String(r.amount_src).replace(/,/g, '')), rate = Number(String(r.rate_ref).replace(/,/g, ''));
  if (String(r.amount_src) === '' || !isFinite(src) || !(rate > 0) || src === rate) return null;
  return { src: src, rate: rate, diff: Math.round(Math.abs(src - rate) * 100) / 100, dir: src > rate ? 'UP' : 'DOWN' };
}
function adjNote_(a) {
  var f = function (x) { return Number(x).toLocaleString('en-US', { maximumFractionDigits: 2 }); };
  return a.dir === 'UP'
    ? '▲ ราคาไฟล์ ' + f(a.src) + ' เกินอัตราตำบล ' + f(a.rate) + ' อยู่ ' + f(a.diff) + ' บาท — คิดตามอัตราตำบล (ส่วนเกินไม่นำมาคิด)'
    : '▼ ราคาไฟล์ ' + f(a.src) + ' ต่ำกว่าอัตราตำบล ' + f(a.rate) + ' อยู่ ' + f(a.diff) + ' บาท — คิดตามอัตราตำบล';
}
/** เดิม: ยอดไม่ตรงอัตราที่ยังไม่ยืนยัน (สีแดง กันเข้ารอบเบิก) — ตั้งแต่ 0.5.1 คิดตามอัตราตำบลอัตโนมัติ จึงไม่มีรายการค้างยืนยัน */
function amountRed_(r) { return false; }
function amountOkInfo_(r) {
  if (String(r.flags).indexOf(FLAG_PRICE_NE_RATE) < 0 || !r.amount_ok_value) return null;
  return { value: String(r.amount_ok_value), by: String(r.amount_ok_by || ''), at: String(r.amount_ok_at || ''),
           current: String(r.amount_ok_value) === String(r.amount_src || '') };
}

/** รายการที่ต้องตรวจยืนยัน (ผู้ส่งหมายเห็นเฉพาะของตนเอง) */
function apiNoticeChecks_(ctx, d) {
  const fy = str_(d.fy, 4) || currentFy_();
  const scope = scopeOfficer_(ctx.user);
  const name = {}; officersAll_().forEach(function (o) { name[o.officer_id] = o.name; });
  const amount = [], date = [];
  readTable_('NOTICES').rows.forEach(function (r) {
    if (scope && r.officer_id !== scope) return;
    const base = { notice_uid: r.notice_uid, case_no: r.case_no, case_ref: r.case_ref, kind: r.notice_kind, pay_type: r.pay_type,
      officer: name[r.officer_id] || r.officer_raw, recipient: r.recipient,
      place: [r.house_no, r.moo ? 'ม.' + r.moo : '', r.tambon ? 'ต.' + r.tambon : '', r.amphoe ? 'อ.' + r.amphoe : ''].filter(String).join(' ') };
    if (String(r.fy) === fy && String(r.flags).indexOf(FLAG_PRICE_NE_RATE) >= 0)
      amount.push(Object.assign({ amount: r.amount_src, rate: r.rate_ref, calc_amount: r.calc_amount, adj: amountAdj_(r), red: false, ok: amountOkInfo_(r) }, base));
    if (String(r.flags).indexOf(FLAG_DATE_UNSURE) >= 0 && !r.issued_date)
      date.push(Object.assign({ amount: r.amount_src, date_ok: String(r.date_ok || ''), date_ok_by: String(r.date_ok_by || ''),
        date_ok_at: String(r.date_ok_at || ''), delivered_date: String(r.delivered_date || '') }, base));
  });
  amount.sort(function (a, b) { return String((a.adj || {}).dir || '').localeCompare(String((b.adj || {}).dir || '')); });   // ▼ ต่ำกว่าอัตราขึ้นก่อน
  date.sort(function (a, b) { return (a.date_ok ? 1 : 0) - (b.date_ok ? 1 : 0); });
  return { fy: fy, amount: amount, date: date,
           can_amount: false, can_date: hasRole_(ctx.user, ['NOTICE', 'FINANCE', 'ADMIN']),
           can_undo: hasRole_(ctx.user, ['ADMIN']) };
}

function lockedEdit_(ctx, fn) {
  const lock = writeLock_();
  try { lock.waitLock(30000); } catch (e) { throw appErr_('BUSY', 'มีผู้อื่นกำลังนำเข้าหรือคำนวณ กรุณาลองใหม่อีกครั้ง'); }
  try { return fn(); } finally { lock.releaseLock(); }
}
function uidsOf_(d) {
  const a = Array.isArray(d.notice_uids) ? d.notice_uids.map(String).filter(String) : [];
  if (!a.length) throw appErr_('BAD_REQUEST', 'ไม่ได้เลือกหมาย');
  if (a.length > 2000) throw appErr_('BAD_REQUEST', 'เลือกได้ครั้งละไม่เกิน 2,000 ฉบับ');
  return a;
}

/** ยืนยัน "ยอดเงินตรงระบบแล้ว" — คงสัญลักษณ์ "เคยยอดไม่ตรง" ไว้ · undo (ผู้ดูแลระบบ) ต้องระบุเหตุผล */
function apiNoticeConfirmAmount_(ctx, d) {
  const uids = uidsOf_(d), undo = !!d.undo;
  if (undo && !hasRole_(ctx.user, ['ADMIN'])) throw appErr_('FORBIDDEN', 'ยกเลิกการยืนยันได้เฉพาะผู้ดูแลระบบ');
  const reason = str_(d.reason, 300);
  if (undo && !reason) throw appErr_('BAD_REQUEST', 'กรุณาระบุเหตุผลที่ยกเลิก');
  return lockedEdit_(ctx, function () {
    const want = {}; uids.forEach(function (u) { want[u] = true; });
    const ts = now_(), who = ctx.user.code + ' ' + (ctx.user.name || '');
    let n = 0;
    readTable_('NOTICES').rows.forEach(function (r) {
      if (!want[r.notice_uid] || String(r.flags).indexOf(FLAG_PRICE_NE_RATE) < 0) return;
      if (undo) { if (!r.amount_ok_value) return; r.amount_ok_value = ''; r.amount_ok_by = ''; r.amount_ok_at = ''; }
      else { if (!amountRed_(r)) return; r.amount_ok_value = String(r.amount_src); r.amount_ok_by = who.trim(); r.amount_ok_at = ts; }
      r.updated_at = ts; updateRow_('NOTICES', r._r, r); n++;
    });
    audit_(ctx.user.code, undo ? 'AMOUNT_OK_UNDO' : 'AMOUNT_OK', uids.slice(0, 50).join(','), { n: n, reason: reason });
    return { updated: n };
  });
}

/** ยืนยันวันที่จ่ายของหมายจากไฟล์ 50 ที่คร่อมวันเริ่มปีงบ: BEFORE = จ่ายเดือน ก.ย. (ไม่นับ) · AFTER = จ่ายตั้งแต่วันเริ่ม · CLEAR = ล้าง (ผู้ดูแลระบบ) */
function apiNoticeConfirmDate_(ctx, d) {
  const uids = uidsOf_(d), v = String(d.value || '').toUpperCase();
  if (['BEFORE', 'AFTER', 'CLEAR'].indexOf(v) < 0) throw appErr_('BAD_REQUEST', 'ค่าไม่ถูกต้อง');
  if (v === 'CLEAR' && !hasRole_(ctx.user, ['ADMIN'])) throw appErr_('FORBIDDEN', 'ล้างการยืนยันได้เฉพาะผู้ดูแลระบบ');
  return lockedEdit_(ctx, function () {
    const want = {}; uids.forEach(function (u) { want[u] = true; });
    const ts = now_(), who = (ctx.user.code + ' ' + (ctx.user.name || '')).trim();
    let n = 0;
    readTable_('NOTICES').rows.forEach(function (r) {
      if (!want[r.notice_uid] || String(r.flags).indexOf(FLAG_DATE_UNSURE) < 0 || r.issued_date) return;
      if (r.locked === true || String(r.locked).toUpperCase() === 'TRUE' || r.payout_round_id) return;   // เข้ารอบแล้ว ไม่แก้
      if (v === 'CLEAR') { r.date_ok = ''; r.date_ok_by = ''; r.date_ok_at = ''; }
      else { r.date_ok = v; r.date_ok_by = who; r.date_ok_at = ts; }
      r.updated_at = ts; updateRow_('NOTICES', r._r, r); n++;
    });
    audit_(ctx.user.code, 'DATE_OK_' + v, uids.slice(0, 50).join(','), { n: n });
    const calc = n ? calcRunCore_(ctx.user.code) : null;
    return { updated: n, calc: calc };
  });
}

/** สรุปยอดรายผู้ส่ง (ผู้ส่งหมายเห็นเฉพาะของตนเอง) */
function apiCalcSummary_(ctx, d) {
  const fy = str_(d.fy, 4) || currentFy_();
  const scope = scopeOfficer_(ctx.user);
  const offs = officersAll_();
  const per = {};
  offs.forEach(function (o) {
    if (scope && o.officer_id !== scope) return;
    per[o.officer_id] = { officer_id: o.officer_id, name: o.name, full_name: o.full_name, color: o.color,
      paid_n: 0, paid_amount: 0, paid_wait: 0, free_n: 0, free_units: 0, free_amount: 0, free_wait: 0, review: 0, red: 0, date_wait: 0, adj_up: 0, adj_up_baht: 0, adj_dn: 0, adj_dn_baht: 0 };
  });
  const tot = { paid_n: 0, paid_amount: 0, paid_wait: 0, free_n: 0, free_units: 0, free_amount: 0, free_wait: 0, review: 0, red: 0, date_wait: 0, adj_up: 0, adj_up_baht: 0, adj_dn: 0, adj_dn_baht: 0 };
  const add = function (p, k, v) { p[k] += v; tot[k] += v; };
  readTable_('NOTICES').rows.forEach(function (r) {
    if (String(r.fy) !== fy || r.calc_rule === 'PRE_START') return;
    const p = per[r.officer_id]; if (!p) return;
    const amt = Number(r.calc_amount) || 0;
    if (r.calc_rule === 'WAIT_ISSUE_DATE') { add(p, 'date_wait', 1); return; }   // ยังไม่รู้ว่านับหรือไม่ — แยกไว้ ไม่รวมยอด
    if (r.pay_type === 'PAID') {
      add(p, 'paid_n', 1); add(p, 'paid_amount', amt);
      if (!r.delivered_date) add(p, 'paid_wait', 1);
      const aj = amountAdj_(r);
      if (aj && aj.dir === 'UP') { add(p, 'adj_up', 1); add(p, 'adj_up_baht', aj.diff); }
      if (aj && aj.dir === 'DOWN') { add(p, 'adj_dn', 1); add(p, 'adj_dn_baht', aj.diff); }
    } else if (r.pay_type === 'BUDGET') {
      add(p, 'free_n', 1);
      if (r.calc_rule === 'WAIT_DELIVERY') add(p, 'free_wait', 1);
      else if (/^REVIEW/.test(String(r.calc_rule))) add(p, 'review', 1);
      else add(p, 'free_amount', amt);
    }
  });
  readTable_('BUDGET_UNITS').rows.forEach(function (u) {
    if (String(u.fy) !== fy) return;
    const p = per[u.officer_id]; if (p) add(p, 'free_units', 1);
  });
  // Summary only: all unclaimed free notices, including waiting/review/no-claim.
  // Reuse closeout eligibility and confirmed-round history without exposing notice rows.
  const pendingKeys = ['pending_free_n','pending_ready_n','pending_ready_units','pending_ready_amount','pending_wait_n','pending_review_n','pending_noclaim_n'];
  pendingKeys.forEach(function(k) { tot[k]=0;Object.keys(per).forEach(function(id){per[id][k]=0;}); });
  const today=Utilities.formatDate(new Date(),'Asia/Bangkok','yyyy-MM-dd');
  if (fyStartDate_(fy,10)<=today) {
    const pending=closeoutData_(readTable_('NOTICES').rows,readTable_('PAYOUT_ROUNDS').rows,readTable_('PAYOUT_ITEMS').rows,officerNames_(),fy,today,readTable_('BUDGET_UNITS').rows);
    const mapping={pending_free_n:'count',pending_ready_n:'ready_n',pending_ready_units:'ready_units',pending_ready_amount:'ready_amount',pending_wait_n:'wait_n',pending_review_n:'review_n',pending_noclaim_n:'noclaim_n'};
    pending.per_officer.forEach(function(o){const p=per[o.officer_id];if(!p)return;Object.keys(mapping).forEach(function(k){add(p,k,Number(o[mapping[k]])||0);});});
    tot.pending_ready_amount=Math.round(tot.pending_ready_amount*100)/100;
  }
  let warnings = [];
  try { warnings = JSON.parse(cfg_('CALC_WARNINGS_JSON', '[]')) || []; } catch (e) { warnings = []; }
  if (scope) warnings = warnings.filter(function (w) { return String(w.officer_id).split(',').indexOf(scope) >= 0; });
  const name = {}; offs.forEach(function (o) { name[o.officer_id] = o.name; });
  warnings = warnings.slice(0, 200).map(function (w) {
    return Object.assign({}, w, { officer: String(w.officer_id).split(',').map(function (x) { return name[x] || x; }).join(' / ') });
  });
  const round2 = function (o) { ['paid_amount', 'free_amount', 'adj_up_baht', 'adj_dn_baht'].forEach(function (k) { o[k] = Math.round(o[k] * 100) / 100; }); return o; };
  return { fy: fy, last_run: cfg_('CALC_LAST_RUN', ''), mode: (readTable_('CALC_RULES').rows.filter(function (r) { return r.rule_code === 'FREE_MULTI_CASE_SAME_MOO'; })[0] || {}).mode || 'HALF',
           officers: Object.keys(per).map(function (k) { return round2(per[k]); }), totals: round2(tot), warnings: warnings,
           can_run: hasRole_(ctx.user, ['NOTICE', 'FINANCE', 'ADMIN']), scope_officer: scope };
}

/** Owner check, read only. Never import/recalculate or publish live results. */
function verify076ReadOnly() {
  const tables=['NOTICES','BUDGET_UNITS','LEDGER','PAYOUT_ROUNDS','PAYOUT_ITEMS','RATE_AREAS','RATE_BUDGET','CALC_RULES','CONFIG'];
  const hash=()=>digestJson_(tables.map(k=>readTable_(k).rows)),before=hash(),fy=currentFy_();
  const summary=apiCalcSummary_({user:{roles:['ADMIN']}},{fy:fy}),closeout=apiCloseout_({user:{roles:['ADMIN']}},{fy:fy});
  const t=summary.totals,c=closeout.totals;
  if(t.pending_free_n!==c.count||t.pending_ready_n!==c.ready_n||Math.round(t.pending_ready_amount*100)!==Math.round(c.ready_amount*100)||t.pending_ready_units!==c.ready_units)throw new Error('Pending summary does not match closeout');
  if(t.pending_free_n!==t.pending_ready_n+t.pending_wait_n+t.pending_review_n+t.pending_noclaim_n)throw new Error('Pending status count mismatch');
  const first=summary.officers[0];
  if(first){const own=apiCalcSummary_({user:{roles:['COURIER'],officer_id:first.officer_id}},{fy:fy});if(own.officers.length!==1||own.totals.pending_free_n!==first.pending_free_n)throw new Error('Officer scope mismatch');}
  if(hash()!==before)throw new Error('Read-only check changed financial data');
  console.log(JSON.stringify({verification:'0.7.6',unchanged:true,officers:summary.officers.length,pending_counts_match:true,pending_amount_match:true,scope_correct:true,pending_free_n:t.pending_free_n,pending_ready_n:t.pending_ready_n,pending_wait_n:t.pending_wait_n,pending_review_n:t.pending_review_n,pending_noclaim_n:t.pending_noclaim_n}));
}

/** หน่วยเบิกหมายฟรีของผู้ส่ง 1 คน พร้อมหมายทุกฉบับที่รวม */
function apiCalcUnits_(ctx, d) {
  const fy = str_(d.fy, 4) || currentFy_();
  const scope = scopeOfficer_(ctx.user);
  const oid = scope || str_(d.officer_id, 10);
  const nmap = {};
  readTable_('NOTICES').rows.forEach(function (r) { if (r.budget_unit_id) (nmap[r.budget_unit_id] = nmap[r.budget_unit_id] || []).push(r); });
  const area = {}; readTable_('RATE_AREAS').rows.forEach(function (a) { area[a.area_id] = a; });
  const units = readTable_('BUDGET_UNITS').rows.filter(function (u) { return String(u.fy) === fy && u.officer_id === oid; })
    .sort(function (a, b) { return String(b.delivered_date).localeCompare(String(a.delivered_date)) || String(a.unit_id).localeCompare(String(b.unit_id)); })
    .slice(0, 500)
    .map(function (u) {
      const a = area[u.area_id] || {};
      return { unit_id: u.unit_id, delivered_date: String(u.delivered_date), place: [a.tambon_name ? 'ต.' + a.tambon_name : '', a.amphoe_name ? 'อ.' + a.amphoe_name : ''].filter(String).join(' '),
               place_key: /^X:/.test(u.place_key) ? 'ไม่มีที่อยู่' : String(u.place_key).replace(/^GOV:/, 'หน่วยงาน '), addr_type: ADDR_TYPE_TH[u.addr_type] || '', rule: CALC_RULE_TH[u.rule_code] || u.rule_code,
               notice_count: Number(u.notice_count), sub_units: Number(u.sub_units), rate_base: Number(u.rate_base), amount: Number(u.amount),
               status: u.status, locked: unitLocked_(u),
               notices: (nmap[u.unit_id] || []).map(function (r) { return { case_no: r.case_no, kind: r.notice_kind, house_no: r.house_no, moo: r.moo, amount: r.calc_amount, note: r.calc_note }; }) };
    });
  const pending = readTable_('NOTICES').rows.filter(function (r) {
    return String(r.fy) === fy && r.officer_id === oid && r.pay_type === 'BUDGET' && (r.calc_rule === 'WAIT_DELIVERY' || /^REVIEW/.test(String(r.calc_rule)));
  }).slice(0, 300).map(function (r) { return { case_no: r.case_no, kind: r.notice_kind, rule: CALC_RULE_TH[r.calc_rule] || r.calc_rule, note: r.calc_note, issued_date: String(r.issued_date) }; });
  return { fy: fy, officer_id: oid, units: units, pending: pending };
}

if (typeof module !== 'undefined') {
  module.exports = { calcCompute_: calcCompute_, budgetRateOf_: budgetRateOf_, CALC_RULE_TH: CALC_RULE_TH };
}
