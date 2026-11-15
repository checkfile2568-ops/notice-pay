// ทดสอบฝั่ง GAS แบบจำลอง — รัน: node test/gas.smoke.js
// ครอบคลุม: setupSystem → ค้นชื่อ → login (PIN ผิด/ถูก/ไม่มีสิทธิ์) → ตั้งสิทธิ์ → นำเข้า 2 ขั้น → dashboard → ค้นคดี
const assert = require('assert');
const { g, call, props, spreadsheets } = require('./harness');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('✓', name); };

ok('ติดตั้งระบบ', () => {
  g.setupSystem();
  props.PRINTHUB_DB_ID = 'PH';
  const db = spreadsheets.DB;
  assert.strictEqual(db.getSheetByName('RATE_AREAS').getLastRow() - 1, 85);
  assert.strictEqual(db.getSheetByName('OFFICERS').getLastRow() - 1, 10);
  g.setupSystem();   // รันซ้ำไม่เพิ่มข้อมูล
  assert.strictEqual(db.getSheetByName('RATE_AREAS').getLastRow() - 1, 85);
});
ok('ping / ค้นชื่อ', () => {
  assert.ok(call('ping').ok);
  const r = call('search_accounts', { q: 'โกมล' });
  assert.deepStrictEqual(r.data.users.map(u => u.code), ['U006']);
  assert.ok(!('hash' in r.data.users[0]));
});
let adminTok;
ok('login: PIN ผิด / ไม่มี PIN / ไม่มีสิทธิ์ / ผู้ดูแลตั้งต้นเข้าได้', () => {
  let r = call('login', { code: 'U001', pin: '9999' });
  assert.strictEqual(r.code, 'LOGIN_FAILED'); assert.match(r.msg, /เหลืออีก 4/);
  r = call('login', { code: 'U009', pin: '1234' }); assert.strictEqual(r.code, 'NO_PIN');
  r = call('login', { code: 'U006', pin: '1234' }); assert.strictEqual(r.code, 'NO_ACCESS');
  r = call('login', { code: 'U001', pin: '1234' }); assert.ok(r.ok, JSON.stringify(r));
  assert.deepStrictEqual(r.data.user.roles, ['ADMIN']);
  adminTok = r.data.token;
});
ok('ล็อกหลังผิด 5 ครั้ง (เฉพาะระบบนี้)', () => {
  for (let i = 0; i < 5; i++) call('login', { code: 'U006', pin: '0000' });
  const r = call('login', { code: 'U006', pin: '1234' });
  assert.strictEqual(r.code, 'LOCKED');
  delete props.PINF_U006;
});
let courierTok;
ok('ผู้ดูแลให้สิทธิ์ผู้ส่งหมาย + ผูก OF02', () => {
  let r = call('users_list', { token: adminTok }); assert.ok(r.ok); assert.strictEqual(r.data.users.length, 3);
  r = call('user_save', { token: adminTok, code: 'U006', roles: ['COURIER'], officer_id: '' }); assert.strictEqual(r.code, 'BAD_REQUEST');
  r = call('user_save', { token: adminTok, code: 'U006', roles: ['COURIER'], officer_id: 'OF02' }); assert.ok(r.ok);
  r = call('login', { code: 'U006', pin: '1234' }); assert.ok(r.ok); courierTok = r.data.token;
  r = call('import_templates', { token: courierTok }); assert.strictEqual(r.code, 'FORBIDDEN');
});
const mapping = { case_no: 'เลขคดี', notice_no: 'เลขหมาย', recipient: 'ผู้รับ', pay_type: 'ประเภท', moo: 'หมู่', tambon: 'ตำบล', amphoe: 'อำเภอ', officer: 'ผู้ส่ง', issued_date: 'วันที่จ่าย' };
const rows = [
  { 'เลขคดี': 'ผบ.121/2569', 'เลขหมาย': '1', 'ผู้รับ': 'นายสมชาย ใจดี', 'ประเภท': 'ฟรี', 'หมู่': '3', 'ตำบล': 'บ้านชี', 'อำเภอ': 'บ้านหมี่', 'ผู้ส่ง': 'โกมล', 'วันที่จ่าย': '01/11/2569' },
  { 'เลขคดี': 'ผบ.122/2569', 'เลขหมาย': '1', 'ผู้รับ': 'นางมาลี ดีใจ', 'ประเภท': 'มีเงิน', 'หมู่': '1', 'ตำบล': 'ท่าวุ้ง', 'อำเภอ': 'ท่าวุ้ง', 'ผู้ส่ง': 'พัชรินทร์', 'วันที่จ่าย': '02/11/2569' },
  { 'เลขคดี': 'ผบ.123/2569', 'เลขหมาย': '1', 'ผู้รับ': 'นายดำ', 'ประเภท': 'ฟรี', 'หมู่': '2', 'ตำบล': 'ท่าหิน', 'อำเภอ': 'เมือง', 'ผู้ส่ง': 'ไม่รู้จัก', 'วันที่จ่าย': '02/11/2569' }
];
ok('นำเข้าไฟล์จ่ายหมาย: ตรวจก่อน → ยืนยัน → นำเข้าซ้ำไม่เพิ่ม', () => {
  const body = { token: adminTok, kind: 'ISSUE', mapping, key_fields: ['case_no', 'notice_no', 'recipient'], rows, file: { name: 'จ่ายหมาย.xlsx', checksum: 'abc' } };
  let r = call('import_preview', body); assert.ok(r.ok, JSON.stringify(r));
  assert.deepStrictEqual([r.data.counts.NEW, r.data.counts.AMBIGUOUS], [2, 1]);
  r = call('import_commit', body); assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.data.inserted, 2); assert.strictEqual(r.data.review_rows, 1);
  r = call('import_preview', body); assert.strictEqual(r.data.counts.NEW, 0); assert.strictEqual(r.data.counts.SAME, 2); assert.ok(r.data.duplicate_file);
  r = call('import_commit', body); assert.strictEqual(r.data.inserted, 0);
  assert.strictEqual(spreadsheets.DB.getSheetByName('NOTICES').getLastRow() - 1, 2);
  const tpl = call('import_templates', { token: adminTok }); assert.ok(tpl.data.templates.ISSUE);
  // 0.6.2: สถานะไฟล์ล่าสุดต่อชนิด + ช่วงวันที่ในไฟล์ (ไม่มีหัวรายงาน → วันที่น้อยสุด–มากสุด) · ชื่อผู้ส่งแสดงเฉพาะชื่อ
  const L = tpl.data.last.ISSUE; assert.ok(L && L.n === 2 && /^\d{4}-\d{2}-\d{2}$/.test(L.from) && L.to >= L.from, JSON.stringify(L));
  assert.ok(!tpl.data.last.PAY && !('batch_id' in L));
  tpl.data.officers.forEach((o) => assert.ok(o.name && o.name.indexOf(' ') < 0, o.name));
  const r2 = call('import_commit', Object.assign({}, body, { options: { period_from: '1 พฤศจิกายน 2569', period_to: '12 พฤศจิกายน 2569' } }));
  assert.ok(r2.ok, JSON.stringify(r2));
  const L2 = call('import_templates', { token: adminTok }).data.last.ISSUE;
  assert.deepStrictEqual([L2.n, L2.from, L2.to], [3, '2026-11-01', '2026-11-12']);
});
ok('นำเข้าไฟล์ผลหมายวันอื่น → สถานะส่งแล้ว', () => {
  const rm = { case_no: 'เลขคดี', notice_no: 'เลขหมาย', recipient: 'ผู้รับ', delivered_date: 'วันที่ส่ง', result: 'ผล' };
  const rr = [{ 'เลขคดี': 'ผบ.121/2569', 'เลขหมาย': '1', 'ผู้รับ': 'นายสมชาย ใจดี', 'วันที่ส่ง': '05/11/2569', 'ผล': 'ส่งได้' },
              { 'เลขคดี': 'ผบ.999/2569', 'เลขหมาย': '1', 'ผู้รับ': 'ใครไม่รู้', 'วันที่ส่ง': '05/11/2569', 'ผล': 'ส่งได้' }];
  const r = call('import_commit', { token: adminTok, kind: 'RESULT', mapping: rm, key_fields: ['case_no', 'notice_no', 'recipient'], rows: rr, file: { name: 'ผลหมาย.xlsx' } });
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.data.updated, 1); assert.strictEqual(r.data.counts.AMBIGUOUS, 1);
});
ok('dashboard: ผู้ดูแลเห็นทั้งหมด / ผู้ส่งเห็นของตัวเอง', () => {
  let r = call('dashboard', { token: adminTok, fy: '2570' }); assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.data.totals.total, 2); assert.strictEqual(r.data.totals.delivered, 1); assert.strictEqual(r.data.pending_review, 2);
  r = call('dashboard', { token: courierTok, fy: '2570' });
  assert.strictEqual(r.data.totals.total, 1); assert.strictEqual(r.data.officers.length, 1);
});
ok('ค้นเลขคดี', () => {
  let r = call('notice_search', { token: adminTok, q: '121/2569' }); assert.strictEqual(r.data.rows.length, 1);
  assert.strictEqual(r.data.rows[0].status, 'DELIVERED'); assert.strictEqual(r.data.rows[0].delivered_date, '2026-11-05');
  r = call('notice_search', { token: courierTok, q: '122/2569' }); assert.strictEqual(r.data.rows.length, 0);
});
ok('ผลหมายที่ค้าง "ไม่พบต้นทาง" → นำเข้าไฟล์จ่ายหมายย้อนหลัง → นำเข้าผลซ้ำ จับคู่ได้และปิดรอตรวจอัตโนมัติ', () => {
  const late = [{ 'เลขคดี': 'ผบ.999/2569', 'เลขหมาย': '1', 'ผู้รับ': 'ใครไม่รู้', 'ประเภท': 'ฟรี', 'หมู่': '1', 'ตำบล': 'ท่าหิน', 'อำเภอ': 'เมือง', 'ผู้ส่ง': 'โกมล', 'วันที่จ่าย': '20/10/2569' }];
  let r = call('import_commit', { token: adminTok, kind: 'ISSUE', mapping, key_fields: ['case_no', 'notice_no', 'recipient'], rows: late, file: { name: 'จ่ายหมาย ต.ค..xlsx' } });
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.data.inserted, 1);
  // 0.6.3: นำเข้าไฟล์จ่ายหมายแล้ว ระบบลองจับคู่ผลหมายที่ค้าง "ไม่พบต้นทาง" ให้ทันที (ไม่ต้องนำเข้าไฟล์ผลซ้ำ)
  assert.strictEqual(r.data.review_auto_resolved, 1, JSON.stringify(r.data.retry));
  assert.strictEqual(call('notice_search', { token: adminTok, q: '999/2569' }).data.rows[0].status, 'DELIVERED');
  const rm = { case_no: 'เลขคดี', notice_no: 'เลขหมาย', recipient: 'ผู้รับ', delivered_date: 'วันที่ส่ง', result: 'ผล' };
  const rr = [{ 'เลขคดี': 'ผบ.121/2569', 'เลขหมาย': '1', 'ผู้รับ': 'นายสมชาย ใจดี', 'วันที่ส่ง': '05/11/2569', 'ผล': 'ส่งได้' },
              { 'เลขคดี': 'ผบ.999/2569', 'เลขหมาย': '1', 'ผู้รับ': 'ใครไม่รู้', 'วันที่ส่ง': '05/11/2569', 'ผล': 'ส่งได้' }];
  r = call('import_commit', { token: adminTok, kind: 'RESULT', mapping: rm, key_fields: ['case_no', 'notice_no', 'recipient'], rows: rr, file: { name: 'ผลหมาย.xlsx' } });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepStrictEqual([r.data.counts.SAME, r.data.counts.CHANGED, r.data.counts.AMBIGUOUS, r.data.review_auto_resolved], [2, 0, 0, 0]);
  // 0.6.3 หน้าแถวรอตรวจ: ผลหมายที่ไม่พบต้นทาง → เจ้าหน้าที่เลือกหมายเอง (APPLY) · ไม่ใช้แถว (IGNORE ต้องมีเหตุผล)
  const odd = [{ 'เลขคดี': 'ผบ.121/2569', 'เลขหมาย': '7', 'ผู้รับ': 'นายสมชาย ใจดี', 'วันที่ส่ง': '06/11/2569', 'ผล': 'ส่งได้' },
               { 'เลขคดี': 'ผบ.555/2569', 'เลขหมาย': '1', 'ผู้รับ': 'ไม่มีในระบบ', 'วันที่ส่ง': '06/11/2569', 'ผล': 'ส่งได้' }];
  r = call('import_commit', { token: adminTok, kind: 'RESULT', mapping: rm, key_fields: ['case_no', 'notice_no', 'recipient'], rows: odd, file: { name: 'ผล2.xlsx' } });
  assert.ok(r.ok); assert.strictEqual(r.data.counts.AMBIGUOUS, 2);
  let o = call('review_open', { token: adminTok }); assert.ok(o.ok, JSON.stringify(o));
  const a1 = o.data.rows.find((x) => x.case_no.indexOf('121') >= 0), a2 = o.data.rows.find((x) => x.case_no.indexOf('555') >= 0);
  assert.ok(a1 && a1.cands.length >= 1 && a2 && a2.cands.length === 0, JSON.stringify(o.data.rows.map((x) => [x.case_no, x.cands.length])));
  assert.strictEqual(call('review_open', { token: courierTok }).code, 'FORBIDDEN');
  assert.strictEqual(call('review_resolve', { token: adminTok, op: 'IGNORE', batch_id: a2.batch_id, row_no: a2.row_no }).code, 'BAD_REQUEST');
  r = call('review_resolve', { token: adminTok, op: 'IGNORE', batch_id: a2.batch_id, row_no: a2.row_no, reason: 'ไม่ใช่หมายศาลนี้' }); assert.ok(r.ok, JSON.stringify(r));
  const un = call('notice_search', { token: adminTok, q: '122/2569' });   // หมายที่ยังไม่มีผล ใช้ทดสอบเลือกผิดคดี
  if (un.data.rows[0]) assert.strictEqual(call('review_resolve', { token: adminTok, op: 'APPLY', batch_id: a1.batch_id, row_no: a1.row_no, notice_uid: un.data.rows[0].notice_uid }).code, 'BAD_REQUEST');
  r = call('review_resolve', { token: adminTok, op: 'APPLY', batch_id: a1.batch_id, row_no: a1.row_no, notice_uid: a1.cands[0].notice_uid }); assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.data.applied.delivered_date, '2026-11-06');
  r = call('review_resolve', { token: adminTok, op: 'RETRY' }); assert.ok(r.ok, JSON.stringify(r));
  assert.ok(!call('review_open', { token: adminTok }).data.rows.some((x) => /121|555/.test(x.case_no)));
});
ok('อ่านวันที่/ที่อยู่/เลขดำแบบระบบศาล · ราคา 0.00 = หมายฟรี · เงินไม่เท่าอัตราตำบล = หมายเหตุสีแดง', () => {
  const m = { case_no: 'เลขดำที่', notice_kind: 'หมายอะไร', recipient: 'หมายถึงใคร', address_text: 'ที่อยู่', tambon: 'ตำบล', amphoe: 'อำเภอ', amount: 'ราคา', officer: 'ผู้ส่งหมาย', payer: 'ผู้วางเงิน' };
  const base = { 'เลขดำที่': 'ต9001/2569\nพE1/2569', 'หมายอะไร': 'หมายนัด', 'หมายถึงใคร': 'นายทดสอบ ระบบ จำเลย', 'ที่อยู่': '9 ม. 8 ซ. - ถ. -',
                 'ตำบล': 'บางขันหมาก', 'อำเภอ': 'เมืองลพบุรี', 'ราคา': '550.00', 'ผู้ส่งหมาย': 'นางชุตาภรณ์  สุขเจริญ', 'ผู้วางเงิน': 'ธนาคารทดสอบ' };
  const rowsX = [base,
    Object.assign({}, base, { 'เลขดำที่': 'ต9002/2569', 'ราคา': '700.00' }),                                   // เงินไม่เท่าอัตรา → สีแดง นำเข้าได้
    Object.assign({}, base, { 'เลขดำที่': 'ต9003/2569', 'ราคา': '0.00', 'ผู้วางเงิน': '', 'ที่อยู่': 'สำนักงานอัยการจังหวัดลพบุรี ศาลากลา ม. - ซ. - ถ. -', 'ตำบล': 'ทะเลชุบศร' }),
    Object.assign({}, base, { 'เลขดำที่': 'ต9004/2569', 'ตำบล': 'บางขันหมาก', 'อำเภอ': 'หนองม่วง' }),                // ตำบลไม่อยู่ในอำเภอ → กำกวม
    Object.assign({}, base, { 'เลขดำที่': 'ต9005/2569', 'ประเภท': 'ฟรี' })];                                   // ระบุฟรีแต่ราคามากกว่า 0 → กำกวม
  m.pay_type='ประเภท';
  const r = call('import_preview', { token: adminTok, kind: 'ISSUE', mapping: m, key_fields: ['case_no', 'recipient', 'officer', 'notice_kind', 'house_no', 'moo'],
    rows: rowsX, options: { period_from: '1 พฤศจิกายน 2569', period_to: '12 พฤศจิกายน 2569' }, file: { name: 'บัญชีจ่ายหมาย.xls' } });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepStrictEqual([r.data.counts.NEW, r.data.counts.AMBIGUOUS], [3, 2]);
  assert.strictEqual(r.data.price_ne_rate, 1);
  assert.deepStrictEqual(r.data.totals, { PAID: { n: 2, amount: 1250 }, BUDGET: { n: 1, amount: 0 } });
  assert.strictEqual(r.data.price_adj.up, 1); assert.strictEqual(r.data.price_adj.calc, 1100);   // 550 + (700 → อัตราตำบล 550)
  const s = r.data.samples.NEW;
  // แถวหมายเหตุสีแดงขึ้นก่อน
  assert.strictEqual(s[0].case_no, 'ต9002/2569'); assert.strictEqual(s[0].flags, 'เงินไม่เท่ากับอัตราของตำบล');
  assert.strictEqual(s[1].case_no, 'ต9001/2569'); assert.strictEqual(s[1].case_ref, 'พE1/2569'); assert.strictEqual(s[1].flags, '');
  assert.strictEqual(s[2].pay_type, 'BUDGET'); assert.strictEqual(s[2].addr_type, 'หน่วยงานราชการ');
  assert.match(r.data.samples.AMBIGUOUS[0].reason, /ไม่อยู่ในอำเภอ/); assert.match(r.data.samples.AMBIGUOUS[1].reason, /ระบุเป็นหมายฟรี แต่มีราคา/);
});
ok('เริ่มประมวลผลตามปีงบประมาณ: หมายที่จ่ายก่อน 1 ต.ค. ของปีงบเริ่มระบบ ไม่นำเข้า', () => {
  const t = call('import_templates', { token: adminTok }); assert.strictEqual(t.data.start_fy, '2570');
  const m = { case_no: 'เลขดำที่', recipient: 'ส่งหมายให้ใคร', officer: 'ผู้ปฏิบัติ', issued_date: 'วันที่จ่ายหมาย', delivered_date: 'วันที่ส่งหมาย', result: 'ผล' };
  const rr = [{ 'เลขดำที่': 'อ1/2569', 'ส่งหมายให้ใคร': 'นายเก่า ก่อนปี จำเลย', 'ผู้ปฏิบัติ': 'นายถนิจ มีทรัพย์', 'วันที่จ่ายหมาย': '25-ก.ย.-69', 'วันที่ส่งหมาย': '2-ต.ค.-69', 'ผล': 'ส่งได้' }];
  const r = call('import_commit', { token: adminTok, kind: 'RESULT', mapping: m, key_fields: ['case_no', 'recipient', 'officer'], rows: rr, file: { name: 'ผลหมาย.xls' } });
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.data.counts.OUTSIDE, 1); assert.strictEqual(r.data.review_rows, 0);
});
ok('ไฟล์ 50 คร่อม 1 ต.ค. → รับไว้ รอยืนยันวันที่จ่าย · ไฟล์ 42 คัดแยก: หมายฟรีจ่าย ก.ย. ไม่นับ หมายมีเงินนับตามวันที่ส่ง', () => {
  const m = { case_no: 'เลขดำที่', notice_kind: 'หมายอะไร', recipient: 'หมายถึงใคร', address_text: 'ที่อยู่', tambon: 'ตำบล', amphoe: 'อำเภอ', amount: 'ราคา', officer: 'ผู้ส่งหมาย' };
  const base = { 'หมายอะไร': 'หมายนัด', 'ที่อยู่': '5 ม. 3 ซ. - ถ. -', 'ตำบล': 'ท่าศาลา', 'อำเภอ': 'เมืองลพบุรี', 'ผู้ส่งหมาย': 'นายถนิจ มีทรัพย์' };
  const rows = [Object.assign({ 'เลขดำที่': 'อ801/2569', 'หมายถึงใคร': 'นายฟรี กันยา', 'ราคา': '0.00' }, base),
                Object.assign({ 'เลขดำที่': 'อ802/2569', 'หมายถึงใคร': 'นายเงิน กันยา', 'ราคา': '500.00' }, base)];
  const req = { token: adminTok, kind: 'ISSUE', mapping: m, key_fields: ['case_no', 'recipient', 'officer', 'notice_kind', 'house_no', 'moo'], rows: rows,
    options: { period_from: '15 กันยายน 2569', period_to: '15 ตุลาคม 2569' }, file: { name: 'จ่ายหมาย-คร่อม.xls' } };
  const p = call('import_preview', req);
  assert.ok(p.ok, JSON.stringify(p)); assert.strictEqual(p.data.crosses_start, true); assert.strictEqual(p.data.date_unsure, 2);
  assert.ok(call('import_commit', req).ok);
  let s = call('calc_summary', { token: adminTok, fy: '2570' });
  assert.strictEqual(s.data.totals.date_wait, 2);
  const rm = { case_no: 'เลขดำที่', recipient: 'ส่งหมายให้ใคร', officer: 'ผู้ปฏิบัติ', notice_kind: 'หมายอะไร', issued_date: 'วันที่จ่ายหมาย', delivered_date: 'วันที่ส่งหมาย', result: 'ผล' };
  const rr = ['นายฟรี กันยา', 'นายเงิน กันยา'].map((n, i) => ({ 'เลขดำที่': 'อ80' + (i + 1) + '/2569', 'ส่งหมายให้ใคร': n, 'ผู้ปฏิบัติ': 'นายถนิจ มีทรัพย์',
    'หมายอะไร': 'หมายนัด', 'วันที่จ่ายหมาย': '20-ก.ย.-69', 'วันที่ส่งหมาย': '3-ต.ค.-69', 'ผล': 'ส่งได้' }));
  const c = call('import_commit', { token: adminTok, kind: 'RESULT', mapping: rm, key_fields: ['case_no', 'recipient', 'officer'], rows: rr, file: { name: 'ผล-คร่อม.xls' } });
  assert.ok(c.ok, JSON.stringify(c)); assert.strictEqual(c.data.counts.CHANGED, 2);
  s = call('calc_summary', { token: adminTok, fy: '2570' });
  assert.strictEqual(s.data.totals.date_wait, 0);
  const f = call('notice_search', { token: adminTok, q: 'อ801/2569' }).data.rows[0], g = call('notice_search', { token: adminTok, q: 'อ802/2569' }).data.rows[0];
  assert.match(f.calc_rule, /ก่อนเริ่มปีงบ/); assert.strictEqual(String(g.calc_amount), '550'); assert.strictEqual(g.adj.dir, 'DOWN');   // 500 ต่ำกว่าอัตรา 550 → คิดตามอัตรา
});
ok('ราคาไม่เท่าอัตราตำบล: คิดตามอัตราตำบลอัตโนมัติ (▲ เกิน / ▼ ต่ำกว่า) ไม่ต้องยืนยัน · ยืนยันวันที่จ่าย ก.ย.', () => {
  const m = { case_no: 'เลขดำที่', notice_kind: 'หมายอะไร', recipient: 'หมายถึงใคร', address_text: 'ที่อยู่', tambon: 'ตำบล', amphoe: 'อำเภอ', amount: 'ราคา', officer: 'ผู้ส่งหมาย' };
  const base = { 'หมายอะไร': 'หมายนัด', 'ที่อยู่': '9 ม. 2 ซ. - ถ. -', 'ตำบล': 'ท่าศาลา', 'อำเภอ': 'เมืองลพบุรี', 'ผู้ส่งหมาย': 'นายถนิจ มีทรัพย์' };
  const keys = ['case_no', 'recipient', 'officer', 'notice_kind', 'house_no', 'moo'];
  const mk = (price) => ({ token: adminTok, kind: 'ISSUE', mapping: m, key_fields: keys, file: { name: 'จ่ายหมาย-ราคา.xls' },
    rows: [Object.assign({ 'เลขดำที่': 'พ901/2569', 'หมายถึงใคร': 'นายราคา ไม่ตรง', 'ราคา': price }, base)],
    options: { period_from: '1 พฤศจิกายน 2569', period_to: '12 พฤศจิกายน 2569' } });
  const pv = call('import_preview', mk('999.00')).data;
  assert.strictEqual(pv.price_adj.up, 1); assert.strictEqual(pv.price_adj.calc, 550);   // ต.ท่าศาลา อัตรา 550
  assert.ok(call('import_commit', mk('999.00')).ok);
  let s = call('notice_search', { token: adminTok, q: 'พ901/2569' }).data.rows[0];
  assert.strictEqual(String(s.calc_amount), '550'); assert.strictEqual(s.adj.dir, 'UP'); assert.strictEqual(s.adj.diff, 449);
  assert.match(s.calc_note, /^▲ ราคาไฟล์ 999 เกินอัตราตำบล 550 อยู่ 449 บาท/);
  assert.strictEqual(s.amount_red, false); assert.match(s.flags, /เงินไม่เท่ากับอัตราของตำบล/);
  const sum = call('calc_summary', { token: adminTok, fy: '2570' }).data.totals;
  assert.ok(sum.adj_up >= 1 && sum.adj_up_baht >= 449); assert.strictEqual(sum.red, 0);
  let ch = call('notice_checks', { token: adminTok, fy: '2570' }).data;
  const it = ch.amount.filter((x) => x.case_no === 'พ901/2569')[0];
  assert.ok(it && it.adj && !it.red && ch.can_amount === false);
  assert.ok(call('import_commit', mk('450.00')).ok);                               // ราคาต่ำกว่าอัตรา → ปรับขึ้นเป็นอัตรา
  s = call('notice_search', { token: adminTok, q: 'พ901/2569' }).data.rows[0];
  assert.strictEqual(String(s.calc_amount), '550'); assert.strictEqual(s.adj.dir, 'DOWN'); assert.match(s.calc_note, /^▼/);
  assert.ok(call('import_commit', mk('550.00')).ok);                               // ตรงอัตรา → ไม่มีป้าย
  s = call('notice_search', { token: adminTok, q: 'พ901/2569' }).data.rows[0];
  assert.strictEqual(String(s.calc_amount), '550'); assert.strictEqual(s.adj, null);
  // วันที่จ่ายไม่แน่ชัด → ยืนยัน "จ่ายเดือน ก.ย." → ไม่นับ
  const cross = { token: adminTok, kind: 'ISSUE', mapping: m, key_fields: keys, file: { name: 'จ่ายหมาย-คร่อม2.xls' },
    rows: [Object.assign({ 'เลขดำที่': 'อ901/2569', 'หมายถึงใคร': 'นายไม่พบ ผลหมาย', 'ราคา': '0.00' }, base)],
    options: { period_from: '20 กันยายน 2569', period_to: '5 ตุลาคม 2569' } };
  assert.ok(call('import_commit', cross).ok);
  ch = call('notice_checks', { token: adminTok, fy: '2570' }).data;
  const dt = ch.date.filter((x) => x.case_no === 'อ901/2569')[0];
  assert.ok(dt && !dt.date_ok, JSON.stringify(ch.date) + ' ' + JSON.stringify(call('notice_search', { token: adminTok, q: 'อ901/2569' })));
  const w0 = call('calc_summary', { token: adminTok, fy: '2570' }).data.totals.date_wait;
  const r = call('notice_confirm_date', { token: adminTok, notice_uids: [dt.notice_uid], value: 'BEFORE' });
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.data.updated, 1);
  assert.strictEqual(call('calc_summary', { token: adminTok, fy: '2570' }).data.totals.date_wait, w0 - 1);
  const f = call('notice_search', { token: adminTok, q: 'อ901/2569' }).data.rows[0];
  assert.match(f.calc_rule, /ก่อนเริ่มปีงบ/); assert.match(f.calc_note, /จ่ายเดือน ก\.ย\./); assert.strictEqual(f.date_ok, 'BEFORE');
});
ok('สิทธิ์: การเงินนำเข้าได้ · ไอดีดูสถิติ (ทุกคน) เห็นยอดทุกคน แต่ไม่เห็นรายละเอียดคดี/ผู้รับ และแก้ไขไม่ได้', () => {
  let r = call('user_save', { token: adminTok, code: 'U006', roles: ['FINANCE'], officer_id: '' }); assert.ok(r.ok, JSON.stringify(r));
  let tok = call('login', { code: 'U006', pin: '1234' }).data.token;
  assert.ok(call('import_templates', { token: tok }).ok);
  r = call('user_save', { token: adminTok, code: 'U006', roles: ['VIEWER'], officer_id: '' }); assert.ok(r.ok, JSON.stringify(r));
  tok = call('login', { code: 'U006', pin: '1234' }).data.token;
  assert.ok(call('dashboard', { token: tok, fy: '2570' }).ok);
  const s = call('calc_summary', { token: tok, fy: '2570' });
  assert.ok(s.ok); assert.strictEqual(s.data.scope_officer, ''); assert.strictEqual(s.data.officers.length, 10); assert.strictEqual(s.data.can_run, false);
  ['notice_search', 'notice_checks', 'import_templates', 'import_history', 'calc_run', 'users_list'].forEach((a) =>
    assert.strictEqual(call(a, { token: tok, q: 'อ', fy: '2570' }).code, 'FORBIDDEN', a));
  assert.strictEqual(call('notice_confirm_amount', { token: tok, notice_uids: ['x'] }).code, 'FORBIDDEN');
});
ok('ไม่มี token / token ปลอม', () => {
  assert.strictEqual(call('dashboard', {}).code, 'SESSION_EXPIRED');
  assert.strictEqual(call('dashboard', { token: 'a'.repeat(64) }).code, 'SESSION_EXPIRED');
});
console.log(`\nผ่านทั้งหมด ${n} ชุดทดสอบ (จำลอง GAS)`);
