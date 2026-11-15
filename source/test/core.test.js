// ทดสอบตรรกะนำเข้า (Core.gs) ด้วย node — รัน: node test/core.test.js
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ctx = { module: { exports: {} }, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas/ImportFormats.gs'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas/Core.gs'), 'utf8'), ctx);
const C = ctx.module.exports;

let n = 0;
function t(name, fn) { fn(); n++; console.log('✓', name); }

t('วันที่ พ.ศ./ค.ศ./ไทย', () => {
  assert.strictEqual(C.parseDate_('01/11/2569'), '2026-11-01');
  assert.strictEqual(C.parseDate_('1/11/69'), '2026-11-01');
  assert.strictEqual(C.parseDate_('๑/๑๑/๒๕๖๙'), '2026-11-01');
  assert.strictEqual(C.parseDate_('2026-11-01'), '2026-11-01');
  assert.strictEqual(C.parseDate_('1 พ.ย. 2569'), '2026-11-01');
  assert.strictEqual(C.parseDate_('1 พฤศจิกายน 2569'), '2026-11-01');
  assert.strictEqual(C.parseDate_('31/02/2569'), null);
  assert.strictEqual(C.parseDate_(''), '');
});
t('ปีงบประมาณ', () => {
  assert.strictEqual(C.fiscalYear_('2026-09-30'), '2569');
  assert.strictEqual(C.fiscalYear_('2026-10-01'), '2570');
});
t('จัดรูปชื่อ/พื้นที่/หมู่', () => {
  assert.strictEqual(C.normName_('นาย โกมล  ไผ่งาม'), 'โกมลไผ่งาม');
  assert.strictEqual(C.normPlace_('อ.บ้านหมี่'), 'บ้านหมี่');
  assert.strictEqual(C.normPlace_('ตำบล ท่าหิน'), 'ท่าหิน');
  assert.strictEqual(C.normMoo_('หมู่ที่ ๓'), '3');
  assert.strictEqual(C.normMoo_('ม.03'), '3');
});
t('ประเภทหมาย', () => {
  assert.strictEqual(C.normPayType_('หมายฟรี'), 'BUDGET');
  assert.strictEqual(C.normPayType_('มีเงิน'), 'PAID');
  assert.strictEqual(C.normPayType_('', 'PAID'), 'PAID');
  assert.strictEqual(C.normPayType_('อะไรก็ไม่รู้'), '');
});
t('คีย์ห้ามเลขคดีอย่างเดียว', () => {
  assert.ok(C.validateKeyFields_(['case_no']));
  assert.strictEqual(C.validateKeyFields_(['case_no', 'notice_no']), '');
});

const officers = [
  { officer_id: 'OF02', first_name: 'โกมล', last_name: 'ไผ่งาม', name_aliases: '' },
  { officer_id: 'OF07', first_name: 'พัชรินทร์', last_name: '', name_aliases: 'จ่าพัช' }
];
const areas = [
  { area_id: '160605', amphoe_name: 'บ้านหมี่', tambon_name: 'บ้านชี' },
  { area_id: '160102', amphoe_name: 'เมืองลพบุรี', tambon_name: 'ท่าหิน' }
];
const offIdx = C.buildOfficerIndex_(officers);
const areaIdx = C.buildAreaIndex_(areas);
t('จับคู่ผู้ส่ง', () => {
  assert.strictEqual(C.resolveOfficer_('นายโกมล ไผ่งาม', offIdx), 'OF02');
  assert.strictEqual(C.resolveOfficer_('โกมล', offIdx), 'OF02');
  assert.strictEqual(C.resolveOfficer_('จ่าพัช', offIdx), 'OF07');
  assert.strictEqual(C.resolveOfficer_('ใครก็ไม่รู้', offIdx), '');
});
t('จับคู่ตำบล', () => {
  assert.strictEqual(C.resolveArea_('อ.บ้านหมี่', 'ต.บ้านชี', areaIdx), '160605');
  assert.strictEqual(C.resolveArea_('', 'ท่าหิน', areaIdx), '160102');
});

const mapping = { case_no: 'เลขคดี', notice_no: 'เลขหมาย', recipient: 'ผู้รับ', pay_type: 'ประเภท',
  moo: 'หมู่', tambon: 'ตำบล', amphoe: 'อำเภอ', officer: 'ผู้ส่ง', issued_date: 'วันที่จ่าย', house_no: 'บ้านเลขที่' };
const keys = ['case_no', 'notice_no', 'recipient'];
const row = (o) => Object.assign({ 'เลขคดี': 'ผบ.121/2569', 'เลขหมาย': '1', 'ผู้รับ': 'นายสมชาย ใจดี', 'ประเภท': 'ฟรี',
  'หมู่': '3', 'ตำบล': 'บ้านชี', 'อำเภอ': 'บ้านหมี่', 'ผู้ส่ง': 'โกมล', 'วันที่จ่าย': '01/11/2569', 'บ้านเลขที่': '12' }, o);

t('ไฟล์จ่ายหมาย: ใหม่ / ซ้ำในไฟล์ / กำกวม / ผิดพลาด', () => {
  const rows = [row(), row(), row({ 'เลขหมาย': '2', 'ผู้ส่ง': 'ไม่รู้จัก' }), row({ 'เลขหมาย': '3', 'วันที่จ่าย': '99/99/99' }),
                row({ 'เลขหมาย': '4', 'ประเภท': '' }), row({ 'เลขหมาย': '' })];
  const res = C.classifyIssue_(rows, mapping, keys, {}, {}, offIdx, areaIdx);
  // 0.6.3: แถวซ้ำทุกช่องในไฟล์เดียวกัน → นับฉบับเดียว (SAME) ไม่ต้องให้เจ้าหน้าที่ตรวจ
  assert.deepStrictEqual(res.map(r => r.cls), ['NEW', 'SAME', 'AMBIGUOUS', 'ERROR', 'AMBIGUOUS', 'ERROR']);
  assert.ok(/นับฉบับเดียว/.test(res[1].reason));
  assert.strictEqual(res[0].rec.area_id, '160605');
  assert.strictEqual(res[0].rec.officer_id, 'OF02');
  assert.strictEqual(res[0].uid, 'ผบ.121/2569|1|สมชายใจดี');
});

t('นำเข้าไฟล์เดิมซ้ำ 10 รอบ ยอดไม่เพิ่ม (เกณฑ์ตรวจรับ)', () => {
  const rows = [row(), row({ 'เลขหมาย': '2' })];
  const existing = {};
  for (let round = 0; round < 10; round++) {
    const res = C.classifyIssue_(rows, mapping, keys, {}, existing, offIdx, areaIdx);
    const c = C.countClasses_(res);
    if (round === 0) assert.strictEqual(c.NEW, 2); else { assert.strictEqual(c.NEW, 0); assert.strictEqual(c.SAME, 2); }
    res.filter(r => r.cls === 'NEW').forEach(r => existing[r.uid] = { row_hash: r.rec.row_hash, result_hash: r.rec.result_hash, locked: false, rec: r.rec });
  }
});

t('ไฟล์เดิม 100 + ใหม่ 30 → เพิ่ม 30 ข้าม 100 (เกณฑ์ตรวจรับ)', () => {
  const base = Array.from({ length: 100 }, (_, i) => row({ 'เลขหมาย': String(i + 1) }));
  const existing = {};
  C.classifyIssue_(base, mapping, keys, {}, existing, offIdx, areaIdx).forEach(r => existing[r.uid] = { row_hash: r.rec.row_hash, result_hash: '', locked: false });
  const more = base.concat(Array.from({ length: 30 }, (_, i) => row({ 'เลขหมาย': String(200 + i) })));
  const c = C.countClasses_(C.classifyIssue_(more, mapping, keys, {}, existing, offIdx, areaIdx));
  assert.strictEqual(c.NEW, 30); assert.strictEqual(c.SAME, 100);
});

t('เลขคดีเดียวหลายหมาย ไม่ถูกยุบ (เกณฑ์ตรวจรับ)', () => {
  const rows = [row({ 'เลขหมาย': '1' }), row({ 'เลขหมาย': '2' }), row({ 'เลขหมาย': '3', 'ผู้รับ': 'นางสาวมาลี ดีใจ' })];
  const c = C.countClasses_(C.classifyIssue_(rows, mapping, keys, {}, {}, offIdx, areaIdx));
  assert.strictEqual(c.NEW, 3);
});

t('แก้ข้อมูล → CHANGED · ถ้าล็อกแล้ว → HELD (เกณฑ์ตรวจรับ)', () => {
  const first = C.classifyIssue_([row()], mapping, keys, {}, {}, offIdx, areaIdx)[0];
  const ex = { [first.uid]: { row_hash: first.rec.row_hash, result_hash: '', locked: false } };
  assert.strictEqual(C.classifyIssue_([row({ 'หมู่': '4' })], mapping, keys, {}, ex, offIdx, areaIdx)[0].cls, 'CHANGED');
  ex[first.uid].locked = true;
  assert.strictEqual(C.classifyIssue_([row({ 'หมู่': '4' })], mapping, keys, {}, ex, offIdx, areaIdx)[0].cls, 'HELD');
});

t('ไฟล์แยกรายคน: ผู้ส่งทั้งไฟล์ + ประเภททั้งไฟล์', () => {
  const m2 = Object.assign({}, mapping); delete m2.officer; delete m2.pay_type;
  const res = C.classifyIssue_([row()], m2, keys, { file_officer_id: 'OF07', default_pay_type: 'PAID' }, {}, offIdx, areaIdx);
  assert.strictEqual(res[0].cls, 'NEW'); assert.strictEqual(res[0].rec.officer_id, 'OF07'); assert.strictEqual(res[0].rec.pay_type, 'PAID');
});

t('ไฟล์ผลหมาย: เติมวันที่ส่ง / ซ้ำ / ไม่พบต้นทาง', () => {
  const first = C.classifyIssue_([row()], mapping, keys, {}, {}, offIdx, areaIdx)[0];
  const ex = { [first.uid]: { row_hash: first.rec.row_hash, result_hash: '', locked: false, rec: first.rec } };
  const rm = { case_no: 'เลขคดี', notice_no: 'เลขหมาย', recipient: 'ผู้รับ', delivered_date: 'วันที่ส่ง', result: 'ผล' };
  const rr = (o) => Object.assign({ 'เลขคดี': 'ผบ.121/2569', 'เลขหมาย': '1', 'ผู้รับ': 'นายสมชาย ใจดี', 'วันที่ส่ง': '03/11/2569', 'ผล': 'ส่งได้' }, o);
  let res = C.classifyResult_([rr(), rr({ 'เลขหมาย': '9' }), rr({ 'วันที่ส่ง': '' })], rm, keys, {}, ex, offIdx, areaIdx);
  assert.deepStrictEqual(res.map(r => r.cls), ['CHANGED', 'AMBIGUOUS', 'ERROR']);
  ex[first.uid].result_hash = res[0].rec.result_hash;
  res = C.classifyResult_([rr()], rm, keys, {}, ex, offIdx, areaIdx);
  assert.strictEqual(res[0].cls, 'SAME');
});

t('เริ่มประมวลผลตามปีงบประมาณ: จ่ายหมายก่อน 1 ต.ค. 2569 = นอกปีงบที่เริ่ม', () => {
  assert.strictEqual(C.fyStartDate_('2570', 10), '2026-10-01');
  const opts = { start_date: '2026-10-01' };
  const res = C.classifyIssue_([row({ 'วันที่จ่าย': '30/09/2569' }), row({ 'เลขหมาย': '2', 'วันที่จ่าย': '01/10/2569' })], mapping, keys, opts, {}, offIdx, areaIdx);
  assert.deepStrictEqual(res.map(r => r.cls), ['OUTSIDE', 'NEW']);
  assert.strictEqual(C.countClasses_(res).OUTSIDE, 1);
  const rm = { case_no: 'เลขคดี', notice_no: 'เลขหมาย', recipient: 'ผู้รับ', delivered_date: 'วันที่ส่ง', issued_date: 'วันที่จ่าย', result: 'ผล' };
  const rr = C.classifyResult_([{ 'เลขคดี': 'ผบ.1/2569', 'เลขหมาย': '1', 'ผู้รับ': 'นายก', 'วันที่ส่ง': '02/10/2569', 'วันที่จ่าย': '25/09/2569', 'ผล': 'ส่งได้' },
                                { 'เลขคดี': 'ผบ.2/2569', 'เลขหมาย': '1', 'ผู้รับ': 'นายข', 'วันที่ส่ง': '02/10/2569', 'วันที่จ่าย': '01/10/2569', 'ผล': 'ส่งได้' }], rm, keys, opts, {}, offIdx, areaIdx);
  assert.deepStrictEqual(rr.map(r => r.cls), ['OUTSIDE', 'AMBIGUOUS']);
});

t('ก่อนเริ่มปีงบ: หมายฟรีไม่นับ · หมายมีเงินนับตามวันที่ส่ง (ตั้งแต่ 1 ต.ค.)', () => {
  const opts = { start_date: '2026-10-01' };
  // ไฟล์จ่ายหมายเดือน ก.ย. (ไม่มีวันที่รายแถว ใช้ช่วงวันที่ของรายงาน)
  const m50 = Object.assign({}, mapping); delete m50.issued_date;
  const sep = Object.assign({ period_from: '2026-09-01', period_to: '2026-09-30' }, opts);
  const iss = C.classifyIssue_([row({ 'เลขหมาย': '5', 'ประเภท': 'มีเงิน' }), row({ 'เลขหมาย': '6' })], m50, keys, sep, {}, offIdx, areaIdx);
  assert.deepStrictEqual(iss.map(r => r.cls), ['NEW', 'OUTSIDE']);
  assert.ok(/หมายฟรี/.test(iss[1].reason));
  const ex = { [iss[0].uid]: { row_hash: iss[0].rec.row_hash, result_hash: '', locked: false, rec: iss[0].rec } };
  // ไฟล์ผลหมาย: จ่าย ก.ย.
  const rm = { case_no: 'เลขคดี', notice_no: 'เลขหมาย', recipient: 'ผู้รับ', delivered_date: 'วันที่ส่ง', issued_date: 'วันที่จ่าย', result: 'ผล' };
  const rr = (o) => Object.assign({ 'เลขคดี': 'ผบ.121/2569', 'เลขหมาย': '5', 'ผู้รับ': 'นายสมชาย ใจดี', 'วันที่ส่ง': '02/10/2569', 'วันที่จ่าย': '25/09/2569', 'ผล': 'ส่งได้' }, o);
  const res = C.classifyResult_([
    rr(),                                                   // หมายมีเงิน ส่ง 2 ต.ค. → นับ
    rr({ 'เลขหมาย': '5', 'วันที่ส่ง': '28/09/2569' }),       // ส่งก่อนวันเริ่ม → ไม่นับ
    rr({ 'เลขคดี': 'ผบ.999/2569', 'เลขหมาย': '1' })         // ไม่พบในระบบ (ยังไม่นำเข้าไฟล์ 50 เดือน ก.ย.)
  ], rm, keys, opts, ex, offIdx, areaIdx);
  assert.deepStrictEqual(res.map(r => r.cls), ['CHANGED', 'OUTSIDE', 'OUTSIDE']);
  assert.ok(/ไฟล์จ่ายหมาย \(50\)/.test(res[2].reason));
  // หมายฟรีที่อยู่ในระบบแล้ว (เช่น นำเข้าก่อนมีกฎนี้) จ่าย ก.ย. ส่ง ต.ค. → เติมวันที่ ไม่นับเงิน
  const fr = C.classifyIssue_([row({ 'เลขหมาย': '7', 'วันที่จ่าย': '01/10/2569' })], mapping, keys, {}, {}, offIdx, areaIdx)[0];
  const ex2 = { [fr.uid]: { row_hash: fr.rec.row_hash, result_hash: '', locked: false, rec: fr.rec } };
  const r2 = C.classifyResult_([rr({ 'เลขหมาย': '7' })], rm, keys, opts, ex2, offIdx, areaIdx);
  assert.strictEqual(r2[0].cls, 'CHANGED'); assert.ok(/หมายฟรีจ่ายก่อนเริ่มปีงบ/.test(r2[0].reason));   // เติมวันที่ แต่ Calc ตัดเป็น PRE_START
});

t('ไฟล์ 50 คร่อมวันเริ่มปีงบ: รับทุกแถว ทำเครื่องหมายรอยืนยันวันที่จ่าย', () => {
  const m50 = Object.assign({}, mapping); delete m50.issued_date;
  const opts = { start_date: '2026-10-01', period_from: '2026-09-15', period_to: '2026-10-15', date_unsure: true };
  const res = C.classifyIssue_([row({ 'เลขหมาย': '11' }), row({ 'เลขหมาย': '12', 'ประเภท': 'มีเงิน' })], m50, keys, opts, {}, offIdx, areaIdx);
  assert.deepStrictEqual(res.map(r => r.cls), ['NEW', 'NEW']);
  assert.ok(res.every(r => r.rec.flags.indexOf(C.FLAG_DATE_UNSURE) >= 0));
});

t('0.6.3 ผลหมาย: ผู้รับเดียวมีหมายรอผล 2 ฉบับ → เลือกจากผลการส่งในไฟล์จ่ายหมาย · แถวผลซ้ำไม่ต้องตรวจ', () => {
  // หมายเรียกคดีเดียวกัน ผู้รับเดียวกัน 2 ตำบล (เลขหมายว่าง) — ไฟล์ 50 มีผลการส่งรายฉบับ แต่ไฟล์ 42 ไม่มีตำบล
  const k2 = ['case_no', 'recipient', 'officer', 'notice_kind', 'house_no', 'moo'];
  const m50 = Object.assign({}, mapping, { notice_kind: 'หมาย', result: 'ผล' }); delete m50.notice_no;
  const a = row({ 'เลขคดี': 'มฝ22/2569', 'หมาย': 'หมายเรียก สำเนาคำร้อง', 'ตำบล': 'บ้านชี', 'อำเภอ': 'บ้านหมี่', 'หมู่': '1', 'ผล': 'ส่งได้ โดยมีผู้รับหมายแทน มีอายุเกิน 20 ปี' });
  const b = row({ 'เลขคดี': 'มฝ22/2569', 'หมาย': 'หมายเรียก สำเนาคำร้อง', 'ตำบล': 'ท่าหิน', 'อำเภอ': 'เมืองลพบุรี', 'หมู่': '2', 'ผล': 'ส่งได้ โดยวิธีรับหมายได้ด้วยตนเอง' });
  const iss = C.classifyIssue_([a, b], m50, k2, {}, {}, offIdx, areaIdx);
  assert.deepStrictEqual(iss.map(r => r.cls), ['NEW', 'NEW'], JSON.stringify(iss.map(r => r.reason)));
  const ex = {}; iss.forEach((r) => { ex[r.uid] = { row_hash: r.rec.row_hash, result_hash: '', locked: false, rec: r.rec }; });
  const rm = { case_no: 'เลขคดี', recipient: 'ผู้รับ', officer: 'ผู้ส่ง', notice_kind: 'หมาย', delivered_date: 'วันที่ส่ง', result: 'ผล' };
  const rr = (o) => Object.assign({ 'เลขคดี': 'มฝ22/2569', 'ผู้รับ': 'นายสมชาย ใจดี', 'ผู้ส่ง': 'โกมล', 'หมาย': 'หมายเรียก' }, o);
  const r17 = rr({ 'วันที่ส่ง': '17/10/2569', 'ผล': 'ส่งได้ โดยมีผู้รับหมายแทน' }), r20 = rr({ 'วันที่ส่ง': '20/10/2569', 'ผล': 'ส่งได้ โดยวิธีรับหมายได้ด้วยตนเอง' });
  const res = C.classifyResult_([r17, r20, r17], rm, k2, {}, ex, offIdx, areaIdx);
  assert.deepStrictEqual(res.map(r => r.cls), ['CHANGED', 'CHANGED', 'SAME']);
  assert.strictEqual(res[0].uid, iss[0].uid);          // ส่งได้ 17 ต.ค. → ฉบับ ต.ท่าศาลา
  assert.strictEqual(res[1].uid, iss[1].uid);          // ส่งได้ 20 ต.ค. → ฉบับ ต.ทะเลชุบศร
  assert.ok(/แถวผลซ้ำ/.test(res[2].reason));
  // ผลการส่งเหมือนกันทั้ง 2 ฉบับ → ยังกำกวม (ไม่เดา)
  const ex2 = {}; iss.forEach((r) => { ex2[r.uid] = { row_hash: r.rec.row_hash, result_hash: '', locked: false, rec: Object.assign({}, r.rec, { result: 'ส่งได้ โดยมีผู้รับหมายแทน' }) }; });
  assert.strictEqual(C.classifyResult_([r17], rm, k2, {}, ex2, offIdx, areaIdx)[0].cls, 'AMBIGUOUS');
  assert.ok(C.resultLike_('ส่งได้ โดยมีผู้รับหมายแทน', 'ส่งได้  โดยมีผู้รับหมายแทน มีอายุ') && !C.resultLike_('ส่งได้ โดยมีผู้รับหมายแทน', 'ส่งได้ โดยวิธีรับหมาย'));
});

console.log(`\nผ่านทั้งหมด ${n} ชุดทดสอบ`);
