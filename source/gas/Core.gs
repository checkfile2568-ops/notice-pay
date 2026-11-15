/**
 * ============================================================================
 *  ระบบค่าหมาย · ไฟล์ Core.gs
 *  หน้าที่ : ตรรกะล้วน (ไม่เรียก Google API) — จัดรูปข้อมูล · คีย์ไม่ซ้ำ · จัดกลุ่มผลนำเข้า
 * ----------------------------------------------------------------------------
 *  ยึดกฎการนำเข้า 7 ข้อ ของ "ข้อกำหนดและ Workflow ระบบค่าหมาย ฉบับ 4.0" ข้อ 3
 *   1 นำเข้าไฟล์เดิมซ้ำ ยอดไม่เพิ่ม           → SAME
 *   2 ไม่ใช้เลขคดีอย่างเดียวเป็นเอกลักษณ์     → validateKeyFields_
 *   3 แยก ใหม่/เดิม/เปลี่ยน/กำกวม/ผิดพลาด   → classifyIssue_ / classifyResult_
 *   4 ไม่เขียนทับรายการที่ล็อก (ปิดรอบ/เบิก) → HELD (ส่งเข้ารายการปรับปรุง)
 *   5 ไม่ลบข้อมูลที่ไม่อยู่ในไฟล์ล่าสุด         → ไม่มีคำสั่งลบในระบบนำเข้า
 *  ไฟล์นี้ทดสอบด้วย node ได้ (test/core.test.js)
 * ============================================================================
 */

/* ---------- ช่องข้อมูลมาตรฐาน + ชื่อหัวคอลัมน์ที่เดาให้อัตโนมัติ ----------
 *  รองรับไฟล์จากระบบงานหมายของศาล (ตรวจกับไฟล์จริง 1–12 พ.ย. 2569):
 *   · บัญชีจ่ายหมาย พนักงานศาลนี้ส่ง : เลขดำที่ · เลขแดงที่ · หมายอะไร · หมายถึงใคร · ที่อยู่ · ตำบล · อำเภอ · ราคา · ผู้ส่งหมาย · ผู้วางเงิน
 *   · รายงานผลการส่งหมาย          : เลขดำที่ · ส่งหมายให้ใคร · วันที่จ่ายหมาย · วันที่ส่งหมาย · วันที่รายงาน · ผลการส่งหมาย · ผู้ปฏิบัติ
 *  ไม่อ่านคอลัมน์โจทก์/จำเลย (ไม่ใช้คำนวณ · ลดการเก็บข้อมูลส่วนบุคคล)
 */
var IMPORT_FIELDS = [
  { f: 'case_no',        th: 'เลขคดี (เลขดำที่)',   syn: ['เลขดำที่', 'เลขดำ', 'เลขคดี', 'หมายเลขคดี', 'คดีหมายเลข', 'เลขที่คดี', 'คดีเลขที่', 'คดีดำ', 'หมายเลขคดีดำ'] },
  { f: 'red_no',         th: 'เลขแดงที่',           syn: ['เลขแดงที่', 'เลขแดง', 'คดีแดง', 'หมายเลขคดีแดง'] },
  { f: 'notice_no',      th: 'เลขหมาย',           syn: ['เลขหมาย', 'เลขที่หมาย', 'หมายเลขหมาย', 'ลำดับหมาย', 'รหัสหมาย'] },
  { f: 'notice_kind',    th: 'ชนิดหมาย',          syn: ['หมายอะไร', 'ชนิดหมาย', 'ชื่อหมาย', 'ประเภทเอกสาร', 'เอกสาร'] },
  { f: 'pay_type',       th: 'ประเภท (มีเงิน/ฟรี)', syn: ['ประเภทหมาย', 'มีเงิน/ฟรี', 'ประเภทค่าหมาย', 'ค่าธรรมเนียม', 'ฟรี', 'ประเภท'] },
  { f: 'recipient',      th: 'ผู้รับหมาย',         syn: ['หมายถึงใคร', 'ส่งหมายให้ใคร', 'ผู้รับหมาย', 'ชื่อผู้รับ', 'ผู้รับ', 'ส่งถึง', 'ชื่อผู้รับหมาย'] },
  { f: 'house_no',       th: 'บ้านเลขที่',         syn: ['บ้านเลขที่', 'เลขที่บ้าน', 'เลขที่'] },
  { f: 'moo',            th: 'หมู่ที่',            syn: ['หมู่ที่', 'หมู่', 'ม.'] },
  { f: 'tambon',         th: 'ตำบล',              syn: ['ตำบล', 'แขวง', 'ต.'] },
  { f: 'amphoe',         th: 'อำเภอ',             syn: ['อำเภอ', 'เขต', 'อ.'] },
  { f: 'address_text',   th: 'ที่อยู่ (ทั้งบรรทัด)', syn: ['ที่อยู่', 'ที่อยู่ผู้รับ', 'ภูมิลำเนา'] },
  { f: 'officer',        th: 'ผู้ส่งหมาย',         syn: ['ผู้ส่งหมาย', 'ผู้ปฏิบัติ', 'เจ้าหน้าที่ส่งหมาย', 'ชื่อผู้ส่ง', 'ผู้ส่ง', 'เจ้าพนักงาน', 'เจ้าหน้าที่'] },
  { f: 'issued_date',    th: 'วันที่จ่ายหมาย',     syn: ['วันที่จ่ายหมาย', 'วันจ่ายหมาย', 'วันที่จ่าย', 'วันจ่าย', 'วันที่รับหมาย', 'วันที่ออกหมาย'] },
  { f: 'delivered_date', th: 'วันที่ส่ง',          syn: ['วันที่ส่งหมาย', 'วันที่ส่ง', 'วันส่ง', 'ส่งวันที่'] },
  { f: 'reported_date',  th: 'วันที่รายงานผล',     syn: ['วันที่รายงาน', 'วันรายงาน', 'วันที่รายงานผล'] },
  { f: 'result',         th: 'ผลการส่ง',           syn: ['ผลการส่งหมาย', 'ผลการส่ง', 'ผลหมาย', 'ผล', 'สถานะ'] },
  { f: 'amount',         th: 'ราคา / จำนวนเงิน',    syn: ['ราคา', 'จำนวนเงิน', 'ค่าหมาย', 'ค่าส่ง', 'ค่าส่งหมาย', 'บาท'] },
  { f: 'payer',          th: 'ผู้วางเงิน',          syn: ['ผู้วางเงิน', 'ผู้ชำระเงิน', 'ผู้ชำระ'] }
];
var ISSUE_HASH_FIELDS = ['pay_type', 'case_no', 'case_ref', 'red_no', 'notice_no', 'notice_kind', 'recipient', 'house_no', 'moo',
                         'tambon', 'amphoe', 'address_text', 'officer_id', 'issued_date', 'amount_src', 'payer'];
var RESULT_HASH_FIELDS = ['delivered_date', 'result'];
/** คีย์หมาย 1 ฉบับ = เลขคดี + ผู้รับ + ผู้ส่ง + ชนิดหมาย + บ้านเลขที่ + หมู่ (ไฟล์ของศาลไม่มีเลขหมาย) */
var DEFAULT_KEY_FIELDS = ['case_no', 'recipient', 'officer', 'notice_kind', 'house_no', 'moo'];
/** ช่องคีย์ที่ว่างได้ (ใช้ "-") — ช่องอื่นต้องมีค่า */
var OPTIONAL_KEY_FIELDS = ['notice_kind', 'house_no', 'moo'];
/** ไฟล์ผลหมายไม่มีที่อยู่ และชื่อหมายเขียนสั้นกว่า → จับคู่ด้วยคีย์ที่ตัดช่องเหล่านี้ออก */
var RESULT_DROP_KEYS = ['notice_kind', 'house_no', 'moo', 'address_text', 'tambon', 'amphoe'];
/** หมายเหตุที่ต้องแสดงอักษรสีแดง (นำเข้าได้ ไม่หยุดรอตรวจ) */
var FLAG_PRICE_NE_RATE = 'เงินไม่เท่ากับอัตราของตำบล';
var FLAGS_RED = [FLAG_PRICE_NE_RATE];
/** ไฟล์ 50 ช่วงวันที่คร่อมวันเริ่มปีงบ: ยังไม่รู้ว่าจ่ายก่อน/หลังวันเริ่ม → ยังไม่คิดเงิน รอวันที่จ่ายจากไฟล์ 42 */
var FLAG_DATE_UNSURE = 'รอยืนยันวันที่จ่าย (ไฟล์ 50 คร่อมวันเริ่มปีงบ)';
/** คำบอกว่าเป็นหน่วยงานราชการ (ใช้รวมหมายเท่านั้น — ไม่ใช้กำหนดอัตรา อัตราดูจากตำบล/อำเภอเสมอ) */
var GOV_RE = /สำนักงาน|เรือนจำ|ทัณฑสถาน|อาคาร|ศาลากลาง|กระทรวง|สถานีตำรวจ|สภ\.|ที่ว่าการ|เทศบาล|อบต|องค์การบริหาร|โรงพยาบาล|ศาล|ค่าย|กองบิน|กองพัน|มณฑลทหาร|โรงเรียน|มหาวิทยาลัย|วิทยาลัย|สหกรณ์|ธนาคาร|การไฟฟ้า|การประปา/;

/* ---------- จัดรูปข้อความ ---------- */
function thDigits_(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[๐-๙]/g, function (c) { return String(c.charCodeAt(0) - 0x0E50); });
}
function normText_(s) { return thDigits_(s).replace(/\s+/g, ' ').trim(); }
function normName_(s) {
  return normText_(s)
    .replace(/^(นางสาว|นาง|นาย|น\.ส\.|ด\.ช\.|ด\.ญ\.|เด็กชาย|เด็กหญิง|คุณ|ว่าที่\s*ร\.ต\.)\s*/, '')
    .replace(/\s+/g, '');
}
function normPlace_(s) {
  return normText_(s).replace(/^(อำเภอ|อ\.|ตำบล|ต\.|แขวง|เขต|กิ่งอำเภอ)\s*/, '').replace(/\s+/g, '');
}
function normMoo_(s) {
  var m = normText_(s).match(/(\d+)/);
  return m ? String(Number(m[1])) : '';
}
function normHouse_(s) { return normText_(s).replace(/^(บ้านเลขที่|เลขที่)\s*/, '').replace(/\s+/g, ''); }
function normCase_(s) { return normText_(s).replace(/\s+/g, '').toUpperCase(); }
/** ช่องเลขดำที่ของศาลมี 2 บรรทัด: บรรทัด 1 = เลขคดี/เลขทะเบียนหมายต่างศาล (ต…) · บรรทัด 2 = เลขคดีศาลต้นทาง */
function splitCase_(v) {
  var p = thDigits_(v).split(/\r?\n/).map(function (x) { return x.trim(); }).filter(String);
  return { no: normCase_(p[0] || ''), ref: normCase_(p.slice(1).join(' ')) };
}
/** "1,150.00" / 1150 / "1150 บาท" → "1150" · ว่าง → "" · อ่านไม่ได้ → null */
function normAmount_(v) {
  var s = thDigits_(v).replace(/[,\s]|บาท/g, '');
  if (s === '') return '';
  var n = Number(s);
  return isFinite(n) ? String(Math.round(n * 100) / 100) : null;
}
/**
 * แยกที่อยู่รูปแบบระบบศาล "233 ม. 8 ซ. - ถ. -" (เครื่องหมาย - = ว่าง)
 * คืน { house, moo, soi, road, org, type, place }
 *  type : MOO มีหมู่ · GOV หน่วยงานราชการ · URBAN เขตเมือง (ไม่มีหมู่) · NONE ไม่มีที่อยู่
 *  place: ตัวจัดกลุ่มแทนหมู่ (ใช้รวมหมายตามข้อ 7 ในระยะ 3) — ไม่ใช้กำหนดอัตรา
 */
function parseAddress_(text) {
  var t = normText_(text);
  var c = function (x) { x = String(x || '').trim(); return x === '-' ? '' : x; };
  var head = t, moo = '', soi = '', road = '';
  var m = t.match(/^(.*?)\s*ม\.\s*(\S*)\s*ซ\.\s*(.*?)\s*ถ\.\s*(.*)$/);
  if (m) { head = c(m[1]); moo = c(m[2]); soi = c(m[3]); road = c(m[4]); }
  else {
    var mm = t.match(/(?:หมู่ที่|หมู่|ม\.)\s*(\d+)/); if (mm) moo = mm[1];
    head = t.replace(/(?:หมู่ที่|หมู่|ม\.)\s*\d+.*$/, '').trim();
  }
  moo = normMoo_(moo);
  soi = soi.replace(/^ซ\.?\s*/, ''); road = road.replace(/^ถ\.?\s*/, '');
  var hm = head.match(/^(\d[\d\/\-]*)\s*(.*)$/);
  var house = hm ? hm[1] : '', org = hm ? hm[2].trim() : head;
  var type = GOV_RE.test(org) ? 'GOV' : (moo ? 'MOO' : (house || soi || road ? 'URBAN' : 'NONE'));
  var place = '';
  if (type === 'GOV') place = 'GOV:' + (house || org.split(' ')[0]);
  else if (type === 'MOO') place = 'ม.' + moo;
  else if (type === 'URBAN') place = road ? 'ถ.' + road.replace(/\s+/g, '') : (soi ? 'ซ.' + soi.replace(/\s+/g, '') : 'บ้าน:' + house);
  return { house: house, moo: moo, soi: soi, road: road, org: org, type: type, place: place };
}
var ADDR_TYPE_TH = { MOO: 'มีหมู่', GOV: 'หน่วยงานราชการ', URBAN: 'เขตเมือง (ไม่มีหมู่)', NONE: 'ไม่มีที่อยู่' };

/* ---------- วันที่ → YYYY-MM-DD (ค.ศ.) ---------- */
function parseDate_(v) { return NoticeImportFormat.date(v); }
function pad2_(n) { return (n < 10 ? '0' : '') + n; }
function thMonth_(s) {
  var t = String(s).replace(/\./g, '');
  var full = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  var abbr = ['มค','กพ','มีค','เมย','พค','มิย','กค','สค','กย','ตค','พย','ธค'];
  var i = full.indexOf(t); if (i >= 0) return i + 1;
  i = abbr.indexOf(t); return i >= 0 ? i + 1 : 0;
}

/** ปีงบประมาณ (พ.ศ.) ของวันที่ ISO: ต.ค.–ธ.ค. นับเป็นปีถัดไป */
function fiscalYear_(iso, startMonth) {
  if (!iso) return '';
  var y = +iso.slice(0, 4), mo = +iso.slice(5, 7);
  return String((mo >= (startMonth || 10) ? y + 1 : y) + 543);
}

/* ---------- ประเภทหมาย ---------- */
function normPayType_(v, dflt) {
  var s = normText_(v).replace(/\s+/g, '');
  if (!s) return dflt || '';
  if (/ฟรี|งบ|ยกเว้น|ไม่เสีย|budget|free/i.test(s)) return 'BUDGET';
  if (/มีเงิน|ชำระ|เสียค่า|วางเงิน|paid/i.test(s)) return 'PAID';
  if (s === 'BUDGET' || s === 'PAID') return s;
  return dflt || '';
}

/* ---------- แฮชสั้น (FNV-1a 32 บิต) ---------- */
function fnv_(s) {
  var h = 0x811c9dc5;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
  return ('0000000' + h.toString(16)).slice(-8);
}
function hashOf_(rec, fields) { return fnv_(fields.map(function (f) { return String(rec[f] === undefined ? '' : rec[f]); }).join('␟')); }

/* ---------- คีย์ไม่ซ้ำ ---------- */
function validateKeyFields_(keys) {
  keys = (keys || []).filter(Boolean);
  if (keys.length < 2) return 'คีย์ไม่ซ้ำต้องมีอย่างน้อย 2 ช่อง (ห้ามใช้เลขคดีอย่างเดียว)';
  var ok = IMPORT_FIELDS.map(function (x) { return x.f; });
  for (var i = 0; i < keys.length; i++) if (ok.indexOf(keys[i]) < 0) return 'ช่อง ' + keys[i] + ' ใช้เป็นคีย์ไม่ได้';
  if (keys.filter(function (k) { return OPTIONAL_KEY_FIELDS.indexOf(k) < 0; }).length < 2) return 'คีย์ต้องมีช่องที่ไม่ว่างอย่างน้อย 2 ช่อง';
  return '';
}
/** ค่าของช่องคีย์ในระเบียนมาตรฐาน ('officer' = รหัสผู้ส่งที่จับคู่แล้ว) */
function keyVal_(rec, k) { var v = rec[k === 'officer' ? 'officer_id' : k]; return v === undefined || v === null ? '' : String(v); }
function keyOf_(rec, keys) {
  var parts = [];
  for (var i = 0; i < keys.length; i++) {
    var v = keyVal_(rec, keys[i]);
    if (v === '') { if (OPTIONAL_KEY_FIELDS.indexOf(keys[i]) >= 0) v = '-'; else return ''; }
    parts.push(v);
  }
  return parts.join('|');
}
function resultKeys_(keys) { return keys.filter(function (k) { return RESULT_DROP_KEYS.indexOf(k) < 0; }); }
/** ระเบียนที่บันทึกในชีต NOTICES → ค่าที่ใช้จับคู่ (จัดรูปเหมือนตอนนำเข้า) */
function storedMatchRec_(o) {
  return { case_no: normCase_(o.case_no), recipient: normName_(o.recipient), officer_id: String(o.officer_id || ''),
           notice_no: normText_(o.notice_no).replace(/\s+/g, ''), notice_kind: normText_(o.notice_kind),
           house_no: String(o.house_no || ''), moo: String(o.moo || ''), red_no: normCase_(o.red_no) };
}

/* ---------- ดัชนีผู้ส่ง / พื้นที่ ---------- */
function buildOfficerIndex_(officers) {
  var full = {}, first = {}, alias = {};
  officers.forEach(function (o) {
    var fn = normName_(o.first_name), ln = normName_(o.last_name);
    if (fn && ln) full[fn + ln] = o.officer_id;
    if (fn) (first[fn] = first[fn] || []).push(o.officer_id);
    String(o.name_aliases || '').split(/[,;\n]/).forEach(function (a) { a = normName_(a); if (a) alias[a] = o.officer_id; });
  });
  return { full: full, first: first, alias: alias };
}
function resolveOfficer_(raw, idx) {
  var n = normName_(raw);
  if (!n) return '';
  if (idx.full[n]) return idx.full[n];
  if (idx.alias[n]) return idx.alias[n];
  var hits = [];
  Object.keys(idx.first).forEach(function (fn) { if (n === fn || n.indexOf(fn) === 0) hits = hits.concat(idx.first[fn]); });
  return hits.length === 1 ? hits[0] : '';
}
function buildAreaIndex_(areas) {
  var both = {}, tam = {}, rate = {};
  areas.forEach(function (a) {
    var am = normPlace_(a.amphoe_name), tb = normPlace_(a.tambon_name);
    both[am + '|' + tb] = a.area_id;
    (tam[tb] = tam[tb] || []).push(a.area_id);
    rate[a.area_id] = Number(a.rate) || 0;
  });
  return { both: both, tam: tam, rate: rate };
}
/**
 * หารหัสพื้นที่จากตำบล + อำเภอ
 *  · มีอำเภอ → ต้องตรงคู่ (ตำบลอยู่ในอำเภอนั้นจริง) ไม่ตรง = ''
 *  · ไม่มีอำเภอ → ใช้ได้เมื่อชื่อตำบลไม่ซ้ำกับอำเภออื่น
 */
function resolveArea_(amphoe, tambon, idx) {
  var am = normPlace_(amphoe), tb = normPlace_(tambon);
  if (!tb) return '';
  if (am) {
    if (idx.both[am + '|' + tb]) return idx.both[am + '|' + tb];
    // ชื่ออำเภอย่อ เช่น "เมือง" = "เมืองลพบุรี" (ต้องตรงตำบลและไม่ซ้ำ)
    var hit = Object.keys(idx.both).filter(function (k) { var p = k.split('|'); return p[1] === tb && p[0].indexOf(am) === 0; });
    return hit.length === 1 ? idx.both[hit[0]] : '';
  }
  var list = idx.tam[tb] || [];
  return list.length === 1 ? list[0] : '';
}

/* ---------- แปลงแถว Excel → ระเบียนมาตรฐาน ---------- */
/**
 * row     : object ของหัวคอลัมน์ → ค่า (ส่งจากหน้าเว็บ)
 * mapping : { case_no: 'ชื่อหัวคอลัมน์', ... }
 * opts    : { file_officer_id, default_pay_type, period_from, period_to }
 * rec.issues : ปัญหาที่ต้องส่งเข้า "รอตรวจ" (ไม่คิดเงิน) · rec.flags : หมายเหตุที่นำเข้าได้
 */
function toRecord_(row, mapping, opts, offIdx, areaIdx) {
  function g(f) { var c = mapping[f]; return c ? row[c] : ''; }
  var cs = splitCase_(g('case_no'));
  var addr = parseAddress_(g('address_text'));
  var amt = normAmount_(g('amount'));
  var rec = {
    case_no: cs.no, case_ref: cs.ref,
    red_no: normCase_(String(g('red_no')).split(/\r?\n/)[0]),
    notice_no: normText_(g('notice_no')).replace(/\s+/g, ''),
    notice_kind: normText_(g('notice_kind')),
    pay_type: normPayType_(g('pay_type'), opts.default_pay_type),
    recipient: normName_(g('recipient')),
    recipient_disp: normText_(g('recipient')),
    house_no: mapping.house_no ? normHouse_(g('house_no')) : addr.house,
    moo: mapping.moo ? normMoo_(g('moo')) : addr.moo,
    tambon: normPlace_(g('tambon')),
    amphoe: normPlace_(g('amphoe')),
    address_text: normText_(g('address_text')),
    addr_type: mapping.address_text ? addr.type : (mapping.moo && normMoo_(g('moo')) ? 'MOO' : ''),
    place_key: mapping.address_text ? addr.place : (mapping.moo && normMoo_(g('moo')) ? 'ม.' + normMoo_(g('moo')) : ''),
    officer_raw: normText_(g('officer')),
    issued_date: parseDate_(g('issued_date')),
    delivered_date: parseDate_(g('delivered_date')),
    reported_date: parseDate_(g('reported_date')),
    result: normText_(g('result')),
    amount_src: amt === null ? '' : amt,
    payer: normText_(g('payer')),
    rate_ref: ''
  };
  if (opts.privacy_mode) {
    rec.recipient = NoticeImportFormat.recipient(rec.case_no, g('recipient'));
    rec.recipient_disp = rec.recipient;
    rec.payer = rec.payer ? 'มีผู้วางเงิน' : '';
  }
  rec.officer_id = opts.file_officer_id || resolveOfficer_(rec.officer_raw, offIdx);
  rec.area_id = resolveArea_(rec.amphoe, rec.tambon, areaIdx);
  var issues = [], flags = [];
  if (amt === null) issues.push('ราคาอ่านไม่ได้: ' + normText_(g('amount')));
  // ประเภทหมาย: ไม่มีคอลัมน์ประเภท → ดูจากราคา (0.00 = หมายฟรี เงินงบประมาณ · มากกว่า 0 = หมายมีเงิน)
  if (!rec.pay_type && mapping.amount && amt !== null && amt !== '') rec.pay_type = Number(amt) > 0 ? 'PAID' : 'BUDGET';
  if (mapping.amount && amt !== null && amt !== '') {
    if (rec.pay_type === 'BUDGET' && Number(amt) > 0) issues.push('ระบุเป็นหมายฟรี แต่มีราคา ' + amt + ' บาท');
    if (rec.pay_type === 'PAID' && Number(amt) <= 0) issues.push('ระบุเป็นหมายมีเงิน แต่ราคา 0');
  }
  if (mapping.payer && rec.pay_type) {
    if (rec.pay_type === 'PAID' && !rec.payer) issues.push('หมายมีเงินแต่ไม่มีผู้วางเงิน');
    if (rec.pay_type === 'BUDGET' && rec.payer) issues.push('หมายฟรีแต่มีผู้วางเงิน');
  }
  if (mapping.tambon || mapping.amphoe) {
    if (!rec.area_id) {
      var tbHit = (areaIdx.tam[normPlace_(rec.tambon)] || []).length;
      issues.push(tbHit && rec.amphoe ? 'ตำบล' + rec.tambon + ' ไม่อยู่ในอำเภอ' + rec.amphoe : 'ไม่พบตำบล ' + (rec.tambon || '(ว่าง)') + ' ในตารางอัตรา');
    } else {
      rec.rate_ref = String(areaIdx.rate[rec.area_id] || '');
      if (rec.pay_type === 'PAID' && rec.amount_src !== '' && Number(rec.amount_src) !== Number(rec.rate_ref)) flags.push(FLAG_PRICE_NE_RATE);
    }
  }
  // หมายฟรีที่ไม่มีที่อยู่ รวมหมายตามข้อ 7 ไม่ได้ → แจ้งไว้ (หมายมีเงินใช้ราคาในไฟล์ ไม่ต้องแจ้ง)
  if (mapping.address_text && rec.addr_type === 'NONE' && rec.pay_type === 'BUDGET') flags.push('หมายฟรีไม่มีที่อยู่');
  if (opts.date_unsure && !rec.issued_date) flags.push(FLAG_DATE_UNSURE);
  rec.issues = issues;
  rec.flags = flags.join(';');
  return rec;
}

/* ---------- จัดกลุ่ม: ไฟล์จ่ายหมาย ---------- */
/**
 * existing : { [notice_uid]: { row_hash, result_hash, locked:bool, rec? } }
 * คืน: [{ i, cls, reason, uid, rec }]  cls ∈ NEW SAME CHANGED HELD AMBIGUOUS ERROR
 */
function classifyIssue_(rows, mapping, keys, opts, existing, offIdx, areaIdx) {
  var seen = {}, seenRow = {};
  var periodTo = parseDate_(opts.period_to || '');
  return rows.map(function (row, i) {
    var rec = toRecord_(row, mapping, opts, offIdx, areaIdx);
    if (rec.issued_date === null) return out_(i, 'ERROR', 'วันที่จ่ายหมายอ่านไม่ได้', '', rec);
    if (rec.delivered_date === null) return out_(i, 'ERROR', 'วันที่ส่งอ่านไม่ได้', '', rec);
    // หมายที่จ่ายก่อนวันเริ่มปีงบ: หมายฟรีไม่นับ · หมายมีเงินนับตามวันที่ส่ง (ส่งตั้งแต่วันเริ่ม → นับ)
    if (beforeStart_(rec.issued_date || (!rec.delivered_date ? periodTo : ''), opts)) {
      if (rec.pay_type === 'BUDGET') return out_(i, 'OUTSIDE', 'หมายฟรีจ่ายก่อนเริ่มปีงบ (' + opts.start_date + ') — ไม่นับในปีงบใหม่', '', rec);
      if (rec.pay_type !== 'PAID') return out_(i, 'OUTSIDE', 'จ่ายหมายก่อนเริ่มปีงบ (' + opts.start_date + ') และไม่ทราบประเภทหมาย', '', rec);
      if (rec.delivered_date && beforeStart_(rec.delivered_date, opts))
        return out_(i, 'OUTSIDE', 'หมายมีเงินส่งก่อนเริ่มปีงบ (' + opts.start_date + ')', '', rec);
      // หมายมีเงินยังไม่มีวันที่ส่ง → นำเข้าไว้ นับเมื่อไฟล์ผลหมายให้วันที่ส่งตั้งแต่วันเริ่ม
    }
    if (!rec.officer_id) return out_(i, 'AMBIGUOUS', 'จับคู่ผู้ส่งหมายไม่ได้: ' + (rec.officer_raw || '(ว่าง)'), '', rec);
    var uid = keyOf_(rec, keys);
    if (!uid) return out_(i, 'ERROR', 'ช่องคีย์ไม่ครบ (' + keys.join(', ') + ')', '', rec);
    if (existing[uid] && existing[uid].privacy_collision) return out_(i, 'AMBIGUOUS', 'รหัสจับคู่ตรงกับหมายเดิมหลายฉบับ ต้องตรวจสอบก่อนนำเข้า', '', rec);
    if (existing[uid] && existing[uid].canonical_uid) uid = existing[uid].canonical_uid;
    if (!rec.pay_type) return out_(i, 'AMBIGUOUS', 'ไม่ทราบประเภทหมาย (มีเงิน/ฟรี)', uid, rec);
    if (rec.issues.length) return out_(i, 'AMBIGUOUS', rec.issues.join(' · '), uid, rec);
    if (!rec.issued_date && !rec.delivered_date && !periodTo) return out_(i, 'ERROR', 'ไม่มีวันที่จ่ายหมาย และไม่ทราบช่วงวันที่ของรายงาน', uid, rec);
    rec.period_to = periodTo || '';
    rec.row_hash = hashOf_(rec, ISSUE_HASH_FIELDS);
    rec.result_hash = rec.delivered_date ? hashOf_(rec, RESULT_HASH_FIELDS) : '';
    if (seen[uid] !== undefined) {
      // 0.6.3: แถวซ้ำกันทุกช่อง = รายงานศาลพิมพ์ซ้ำ → นับฉบับเดียว ไม่ต้องให้เจ้าหน้าที่ตรวจ
      //        (หมายฟรีกฎข้อ 7 นับครั้งเดียวอยู่แล้ว · หมายมีเงินยอดเงินมาจากบัญชีจ่ายเงินจริง)
      if (seen[uid] === rec.row_hash) return out_(i, 'SAME', 'แถวซ้ำกันทุกช่องในไฟล์เดียวกัน (แถว ' + (seenRow[uid] + 2) + ') — นับฉบับเดียว', uid, rec);
      // คีย์ซ้ำแต่ข้อมูลต่างกัน: ไม่ยุบเอง (อาจเป็นหมาย 2 ฉบับจริง) → ให้งานหมายตรวจ
      return out_(i, 'AMBIGUOUS', 'คีย์ซ้ำในไฟล์แต่ข้อมูลต่างกัน (แถว ' + (seenRow[uid] + 2) + ')', uid, rec);
    }
    seen[uid] = rec.row_hash; seenRow[uid] = i;
    var ex = existing[uid];
    if (!ex) return out_(i, 'NEW', '', uid, rec);
    var sameIssue = ex.row_hash === rec.row_hash;
    var sameResult = !rec.delivered_date || ex.result_hash === rec.result_hash;
    if (sameIssue && sameResult) return out_(i, 'SAME', '', uid, rec);
    if (ex.locked) return out_(i, 'HELD', 'หมายนี้เข้ารอบจ่าย/เบิกแล้ว — ส่งเข้ารายการปรับปรุงรออนุมัติ', uid, rec);
    return out_(i, 'CHANGED', sameIssue ? 'เพิ่ม/แก้ผลการส่ง' : 'ข้อมูลหมายเปลี่ยน', uid, rec);
  });
}

/* ---------- จัดกลุ่ม: ไฟล์ผลหมาย ---------- */
/**
 * ไฟล์ผลหมายของศาลไม่มีที่อยู่ และเขียนชื่อหมายสั้นกว่า → จับคู่ด้วย เลขคดี + ผู้รับ + ผู้ส่ง
 *  · ผู้รับคนเดียวมีหลายหมาย → เลือกเฉพาะที่ชื่อหมายเข้ากันได้ และยังไม่มีผล
 *  · เหลือมากกว่า 1 ฉบับ → กำกวม (ไม่เดา) ให้งานหมายตรวจ
 */
function classifyResult_(rows, mapping, keys, opts, existing, offIdx, areaIdx) {
  var mkeys = resultKeys_(keys);
  var index = {};
  Object.keys(existing).forEach(function (uid) {
    var e = existing[uid];
    var mrec = e.rec || (e.obj ? storedMatchRec_(e.obj) : null);
    if (!mrec) return;
    var mk = keyOf_(mrec, mkeys);
    if (mk) (index[mk] = index[mk] || []).push(uid);
  });
  var claimed = {};
  return rows.map(function (row, i) {
    var rec = toRecord_(row, mapping, opts, offIdx, areaIdx);
    if (rec.delivered_date === null) return out_(i, 'ERROR', 'วันที่ส่งอ่านไม่ได้', '', rec);
    if (rec.issued_date === null) return out_(i, 'ERROR', 'วันที่จ่ายหมายอ่านไม่ได้', '', rec);
    // จ่ายก่อนวันเริ่มปีงบ: ส่งก่อนวันเริ่มด้วย → ไม่นับ · ส่งตั้งแต่วันเริ่ม → นับเฉพาะหมายมีเงิน (หมายฟรีไม่นับ)
    var pre = beforeStart_(rec.issued_date, opts);
    if (pre && (!rec.delivered_date || beforeStart_(rec.delivered_date, opts)))
      return out_(i, 'OUTSIDE', 'จ่ายและส่งหมายก่อนเริ่มปีงบ (' + opts.start_date + ')', '', rec);
    if (mkeys.indexOf('officer') >= 0 && !rec.officer_id) return out_(i, 'AMBIGUOUS', 'จับคู่ผู้ส่งหมายไม่ได้: ' + (rec.officer_raw || '(ว่าง)'), '', rec);
    var mk = keyOf_(rec, mkeys);
    if (!mk) return out_(i, 'ERROR', 'ช่องคีย์ไม่ครบ (' + mkeys.join(', ') + ')', '', rec);
    if (!rec.delivered_date) return out_(i, 'ERROR', 'ไม่มีวันที่ส่ง', mk, rec);
    rec.result_hash = hashOf_(rec, RESULT_HASH_FIELDS);
    // หมายฟรีที่อยู่ในระบบแล้ว (เช่น ไฟล์ 50 ช่วงวันที่คร่อมวันเริ่ม) → เติมวันที่ไว้ตรวจย้อนหลัง แต่คำนวณเป็น "ก่อนเริ่มปีงบ" ไม่คิดเงิน
    var preFree = false;
    if (pre) {
      var all = index[mk] || [];
      if (!all.length) return out_(i, 'OUTSIDE', 'จ่ายหมายก่อนเริ่มปีงบ ไม่พบในระบบ — ถ้าเป็นหมายมีเงิน ให้นำเข้าไฟล์จ่ายหมาย (50) ของช่วงที่จ่ายก่อน แล้วนำเข้าไฟล์นี้ซ้ำ', '', rec);
      preFree = !all.some(function (u) { return payOf_(existing[u]) === 'PAID'; });
    }
    var r = matchResult_(i, rec, mk, index, existing, claimed, pre && !preFree);
    if (preFree && ['CHANGED', 'SAME', 'HELD'].indexOf(r.cls) >= 0) r.reason = 'หมายฟรีจ่ายก่อนเริ่มปีงบ — เติมวันที่ไว้ ไม่นับเงิน';
    return r;
  });
}
/** จับคู่แถวผลหมายกับหมายในระบบ (paidOnly = รับเฉพาะหมายมีเงิน) */
function matchResult_(i, rec, mk, index, existing, claimed, paidOnly) {
    var cands = (index[mk] || []).filter(function (u) { return !claimed[u] && kindOk_(rec.notice_kind, existing[u]) && (!paidOnly || payOf_(existing[u]) === 'PAID'); });
    if (!(index[mk] || []).length) return out_(i, 'AMBIGUOUS', 'ไม่พบหมายต้นทาง (ยังไม่ได้นำเข้าไฟล์จ่ายหมายของหมายนี้?)', mk, rec);
    if (!cands.length) {
      // 0.6.3: แถวผลซ้ำในไฟล์ (ผลเดียวกับที่จับคู่ไปแล้ว หรือที่มีในระบบแล้ว) → ไม่ต้องตรวจ
      var dup = (index[mk] || []).filter(function (u) { return claimed[u] === rec.result_hash || existing[u].result_hash === rec.result_hash; });
      if (dup.length) return out_(i, 'SAME', 'แถวผลซ้ำ (ผลเดียวกับที่มีอยู่แล้ว)', dup[0], rec);
      return out_(i, 'AMBIGUOUS', 'พบหมายของผู้รับนี้ แต่จับคู่ไม่ได้ (ชื่อหมายไม่ตรง หรือถูกจับคู่ในไฟล์นี้แล้ว)', mk, rec);
    }
    var same = cands.filter(function (u) { return existing[u].result_hash === rec.result_hash; });
    var pick = function (u, cls, why) { claimed[u] = rec.result_hash || true; return out_(i, cls, why, u, rec); };
    if (same.length) return pick(same[0], 'SAME', '');
    var open = cands.filter(function (u) { return !existing[u].result_hash; });
    if (open.length === 1) return pick(open[0], existing[open[0]].locked ? 'HELD' : 'CHANGED', 'เติมวันที่ส่ง/ผล');
    if (open.length > 1) {
      // 0.6.3: ผู้รับคนเดียวมีหมายรอผลหลายฉบับ → เลือกจากผลการส่งที่ไฟล์จ่ายหมาย (50) บันทึกไว้รายฉบับ ถ้าตรงฉบับเดียว
      var byRes = open.filter(function (u) { return resultLike_(rec.result, storedResult_(existing[u])); });
      if (byRes.length === 1) return pick(byRes[0], existing[byRes[0]].locked ? 'HELD' : 'CHANGED', 'เติมวันที่ส่ง/ผล (เลือกฉบับจากผลการส่งที่ตรงกับไฟล์จ่ายหมาย)');
      return out_(i, 'AMBIGUOUS', 'ผู้รับนี้มีหมายรอผล ' + open.length + ' ฉบับ (เลือกเองไม่ได้)', mk, rec);
    }
    if (cands.length === 1) {
      var u = cands[0];
      return pick(u, existing[u].locked ? 'HELD' : 'CHANGED', existing[u].locked ? 'หมายนี้เข้ารอบจ่าย/เบิกแล้ว — ส่งเข้ารายการปรับปรุงรออนุมัติ' : 'แก้ผลการส่ง');
    }
    return out_(i, 'AMBIGUOUS', 'ผู้รับนี้มีหมายที่มีผลแล้วหลายฉบับ ผลใหม่ไม่ตรงฉบับใด', mk, rec);
}
/** ผลการส่งที่หมายฉบับนั้นมีอยู่แล้ว (ไฟล์จ่ายหมาย 50 มีคอลัมน์ "ผลการส่งหมาย" รายฉบับ) */
function storedResult_(ex) { return String((ex.obj && ex.obj.result) || (ex.rec && ex.rec.result) || ''); }
/** ผลการส่ง 2 ข้อความเป็นเรื่องเดียวกัน: ตัดช่องว่าง แล้วต้นข้อความ 14 ตัวอักษรตรงกัน (เช่น "ส่งได้ โดยมีผู้รับหมายแทน" ≠ "ส่งได้ โดยวิธีรับหมาย") */
function resultLike_(a, b) {
  var x = normText_(a).replace(/\s+/g, ''), y = normText_(b).replace(/\s+/g, '');
  var L = Math.min(14, x.length, y.length);
  return L >= 8 && x.slice(0, L) === y.slice(0, L);
}
/** ชื่อหมายเข้ากันได้: ว่าง หรือขึ้นต้นตรงกัน ("หมายนัด" ↔ "หมายนัด สำเนาคำร้อง") */
function kindOk_(kind, ex) {
  var a = String(kind || '').replace(/\s+/g, ''), b = String((ex.rec && ex.rec.notice_kind) || (ex.obj && ex.obj.notice_kind) || '').replace(/\s+/g, '');
  return !a || !b || a.indexOf(b) === 0 || b.indexOf(a) === 0;
}

/** ประเภทหมาย (PAID/BUDGET) ของหมายที่มีอยู่แล้ว */
function payOf_(ex) { return String((ex.rec && ex.rec.pay_type) || (ex.obj && ex.obj.pay_type) || ''); }

/** วันเริ่มประมวลผล (ISO) จากปีงบ พ.ศ. เช่น 2570 → 2026-10-01 */
function fyStartDate_(fyBE, startMonth) {
  var y = Number(fyBE); if (!y) return '';
  return (y - 543 - 1) + '-' + pad2_(startMonth || 10) + '-01';
}
/** หมายที่จ่ายก่อนปีงบเริ่มประมวลผล → ไม่นำเข้า (ไม่เข้ารอตรวจ) */
function beforeStart_(dateIso, opts) { return !!(opts.start_date && dateIso && dateIso < opts.start_date); }

function out_(i, cls, reason, uid, rec) { return { i: i, cls: cls, reason: reason, uid: uid, rec: rec }; }

function countClasses_(res) {
  var c = { NEW: 0, SAME: 0, CHANGED: 0, HELD: 0, AMBIGUOUS: 0, ERROR: 0, OUTSIDE: 0 };
  res.forEach(function (r) { c[r.cls]++; });
  return c;
}

if (typeof module !== 'undefined') {
  module.exports = { IMPORT_FIELDS: IMPORT_FIELDS, normName_: normName_, normPlace_: normPlace_, normMoo_: normMoo_,
    parseDate_: parseDate_, fiscalYear_: fiscalYear_, normPayType_: normPayType_, validateKeyFields_: validateKeyFields_,
    buildOfficerIndex_: buildOfficerIndex_, resolveOfficer_: resolveOfficer_, buildAreaIndex_: buildAreaIndex_,
    resolveArea_: resolveArea_, classifyIssue_: classifyIssue_, classifyResult_: classifyResult_, countClasses_: countClasses_,
    hashOf_: hashOf_, ISSUE_HASH_FIELDS: ISSUE_HASH_FIELDS, RESULT_HASH_FIELDS: RESULT_HASH_FIELDS,
    splitCase_: splitCase_, parseAddress_: parseAddress_, normAmount_: normAmount_, DEFAULT_KEY_FIELDS: DEFAULT_KEY_FIELDS,
    FLAG_PRICE_NE_RATE: FLAG_PRICE_NE_RATE, FLAG_DATE_UNSURE: FLAG_DATE_UNSURE, fyStartDate_: fyStartDate_, resultLike_: resultLike_ };
}
