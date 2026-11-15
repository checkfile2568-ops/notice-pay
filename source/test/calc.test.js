// ทดสอบการคำนวณค่าหมาย (ระยะ 3) — รัน: node test/calc.test.js
const assert = require('assert');
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas/ImportFormats.gs'), 'utf8'), ctx);
['Core.gs', 'Calc.gs'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas', f), 'utf8'), ctx));
let n = 0; const t = (name, fn) => { fn(); n++; console.log('✓', name); };

const opt = { areaRate: { '160101': 500, '160605': 800, '161105': 1000 }, budgetRate: { '1601': 300 }, mode: 'HALF', fyStartMonth: 10 };
let seq = 0;
const N = (o) => Object.assign({ notice_uid: 'N' + (++seq), pay_type: 'BUDGET', case_no: 'C' + seq, house_no: String(seq), moo: '1',
  place_key: '', addr_type: 'MOO', area_id: '160101', officer_id: 'OF01', delivered_date: '2026-11-05', amount_src: '0' }, o);
const run = (list, o) => ctx.calcCompute_(list, Object.assign({}, opt, o || {}));
const total = (r) => r.units.reduce((s, u) => s + Number(u.amount), 0);
const sumNotices = (r) => Object.values(r.byNotice).reduce((s, x) => s + (Number(x.calc_amount) || 0), 0);

t('คดีเดียว ผู้รับ 3 คน หมู่เดียวกัน (ต่างบ้าน) = 1 หมาย 300', () => {
  const r = run([N({ case_no: '121/2569', moo: '2' }), N({ case_no: '121/2569', moo: '2' }), N({ case_no: '121/2569', moo: '2' })]);
  assert.strictEqual(total(r), 300); assert.strictEqual(r.units[0].rule_code, 'ONE_SAME'); assert.strictEqual(sumNotices(r), 300);
});
t('3 คดี บ้านเลขที่เดียวกัน = 300', () => {
  const r = run(['121', '122', '123'].map((c) => N({ case_no: c + '/2569', house_no: '9/1', moo: '4' })));
  assert.strictEqual(total(r), 300);
});
t('2 คดี คนละบ้าน หมู่เดียวกัน = 150 + 150', () => {
  const r = run([N({ moo: '9' }), N({ moo: '9' })]);
  assert.strictEqual(total(r), 300); assert.strictEqual(r.units[0].rule_code, 'HALF');
  assert.deepStrictEqual(Object.values(r.byNotice).map((x) => x.calc_amount), ['150', '150']);
});
t('3 คดี คนละบ้าน หมู่ 3 = 450', () => assert.strictEqual(total(run([N({ moo: '3' }), N({ moo: '3' }), N({ moo: '3' })])), 450));
t('หมู่ 1 + หมู่ 2 อย่างละ 1 = 600', () => assert.strictEqual(total(run([N({ moo: '1' }), N({ moo: '2' })])), 600));
t('บ้านหมี่ ต.บ้านชี (800) 2 คดี คนละบ้าน หมู่เดียวกัน = 800', () => assert.strictEqual(total(run([N({ area_id: '160605' }), N({ area_id: '160605' })])), 800));
t('อำเภออื่นใช้อัตราตำบล (หนองม่วง ยางโทน 1,000) · อ.เมือง 300 ไม่ใช่อัตราตำบล 500', () => {
  assert.strictEqual(total(run([N({ area_id: '161105' })])), 1000);
  assert.strictEqual(total(run([N({ area_id: '160101' })])), 300);
});
t('ตั้งค่า ONE: หลายคดีต่างบ้าน หมู่เดียวกัน = 1 หมาย (แบ่งรายฉบับรวมได้ตรง)', () => {
  const r = run([N(), N(), N()], { mode: 'ONE' });
  assert.strictEqual(total(r), 300); assert.strictEqual(sumNotices(r), 300); assert.strictEqual(r.units[0].rule_code, 'ONE_MOO');
});
t('เขตเมืองไม่มีหมู่ ต่างถนน ตำบลเดียวกัน วันเดียวกัน = กึ่งหนึ่ง 150 + 150 (ตามบัญชีของศาล)', () => {
  const U = (pk, h) => N({ moo: '', addr_type: 'URBAN', place_key: pk, house_no: h });
  const r = run([U('ถ.สุระสงคราม', '10'), U('ถ.ราชดำเนิน', '22')]);
  assert.strictEqual(total(r), 300); assert.strictEqual(r.units[0].rule_code, 'HALF');
  assert.deepStrictEqual(Object.values(r.byNotice).map((x) => x.calc_amount), ['150', '150']);
  // บ้านเลขที่ซ้ำแต่คนละถนน = คนละบ้าน
  assert.strictEqual(total(run([U('ถ.ก', '5'), U('ถ.ข', '5')])), 300);
  // บ้านเดียวกัน ถนนเดียวกัน หลายคดี = 1 หมาย
  assert.strictEqual(total(run([U('ถ.ก', '5'), U('ถ.ก', '5')])), 300);
  // ตั้งค่า ROAD: แยกตามถนน = 300 + 300
  assert.strictEqual(total(run([U('ถ.สุระสงคราม', '10'), U('ถ.ราชดำเนิน', '22')], { urbanGroup: 'ROAD' })), 600);
});
t('หน่วยงานราชการเดียวกัน หลายคดี = 1 หมาย · ต่างหน่วยงาน แยกกัน', () => {
  const g = (pk) => N({ moo: '', house_no: '', place_key: pk, addr_type: 'GOV' });
  const r = run([g('GOV:สำนักงานอัยการจังหวัดลพบุรี'), g('GOV:สำนักงานอัยการจังหวัดลพบุรี'), g('GOV:สำนักงานอัยการจังหวัดลพบุรี'), g('GOV:88')]);
  assert.strictEqual(r.units.length, 2); assert.strictEqual(total(r), 600);
});
t('เขตเมือง: ถนนเดียวกัน ต่างบ้าน = กึ่งหนึ่ง', () => {
  const r = run([N({ moo: '', place_key: 'ถ.สุระสงคราม', addr_type: 'URBAN', house_no: '150' }), N({ moo: '', place_key: 'ถ.สุระสงคราม', addr_type: 'URBAN', house_no: '24/9' })]);
  assert.strictEqual(total(r), 300); assert.strictEqual(r.units[0].rule_code, 'HALF');
});
t('ไม่มีที่อยู่ → นับแยกฉบับเต็มอัตรา + แจ้งเตือน', () => {
  const r = run([N({ moo: '', house_no: '', addr_type: 'NONE' }), N({ moo: '', house_no: '', addr_type: 'NONE' })]);
  assert.strictEqual(total(r), 600); assert.ok(r.warnings.some((w) => w.type === 'NO_ADDRESS'));
});
t('ต่างวันส่ง หรือต่างผู้ส่ง = คนละคราว', () => {
  assert.strictEqual(total(run([N({ delivered_date: '2026-11-05' }), N({ delivered_date: '2026-11-06' })])), 600);
  const r = run([N({ officer_id: 'OF01' }), N({ officer_id: 'OF02' })]);
  assert.strictEqual(total(r), 600); assert.ok(r.warnings.some((w) => w.type === 'CROSS_OFFICER'));
});
t('ยังไม่มีวันที่ส่ง → รอ ไม่คิดเงิน · หมายมีเงิน = ราคาในไฟล์', () => {
  const r = run([N({ delivered_date: '' }), N({ pay_type: 'PAID', amount_src: '650' })]);
  const v = Object.values(r.byNotice);
  assert.strictEqual(v[0].calc_rule, 'WAIT_DELIVERY'); assert.strictEqual(v[0].calc_amount, '');
  assert.strictEqual(v[1].calc_rule, 'PAID'); assert.strictEqual(v[1].calc_amount, '650'); assert.strictEqual(r.units.length, 0);
});
t('คำนวณซ้ำได้ผลเดิม (รหัสหน่วยเบิกคงที่)', () => {
  const list = [N({ moo: '7' }), N({ moo: '7' })];
  assert.strictEqual(run(list).units[0].unit_id, run(list).units[0].unit_id);
  assert.match(run(list).units[0].unit_id, /^BU-2570-[0-9A-F]{8}$/);
});
t('หน่วยเบิกที่ล็อกแล้ว: หมายเดิมไม่ถูกแตะ · หมายมาทีหลังคราวเดียวกัน → รอตรวจ', () => {
  const a = N({ moo: '5' }), b = N({ moo: '5' });
  const first = run([a, b]); const uid = first.units[0].unit_id;
  const c = N({ moo: '5' });
  const r = run([a, b, c], { locked: { [uid]: { notice_uids: [a.notice_uid, b.notice_uid] } } });
  assert.ok(!r.byNotice[a.notice_uid]); assert.strictEqual(r.byNotice[c.notice_uid].calc_rule, 'REVIEW_LATE');
  assert.strictEqual(r.units.length, 0); assert.ok(r.warnings.some((w) => w.type === 'LATE'));
});
t('ก่อนเริ่มปีงบ: หมายฟรีที่จ่ายก่อน 1 ต.ค. ไม่นับ · หมายมีเงินนับตามวันที่ส่ง', () => {
  const o = { startFy: '2570', startDate: '2026-10-01' };
  const r = run([N({ issued_date: '2026-09-25', delivered_date: '2026-10-02', fy: '2570' }),          // หมายฟรี จ่าย ก.ย. → ไม่นับ
                 N({ issued_date: '2026-10-01', delivered_date: '2026-10-02', fy: '2570' }),          // หมายฟรี จ่าย ต.ค. → นับ
                 N({ pay_type: 'PAID', amount_src: '700', issued_date: '2026-09-25', delivered_date: '2026-10-03', fy: '2570' }),  // มีเงิน ส่ง ต.ค. → นับ
                 N({ pay_type: 'PAID', amount_src: '650', delivered_date: '', fy: '2569' })], o);     // มีเงิน จ่าย ก.ย. ยังไม่มีวันส่ง → ยังไม่นับ
  const ids = Object.keys(r.byNotice).sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
  assert.deepStrictEqual(ids.map((k) => r.byNotice[k].calc_rule), ['PRE_START', 'SINGLE', 'PAID', 'PRE_START']);
  assert.strictEqual(total(r), 300); assert.strictEqual(r.units.length, 1);
});
t('ไฟล์ 50 คร่อมวันเริ่ม: ยังไม่มีวันที่จ่าย → รอยืนยัน ไม่คิดเงิน · มีวันที่จ่ายแล้ว → ใช้กฎปกติ', () => {
  const o = { startFy: '2570', startDate: '2026-10-01' };
  const F = ctx.FLAG_DATE_UNSURE;
  const r = run([N({ flags: F, issued_date: '', delivered_date: '', fy: '2570' }),                       // ยังไม่มีไฟล์ 42
                 N({ flags: F, issued_date: '2026-09-20', delivered_date: '2026-10-03', fy: '2570' }),   // หมายฟรีจ่าย ก.ย. → ไม่นับ
                 N({ flags: F, issued_date: '2026-10-02', delivered_date: '2026-10-03', fy: '2570', moo: '7' }),  // หมายฟรีจ่าย ต.ค. → นับ
                 N({ flags: F, pay_type: 'PAID', amount_src: '700', issued_date: '', delivered_date: '', fy: '2570' })], o);
  const ids = Object.keys(r.byNotice).sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
  assert.deepStrictEqual(ids.map((k) => r.byNotice[k].calc_rule), ['WAIT_ISSUE_DATE', 'PRE_START', 'SINGLE', 'WAIT_ISSUE_DATE']);
  assert.strictEqual(total(r), 300);
});

t('หมายมีเงินราคาไม่เท่าอัตราตำบล: คิดตามอัตราตำบล ▲ เกิน (ไม่นำมาคิด) / ▼ ต่ำกว่า (ปรับขึ้น) · เข้ารอบแล้วไม่คำนวณทับ', () => {
  const F = 'เงินไม่เท่ากับอัตราของตำบล';
  const up = N({ pay_type: 'PAID', amount_src: '650', rate_ref: '550', flags: F });
  const dn = N({ pay_type: 'PAID', amount_src: '700', rate_ref: '750', flags: F });
  const eq = N({ pay_type: 'PAID', amount_src: '600', rate_ref: '600' });
  const lock = N({ pay_type: 'PAID', amount_src: '650', rate_ref: '500', flags: F, payout_round_id: 'PR-1' });
  const r = run([up, dn, eq, lock]);
  assert.strictEqual(r.byNotice[up.notice_uid].calc_amount, '550'); assert.match(r.byNotice[up.notice_uid].calc_note, /^▲ ราคาไฟล์ 650 เกินอัตราตำบล 550 อยู่ 100 บาท/);
  assert.strictEqual(r.byNotice[dn.notice_uid].calc_amount, '750'); assert.match(r.byNotice[dn.notice_uid].calc_note, /^▼ ราคาไฟล์ 700 ต่ำกว่าอัตราตำบล 750 อยู่ 50 บาท/);
  assert.strictEqual(r.byNotice[eq.notice_uid].calc_amount, '600'); assert.strictEqual(r.byNotice[eq.notice_uid].calc_note, '');
  assert.strictEqual(r.byNotice[lock.notice_uid], undefined);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.amountAdj_(up))), { src: 650, rate: 550, diff: 100, dir: 'UP' });
  assert.strictEqual(ctx.amountAdj_(Object.assign({}, up, { rate_ref: '' })), null);              // ไม่พบอัตรา → ใช้ราคาไฟล์
  assert.strictEqual(ctx.amountRed_(up), false);
});

t('หมายฟรีไม่เกินอัตราสูงสุด (FREE_MAX_RATE 1,000): ตำบลอัตรา 1,300 คิด 1,000 · กึ่งหนึ่ง 500', () => {
  const o = { areaRate: { '160605': 1300 }, freeMax: 1000 };
  const r = run([N({ area_id: '160605', moo: '3' })], o);
  assert.strictEqual(total(r), 1000);
  assert.strictEqual(total(run([N({ area_id: '160605', moo: '5', case_no: 'A1' }), N({ area_id: '160605', moo: '5', case_no: 'A2' })], o)), 1000);
  assert.strictEqual(total(run([N({ area_id: '160605', moo: '3' })], { areaRate: { '160605': 1300 } })), 1300);   // ไม่ตั้ง = ไม่จำกัด
  assert.strictEqual(total(run([N({ area_id: '160605', moo: '3' })], { areaRate: { '160605': 800 }, freeMax: 1000 })), 800);
});

console.log(`\nผ่านทั้งหมด ${n} ชุดทดสอบ (คำนวณค่าหมาย)`);
