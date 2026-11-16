// ทดสอบระยะ 4–5: รอบเบิก 60:40 ตามบัญชีที่เบิก/จ่ายจริง — รัน: node test/payout.test.js
const assert = require('assert');
const { g, call, props } = require('./harness');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('✓', name); };

g.setupSystem(); props.PRINTHUB_DB_ID = 'PH';
const tok = call('login', { code: 'U001', pin: '1234' }).data.token;
const C = (a, d) => { const r = call(a, Object.assign({ token: tok }, d || {})); assert.ok(r.ok, a + ' ' + JSON.stringify(r)); return r.data; };
const offName = (id) => g.officersAll_().filter((o) => o.officer_id === id)[0].name;
const base = { fy: '2570', area_id: '160101', tambon: 'ทะเลชุบศร', amphoe: 'เมืองลพบุรี', issued_date: '2026-11-01', status: 'DELIVERED' };
const N = (id, o) => Object.assign({ notice_uid: id, case_no: id + '/2569', recipient: 'ผู้รับ ' + id, created_at: '2026-11-01' }, base, o);
g.appendRows_('NOTICES', [
  N('T1', { pay_type: 'PAID', officer_id: 'OF01', amount_src: '500', delivered_date: '2026-11-05', reported_date: '2026-11-06', addr_type: 'MOO', moo: '1', house_no: '1', place_key: 'ม.1', area_id: '160102' }),
  N('T2', { pay_type: 'PAID', officer_id: 'OF01', amount_src: '700', delivered_date: '2026-11-10', reported_date: '2026-11-11', addr_type: 'MOO', moo: '1', house_no: '2', place_key: 'ม.1', area_id: '160102' }),
  N('T3', { pay_type: 'PAID', officer_id: 'OF01', amount_src: '600', delivered_date: '', status: 'ISSUED', addr_type: 'MOO', moo: '1', house_no: '3', place_key: 'ม.1', area_id: '160102' }),
  N('T9', { pay_type: 'PAID', officer_id: 'OF01', amount_src: '550', delivered_date: '2026-11-07', reported_date: '2026-11-08', addr_type: 'MOO', moo: '1', house_no: '9', place_key: 'ม.1', area_id: '160102' }),
  // หมายฟรี OF02: อัยการ 2 คดี ที่อยู่เดียวกัน = 1 หมาย 300 (ระบบแบ่ง 150+150 · ศาลลง 300+0)
  N('T4', { pay_type: 'BUDGET', officer_id: 'OF02', delivered_date: '2026-11-05', reported_date: '2026-11-06', addr_type: 'GOV', place_key: 'GOV:สำนักงานอัยการ', house_no: '' }),
  N('T5', { pay_type: 'BUDGET', officer_id: 'OF02', delivered_date: '2026-11-05', reported_date: '2026-11-06', addr_type: 'GOV', place_key: 'GOV:สำนักงานอัยการ', house_no: '' }),
  // ข้อ 7(3): 2 บ้าน หมู่ 4 = 150 + 150
  N('T6', { pay_type: 'BUDGET', officer_id: 'OF02', delivered_date: '2026-11-05', reported_date: '2026-11-06', addr_type: 'MOO', moo: '4', house_no: '10', place_key: 'ม.4' }),
  N('T7', { pay_type: 'BUDGET', officer_id: 'OF02', delivered_date: '2026-11-05', reported_date: '2026-11-06', addr_type: 'MOO', moo: '4', house_no: '11', place_key: 'ม.4' }),
  // หมู่ 9 ลงข้อมูล 9 พ.ย. (หลังวันตัด 8 พ.ย.)
  N('T8', { pay_type: 'BUDGET', officer_id: 'OF02', delivered_date: '2026-11-07', reported_date: '2026-11-09', addr_type: 'MOO', moo: '9', house_no: '5', place_key: 'ม.9' })
]);
C('calc_run');
const NT = () => g.readTable_('NOTICES').rows.reduce((m, r) => (m[r.notice_uid] = r, m), {});

ok('แบ่ง 60:40 ตามใบแบ่งยอดศาล 30 ต.ค. 2569: หมายศาล 1,049 เศษ 40 → หมายเงิน 505 เศษ 0', () => {
  const free = [10050, 10200, 18200, 11500, 12450, 9000, 27900, 7050, 6000, 13600].map((v, i) => ({ officer_id: 'O' + i, budget_c: v * 100 }));
  const f = g.payoutSplit_(free, 48, 'DOWN_BAHT_CARRY', 1200);
  assert.deepStrictEqual([f.total_c, f.pool40_c, f.pool_c, f.per_seat_c, f.carry_out_c], [12595000, 5038000, 5039200, 104900, 4000]);
  const paid = [0, 3200, 4400, 4350, 7750, 7600, 9700, 7350, 9750, 6400].map((v, i) => ({ officer_id: 'O' + i, paid_c: v * 100 }));
  const p = g.payoutSplit_(paid, 48, 'DOWN_BAHT_CARRY', f.carry_out_c);
  assert.deepStrictEqual([p.total_c, p.pool40_c, p.pool_c, p.per_seat_c, p.carry_out_c], [6050000, 2420000, 2424000, 50500, 0]);
  assert.strictEqual(f.lines[0].c40, 402000); assert.strictEqual(f.lines[0].c60, 603000);       // คุณโกมล 10,050 → 4,020 / 6,030
  assert.strictEqual(g.cfg_('ROUNDING_POLICY'), 'DOWN_BAHT_CARRY'); assert.strictEqual(g.cfg_('DEFAULT_SEATS'), '48');
});

ok('จับคู่บัญชีรายเรื่อง: ผู้รับหลายคนในแถวเดียว · หมายเดียวหลายใบเสร็จ · ผิดประเภท', () => {
  const ns = [{ notice_uid: 'a', case_no: 'ก1/2569', recipient: 'นายเอ หนึ่ง จำเลยที่ 1', pay_type: 'PAID' },
              { notice_uid: 'b', case_no: 'ก1/2569', recipient: 'นายบี สอง จำเลยที่ 2', pay_type: 'PAID' },
              { notice_uid: 'c', case_no: 'ก2/2569', recipient: 'นางซี สาม', pay_type: 'BUDGET' }];
  const m = g.ledgerMatch_([{ case_no: 'ก1/2569\nผบ5/2569', recipient: 'นายเอ หนึ่ง จำเลยที่ 1, นายบี สอง จำเลยที่ 2', officer: offName('OF01'), amount: 700 },
                            { case_no: 'ก1/2569', recipient: 'นายเอ หนึ่ง จำเลยที่ 1', officer: offName('OF01'), amount: 100 },
                            { case_no: 'ก2/2569', recipient: 'นางซี สาม', officer: 'ไม่รู้จัก', amount: 500 },
                            { case_no: 'ก9/2569', recipient: 'ใครก็ไม่รู้', officer: offName('OF01'), amount: 500 }], ns, g.officersAll_(), 'PAID');
  assert.deepStrictEqual(m.map((r) => [r.match, r.notice_uids.join(','), r.officer_id]),
    [['OK', 'a,b', 'OF01'], ['OK', 'a', 'OF01'], ['TYPE', '', ''], ['NONE', '', 'OF01']]);
});

ok('นำเข้าไฟล์ 18 (หมายฟรี): ราคาศาลรายเรื่อง → court_amount · เทียบกับระบบ', () => {
  const rows = [['T4', 300], ['T5', 0], ['T6', 150], ['T7', 150], ['T8', 300], ['ZZ', 0]].map(([id, a]) =>
    ({ case_no: id + '/2569\nอ1/2569', recipient: 'ผู้รับ ' + id, officer: offName('OF02'), amount: a, notice_kind: 'หมายนัด', tambon: 'ทะเลชุบศร', result: 'ส่งได้' }));
  const p = C('ledger_import', { kind: 'FREE18', rows: rows, file: { name: '18.xls' } });
  assert.strictEqual(p.summary.ok, 5); assert.strictEqual(p.summary.none, 1);
  assert.deepStrictEqual([p.compare.same, p.compare.court_more, p.compare.court_less], [3, 1, 1]);
  assert.strictEqual(NT().T4.court_amount, '');                                             // ตรวจก่อน ยังไม่บันทึก
  const c = C('ledger_import', { kind: 'FREE18', rows: rows, commit: true, file: { name: '18.xls' } });
  assert.ok(c.batch_id); const t = NT();
  assert.deepStrictEqual(['T4', 'T5', 'T6'].map((k) => t[k].court_amount), ['300', '0', '150']);
  assert.ok(g.cfg_('LAST_FREE18_AT'));
  assert.strictEqual(C('dashboard', { fy: '2570' }).totals.money.ready, 300 + 0 + 150 + 150 + 300 + 500 + 700 + 550);
});

let rf;
ok('รอบหมายฟรี: เสนอตามวันที่ลงข้อมูล · ราคาศาล · เอาออก 1 เรื่อง · แก้เศษยกมา · จำ N', () => {
  const c = C('payout_candidates', { round_type: 'FREE', pay_date: '2026-11-13', cutoff: '2026-11-08' });
  assert.deepStrictEqual(c.items.map((x) => [x.notice_uids[0], x.amount_c, x.src]).sort(),
    [['T4', 30000, 'COURT'], ['T5', 0, 'COURT'], ['T6', 15000, 'COURT'], ['T7', 15000, 'COURT']]);
  assert.strictEqual(c.blocked.late, 1); assert.match(c.items.filter((x) => x.notice_uids[0] === 'T4')[0].diff.text, /^▲ บัญชีศาล 300/);
  assert.strictEqual(c.seats, 48); assert.strictEqual(c.carry_in, 0);
  const t7 = c.items.filter((x) => x.notice_uids[0] === 'T7')[0];
  const r = C('payout_confirm', { round_type: 'FREE', pay_date: '2026-11-13', cutoff: '2026-11-08', seats: 47, excluded: [t7.key],
                                  carry_in: 12, carry_note: 'ยอดยกมาก่อนใช้ระบบ', expect_count: c.items.length });
  rf = r.round.round_id;
  assert.strictEqual(r.round.round_type, 'FREE'); assert.strictEqual(r.round.total, 450); assert.strictEqual(r.round.total_budget, 450);
  assert.strictEqual(r.round.pool40, 180); assert.strictEqual(r.round.carry_in, 12); assert.strictEqual(r.round.per_seat, 4); assert.strictEqual(r.round.carry_out, 4);
  assert.match(r.round.carry_note, /แก้เศษยกมาจาก 0 เป็น 12/); assert.match(r.round.source_label, /ประเภท 18/);
  assert.strictEqual(r.items.filter((x) => !x.included)[0].reason, 'ยังไม่เสนอเบิกจ่าย');
  assert.strictEqual(g.cfg_('DEFAULT_SEATS'), '47');
  const t = NT(); assert.ok(t.T4.payout_round_id === rf && t.T5.payout_round_id === rf && !t.T7.payout_round_id);
  assert.strictEqual(call('payout_confirm', { token: tok, round_type: 'FREE', pay_date: '2026-11-13', cutoff: '2026-11-08', seats: 47, expect_count: c.items.length }).code, 'STALE');
});

ok('นำเข้าบัญชีการจ่ายเงิน: แยกวันที่จ่าย · แถวที่ไม่พบในระบบยังนับเงิน', () => {
  const rows = [{ pay_date: '2026-11-13', case_no: 'T1/2569', recipient: 'ผู้รับ T1', officer: offName('OF01'), amount: 500, receipt_no: '94807/1', received_date: '2026-11-01' },
                { pay_date: '2026-11-13', case_no: 'X9/2569', recipient: 'คนนอกระบบ', officer: offName('OF01'), amount: 800, receipt_no: '94807/2', received_date: '2026-09-20' },
                { pay_date: '2026-11-20', case_no: 'T2/2569', recipient: 'ผู้รับ T2', officer: offName('OF01'), amount: 700, receipt_no: '94807/3', received_date: '2026-11-02' }];
  const p = C('ledger_import', { kind: 'PAY', rows: rows, file: { name: 'pay_sender.xls' } });
  assert.deepStrictEqual(p.dates.map((x) => [x.pay_date, x.rows, x.amount, x.none]), [['2026-11-13', 2, 1300, 1], ['2026-11-20', 1, 700, 0]]);
  const c = C('ledger_import', { kind: 'PAY', rows: rows, commit: true, file: { name: 'pay_sender.xls' } });
  assert.strictEqual(c.imported, 3);
  assert.strictEqual(C('ledger_import', { kind: 'PAY', rows: rows, commit: true }).imported, 3);              // นำเข้าซ้ำ = แทนที่ ไม่ซ้ำ
  assert.strictEqual(g.readTable_('LEDGER').rows.length, 3);
});

let rp;
ok('รอบหมายเงิน: ยอดตามบัญชีจ่าย · เศษยกต่อจากหมายฟรีวันเดียวกัน · หมายที่ส่งแล้วไม่ได้จ่าย', () => {
  const c = C('payout_candidates', { round_type: 'PAID', pay_date: '2026-11-13' });
  assert.deepStrictEqual(c.items.map((x) => [x.case_list, x.amount_c, x.match]), [['T1/2569', 50000, 'OK'], ['X9/2569', 80000, 'NONE']]);
  assert.deepStrictEqual(c.unpaid.map((x) => x.notice_uid), ['T9']);                      // T2 อยู่ในบัญชีวันที่ 20 · T3 ยังไม่ส่ง
  assert.strictEqual(c.carry_in, 4); assert.strictEqual(c.seats, 47);
  assert.deepStrictEqual(c.pending_dates.map((x) => x.pay_date), ['2026-11-13', '2026-11-20']);
  const r = C('payout_confirm', { round_type: 'PAID', pay_date: '2026-11-13', seats: 47, expect_count: c.items.length });
  rp = r.round.round_id;
  assert.strictEqual(r.round.total_paid, 1300); assert.strictEqual(r.round.pool40, 520); assert.strictEqual(r.round.carry_in, 4);
  assert.strictEqual(r.round.per_seat, 11); assert.strictEqual(r.round.carry_out, 7);              // (520+4) ÷ 47 = 11 เศษ 7
  assert.match(r.items.filter((x) => x.case_list === 'X9/2569')[0].reason, /รอยืนยันการจับคู่ทะเบียน/);
  const t = NT(); assert.strictEqual(t.T1.payout_round_id, rp); assert.strictEqual(t.T1.paid_amount, '500');
  assert.ok(g.readTable_('LEDGER').rows.filter((l) => l.pay_date === '2026-11-13').every((l) => l.round_id === rp));
  assert.strictEqual(C('dashboard', { fy: '2570' }).totals.money.paid, 450 + 500);
});

ok('ลำดับรอบ: ตั้งย้อนหลังก่อนรอบล่าสุดไม่ได้ · นำเข้าซ้ำไม่แตะวันที่ตั้งรอบแล้ว', () => {
  const x = call('payout_confirm', { token: tok, round_type: 'FREE', pay_date: '2026-11-10', cutoff: '2026-11-08', seats: 47 });
  assert.strictEqual(x.code, 'BAD_REQUEST'); assert.match(x.msg, /ต่อจากรอบล่าสุด/);
  const rows = [{ pay_date: '2026-11-13', case_no: 'T1/2569', recipient: 'ผู้รับ T1', officer: offName('OF01'), amount: 999 },
                { pay_date: '2026-11-20', case_no: 'T2/2569', recipient: 'ผู้รับ T2', officer: offName('OF01'), amount: 750, receipt_no:'94807/3', received_date:'2026-11-02' }];
  const c = C('ledger_import', { kind: 'PAY', rows: rows, commit: true });
  assert.strictEqual(c.skipped_locked, 1); assert.strictEqual(c.imported, 1);
  const L = g.readTable_('LEDGER').rows;
  assert.strictEqual(L.filter((l) => l.pay_date === '2026-11-13').length, 2);
  assert.deepStrictEqual(L.filter((l) => l.pay_date === '2026-11-20').map((l) => l.amount), ['750']);
  const lst = C('payout_list');
  assert.deepStrictEqual(lst.pending_dates.map((x) => x.pay_date), ['2026-11-20']);
  assert.strictEqual(lst.last_free.round_id, rf); assert.ok(lst.free18_at);
});

ok('ค้างเบิก: หมายฟรีที่เอาออก + หมายเงินที่ไม่ได้จ่าย · ผู้ดูแลปิด "ไม่เบิก" และเปิดคืนได้', () => {
  let b = C('payout_backlog');
  assert.deepStrictEqual(b.items.map((x) => [x.notice_uid, x.type]).sort(), [['T7', 'BUDGET'], ['T8', 'BUDGET'], ['T9', 'PAID']].sort());
  assert.ok(b.items.filter((x) => x.notice_uid === 'T7')[0].held);
  assert.strictEqual(call('payout_noclaim', { token: tok, notice_uids: ['T9'] }).code, 'BAD_REQUEST');       // ต้องมีเหตุผล
  assert.strictEqual(C('payout_noclaim', { notice_uids: ['T9'], reason: 'ส่งซ้ำกับหมายเดิม' }).updated, 1);
  b = C('payout_backlog');
  assert.ok(!b.items.some((x) => x.notice_uid === 'T9')); assert.strictEqual(b.closed[0].reason, 'ส่งซ้ำกับหมายเดิม');
  assert.strictEqual(C('payout_list').closed_n, 1);
  assert.ok(!C('payout_candidates', { round_type: 'PAID', pay_date: '2026-11-20' }).unpaid.some((x) => x.notice_uid === 'T9'));
  C('payout_noclaim', { notice_uids: ['T9'], undo: true });
  assert.ok(C('payout_backlog').items.some((x) => x.notice_uid === 'T9'));
});

ok('ยกเลิกรอบล่าสุด: ปลดหมายและบัญชีจ่าย · จากนั้นยกเลิกรอบก่อนหน้าได้', () => {
  assert.strictEqual(call('payout_cancel', { token: tok, round_id: rf, reason: 'x' }).code, 'BAD_REQUEST');
  assert.strictEqual(C('payout_cancel', { round_id: rp, reason: 'นำเข้าไฟล์ผิดวัน' }).released, 1);
  const t = NT(); assert.strictEqual(t.T1.payout_round_id, ''); assert.strictEqual(t.T1.paid_amount, '');
  assert.ok(g.readTable_('LEDGER').rows.every((l) => !l.round_id));
  assert.strictEqual(C('payout_candidates', { round_type: 'PAID', pay_date: '2026-11-13' }).carry_in, 4);
  assert.strictEqual(C('payout_cancel', { round_id: rf, reason: 'ทดสอบ' }).released, 3);
  assert.strictEqual(C('payout_candidates', { round_type: 'FREE', pay_date: '2026-11-13', cutoff: '2026-11-30' }).items.length, 5);
});

ok('สิทธิ์: ไอดีดูสถิติเห็นรายการรอบ แต่ไม่เห็นเลขคดี/ค้างเบิก · ตั้งรอบและนำเข้าไม่ได้', () => {
  const c = C('payout_candidates', { round_type: 'FREE', pay_date: '2026-11-13', cutoff: '2026-11-30' });
  const r = C('payout_confirm', { round_type: 'FREE', pay_date: '2026-11-13', cutoff: '2026-11-30', seats: 48, expect_count: c.items.length });
  const u = call('user_save', { token: tok, code: 'U006', roles: ['VIEWER'], officer_id: '' }); assert.ok(u.ok, JSON.stringify(u));
  const vt = call('login', { code: 'U006', pin: '1234' }).data.token;
  const gget = call('payout_get', { token: vt, round_id: r.round.round_id }); assert.ok(gget.ok); assert.strictEqual(gget.data.items.length, 0);
  assert.ok(call('payout_list', { token: vt }).ok);
  ['payout_candidates', 'payout_confirm', 'payout_backlog', 'payout_noclaim', 'ledger_import'].forEach((a) =>
    assert.strictEqual(call(a, { token: vt, round_type: 'FREE', kind: 'PAY', rows: [{}], notice_uids: ['T9'], reason: 'x', seats: 5 }).code, 'FORBIDDEN', a));
});

ok('0.6.3 ไฟล์ 18: ผู้รับเดียวหลายฉบับ → ราคาศาลลงฉบับที่ตำบลตรงกัน', () => {
  const ns = [{ notice_uid: 'X1', case_no: 'มฝ22/2569', recipient: 'นายเอ', pay_type: 'BUDGET', tambon: 'ทะเลชุบศร', notice_kind: 'หมายเรียก สำเนาคำร้อง' },
              { notice_uid: 'X2', case_no: 'มฝ22/2569', recipient: 'นายเอ', pay_type: 'BUDGET', tambon: 'ท่าศาลา', notice_kind: 'หมายเรียก สำเนาคำร้อง' }];
  const m = g.ledgerMatch_([{ case_no: 'มฝ22/2569', recipient: 'นายเอ', tambon: 'ท่าศาลา', notice_kind: 'หมายเรียก', amount: 300 },
                            { case_no: 'มฝ22/2569', recipient: 'นายเอ', tambon: 'ทะเลชุบศร', notice_kind: 'หมายเรียก', amount: 0 }], ns, g.officersAll_(), 'BUDGET');
  assert.deepStrictEqual(m.map((r) => r.notice_uids[0]), ['X2', 'X1']);
});

ok('0.6.4 ข้อ 7: บัญชีศาลให้ราคาเต็มซ้ำในหน่วยที่รวมเป็น 1 หมาย → เบิกครั้งเดียว · นับฉบับที่เบิกไปแล้วด้วย', () => {
  const B = { pay_type: 'BUDGET', officer_id: 'OF02', calc_rule: 'ONE_SAME', budget_unit_id: 'BU-X', delivered_date: '2026-10-08', reported_date: '2026-10-08', court_at: '2026-11-13T14:03' };
  const ns = [Object.assign({ notice_uid: 'A', case_no: 'อ39/2569', calc_amount: '400', court_amount: '800' }, B),
              Object.assign({ notice_uid: 'B', case_no: 'ผบE1140/2566', calc_amount: '400', court_amount: '800' }, B),
              Object.assign({ notice_uid: 'C', case_no: 'ต1/2569', calc_amount: '300', court_amount: '300' }, B, { budget_unit_id: 'BU-Y', calc_rule: 'SINGLE' })];
  let it = g.payoutFreeItems_(ns, { cutoff: '2026-10-30' }).items;
  const am = (k) => it.find((x) => x.key === 'N:' + k).amount_c;
  assert.deepStrictEqual([am('A'), am('B'), am('C')], [80000, 0, 30000]);
  assert.ok(/ข้อ 7/.test(it.find((x) => x.key === 'N:B').diff.text));
  // ฉบับ A เบิกไปแล้วในรอบก่อน → ฉบับ B เหลือ 0
  ns[0].payout_round_id = 'PR-OLD';
  it = g.payoutFreeItems_(ns, { cutoff: '2026-10-30' }).items;
  assert.strictEqual(am('B'), 0);
  // ศาลให้ราคาฉบับเดียว (อีกฉบับ 0) → ไม่แตะ
  ns[0].payout_round_id = ''; ns[1].court_amount = '0';
  it = g.payoutFreeItems_(ns, { cutoff: '2026-10-30' }).items;
  assert.deepStrictEqual([am('A'), am('B')], [80000, 0]); assert.ok(!it.find((x) => x.key === 'N:A').rule7);
});

console.log('\nผ่านทั้งหมด ' + n + ' ชุดทดสอบ (รอบเบิก 60:40)');
