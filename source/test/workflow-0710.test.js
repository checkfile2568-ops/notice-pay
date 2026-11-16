// 0.7.10 ข้อมูลสมมติเท่านั้น: ประวัติรอบ · หลักฐานจ่าย · บัญชีจ่ายไม่มีรอบ · ยอดคงค้างหมายฟรี · กฎข้ามปีงบ
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const { g, call, props } = require('./harness');
let count = 0; const t = (name, fn) => { fn(); count++; console.log('✓', name); };
g.setupSystem(); props.PRINTHUB_DB_ID = 'PH';
const auth = call('login', { code: 'U001', pin: '1234' }).data, token = auth.token;
const C = (a, d) => { const r = call(a, Object.assign({ token }, d || {})); assert.ok(r.ok, a + ' ' + JSON.stringify(r)); return r.data; };
const today = g.Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd'), fy = String(g.currentFy_());
const fyStart = (Number(fy) - 544) + '-10-01';
const base = { fy, area_id: '160101', tambon: 'ทะเลชุบศร', amphoe: 'เมืองลพบุรี', issued_date: fyStart, status: 'DELIVERED', delivered_date: fyStart, reported_date: fyStart, officer_id: 'OF01' };
const N = (id, o) => Object.assign({ notice_uid: id, case_no: id + '/2569', recipient: 'R1-' + id }, base, o);

// หมายในรอบยืนยันแล้วแต่ช่องรอบในทะเบียนว่าง (เหมือนข้อมูลจริง 34 ฉบับ) + หมายพร้อมเบิกปกติ
g.appendRows_('NOTICES', [
  N('H-PAID', { pay_type: 'PAID', calc_amount: '500', calc_rule: 'PAID', amount_src: '500' }),             // ยอดอ้างอิง 500 แต่จ่ายจริง 600
  N('H-FREE', { pay_type: 'BUDGET', calc_amount: '300', calc_rule: 'REVIEW_LATE' }),                        // เข้ารอบแล้วแต่กฎเป็นรอตรวจ
  N('F-READY', { pay_type: 'BUDGET', calc_amount: '300', calc_rule: 'SINGLE', moo: '3', house_no: '9', place_key: 'ม.3', addr_type: 'MOO' })
]);
g.appendRows_('PAYOUT_ROUNDS', [
  { round_id: 'R-P', fy, pay_date: fyStart, status: 'CONFIRMED', round_type: 'PAID', total: '600', lines_json: JSON.stringify([{ officer_id: 'OF01', paid_c: 60000, budget_c: 0, c60: 36000, c40: 24000 }]) },
  { round_id: 'R-F', fy, pay_date: fyStart, status: 'CONFIRMED', round_type: 'FREE', total: '300', lines_json: JSON.stringify([{ officer_id: 'OF01', paid_c: 0, budget_c: 30000, c60: 18000, c40: 12000 }]) }
]);
g.appendRows_('PAYOUT_ITEMS', [
  { round_id: 'R-P', item_key: 'L:1', item_type: 'PAID', officer_id: 'OF01', amount: '600', notice_uids: 'H-PAID', included: true },
  { round_id: 'R-F', item_key: 'N:H-FREE', item_type: 'BUDGET', officer_id: 'OF01', amount: '300', notice_uids: 'H-FREE', included: true }
]);

t('หมายมีประวัติรอบแต่ช่องรอบว่าง: ทุกหน้าใช้ยอดเดิมในรอบ และไม่จัดเป็นรอตรวจ', () => {
  const tr = C('tracking', { fy }).rows, hp = tr.find(r => r.notice_uid === 'H-PAID'), hf = tr.find(r => r.notice_uid === 'H-FREE');
  assert.equal(hp.status, 'ROUND'); assert.equal(hp.amount, 600); assert.equal(hp.round_id, 'R-P'); assert.equal(hp.difference, 100);
  assert.equal(hf.status, 'ROUND'); assert.equal(hf.amount, 300);
  const dash = C('dashboard', { fy }), o = dash.officers.find(x => x.officer_id === 'OF01');
  assert.equal(o.money.check, 0, 'หมายที่เข้ารอบแล้วต้องไม่อยู่ในรอตรวจ');
  assert.equal(o.money.paid, 900);
  const s = C('notice_search', { q: 'H-FREE' }).rows[0]; assert.equal(s.money_status, 'paid'); assert.equal(s.payout_round_id, 'R-F');
});

t('ไม่เสนอเบิกซ้ำ ไม่คำนวณทับ และรายงานคงค้างไม่นับหมายที่เข้ารอบแล้ว', () => {
  const cand = C('payout_candidates', { round_type: 'FREE', pay_date: today, cutoff: today });
  assert.ok(!cand.items.some(i => i.notice_uids.includes('H-FREE')));
  assert.ok(cand.items.some(i => i.notice_uids.includes('F-READY')));
  const before = g.readTable_('NOTICES').rows.find(r => r.notice_uid === 'H-PAID').calc_amount;
  C('calc_run');
  const after = g.readTable_('NOTICES').rows.find(r => r.notice_uid === 'H-PAID');
  assert.equal(String(after.calc_amount), String(before)); assert.equal(after.payout_round_id, '', 'ไม่เขียนช่องรอบเองระหว่างคำนวณ');
  const co = C('reports', { report_mode: 'closeout', fy });
  assert.ok(!co.rows.some(r => r.notice_uid === 'H-FREE')); assert.equal(co.totals.excluded_claimed, 1);
  const bl = C('payout_backlog', {}); assert.ok(!bl.items.some(i => i.notice_uid === 'H-PAID' || i.notice_uid === 'H-FREE'));
});

t('ทะเบียนหมายฟรีแสดงยอดคงค้างแบบเดียวกับหน้าการเงิน แยกจากยอดทะเบียนที่รวมรายการเบิกแล้ว', () => {
  const tr = C('tracking', { fy, pay_type: 'BUDGET' }), co = C('reports', { report_mode: 'closeout', fy });
  assert.ok(tr.budget_pending);
  assert.equal(tr.budget_pending.ready_n, co.totals.ready_n); assert.equal(tr.budget_pending.ready_amount, co.totals.ready_amount);
  assert.equal(tr.budget_pending.wait_n, co.totals.wait_n); assert.equal(tr.budget_pending.excluded_claimed, 1);
  assert.equal(tr.totals.amount, 600, 'ยอดทะเบียนรวมรายการที่เบิกแล้ว'); assert.equal(tr.budget_pending.ready_amount, 300);
  assert.equal(tr.totals.status_amount.ROUND, 300); assert.equal(tr.totals.status_amount.READY, 300);
  assert.equal(C('tracking', { fy, pay_type: 'PAID' }).budget_pending, null);
});

t('บัญชีจ่ายวันที่ไม่มีรอบแบ่ง แสดงชัดพร้อมจำนวนที่จับคู่ทะเบียนไม่ได้', () => {
  const d = fyStart.slice(0, 8) + '02';
  g.appendRows_('LEDGER', [
    { ledger_id: 'LG1', source: 'PAY', pay_date: d, officer_id: 'OF01', case_no: 'X1/2569', amount: '650', match: 'NONE', round_id: '' },
    { ledger_id: 'LG2', source: 'PAY', pay_date: d, officer_id: 'OF01', case_no: 'X2/2569', amount: '700', match: 'OK', notice_uids: 'H-PAID', round_id: '' },
    { ledger_id: 'LG3', source: 'PAY', pay_date: fyStart, officer_id: 'OF01', case_no: 'H-PAID/2569', amount: '600', match: 'OK', round_id: 'R-P' }
  ]);
  const by = C('reports', { fy }).ledger_summary.by_date, x = by.find(b => b.pay_date === d), y = by.find(b => b.pay_date === fyStart);
  assert.equal(x.state, 'NO_ROUND'); assert.equal(x.state_th, 'มีบัญชีจ่ายแล้ว แต่ยังไม่มีรอบแบ่งในระบบ');
  assert.equal(x.rows, 2); assert.equal(x.amount, 1350); assert.equal(x.unmatched_n, 1); assert.equal(x.no_round_amount, 1350);
  assert.equal(y.state, 'IN_ROUND'); assert.deepEqual(y.round_ids, ['R-P']);
});

t('สรุปค่าตอบแทน: รอบที่ช่องจ่ายว่างนับเป็น "ยังไม่บันทึก" และบันทึกจ่ายหลายรอบได้โดยไม่เปลี่ยนยอด', () => {
  const tables = () => JSON.stringify(g.readTable_('PAYOUT_ROUNDS').rows.map(r => [r.round_id, r.total, r.lines_json, r.carry_out, r.per_seat]));
  const keep = tables();
  let c = C('compensation_summary', { fy });
  assert.equal(c.unrecorded_rounds, 2); assert.equal(c.can_payment, true); assert.equal(c.totals.pending60, 540); assert.equal(c.totals.paid60, 0);
  const courier = g.apiCompensationSummary_({ user: { roles: ['COURIER'], officer_id: 'OF01' } }, { fy }); assert.equal(courier.can_payment, false);
  assert.equal(call('round_payment_bulk', { token, round_ids: ['R-P'], payment_ref: '' , use_pay_date: true }).code, 'BAD_REQUEST');
  C('user_save', {code:'U006',roles:['COURIER'],officer_id:'OF01'});
  const courierToken=call('login',{code:'U006',pin:'1234'}).data.token;
  const roundsBeforeDenied=JSON.stringify(g.readTable_('PAYOUT_ROUNDS').rows), opsBeforeDenied=g.readTable_('OPERATIONS').rows.length;
  assert.equal(call('round_payment_bulk',{token:courierToken,round_ids:['R-P'],payment_ref:'DENIED',use_pay_date:true}).code,'FORBIDDEN');
  assert.equal(call('round_payment_bulk',{round_ids:['R-P'],payment_ref:'ANONYMOUS',use_pay_date:true}).ok,false);
  assert.equal(JSON.stringify(g.readTable_('PAYOUT_ROUNDS').rows),roundsBeforeDenied);
  assert.equal(g.readTable_('OPERATIONS').rows.length,opsBeforeDenied,'Denied requests must not create a journal');

  const r = C('round_payment_bulk', { round_ids: ['R-P', 'R-F', 'NOPE'], payment_ref: 'ใบแบ่งยอดศาล', use_pay_date: true, request_id: 'bulk-pay-0710-a' });
  assert.equal(r.updated, 2); assert.deepEqual(r.skipped, ['NOPE']);
  c = C('compensation_summary', { fy }); assert.equal(c.unrecorded_rounds, 0); assert.equal(c.totals.paid60, 540); assert.equal(c.totals.pending60, 0);
  assert.equal(c.rounds.find(x => x.round_id === 'R-P').payment_date, fyStart);
  assert.equal(tables(), keep, 'ยอด รายการ และเศษของรอบต้องคงเดิม');
  const again = C('round_payment_bulk', { round_ids: ['R-P'], payment_ref: 'ซ้ำ', use_pay_date: true, request_id: 'bulk-pay-0710-b' });
  assert.equal(again.updated, 0); assert.deepEqual(again.skipped, ['R-P']);
  assert.equal(C('tracking', { fy }).rows.find(x => x.notice_uid === 'H-PAID').status, 'PAID');
});

t('ตรวจฐานจริงแบบอ่านอย่างเดียวรันได้และไม่เปลี่ยนข้อมูล', () => {
  const logs = [], orig = g.console.log; g.console = Object.assign({}, console, { log: (x) => logs.push(x) });
  try { g.verify0710ReadOnly(); } finally { g.console = console; }
  const o = JSON.parse(logs.at(-1)); assert.equal(o.verification, '0.7.10'); assert.equal(o.unchanged, true);
  assert.equal(o.round_links_from_history, 2); assert.equal(o.amount_changed_by_history, 1); assert.equal(o.amount_delta, 100); assert.equal(o.dashboard_check, 0);
});

// ---- กฎข้ามปีงบ (ฟังก์ชันล้วน) ----
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas/ImportFormats.gs'), 'utf8'), ctx);
['Core.gs', 'Calc.gs'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas', f), 'utf8'), ctx));
const opt = { areaRate: { '160101': 500 }, budgetRate: { '1601': 300 }, mode: 'HALF', fyStartMonth: 10, startFy: '2570', startDate: '2026-10-01' };
const X = (o) => Object.assign({ pay_type: 'PAID', amount_src: '700', area_id: '160101', officer_id: 'OF01', fy: '2570', flags: ctx.FLAG_DATE_UNSURE, issued_date: '' }, o);

t('หมายมีเงินที่วันที่จ่ายหมายไม่แน่ชัด นับตามวันที่ส่ง ไม่ถูกตัดเพราะยืนยัน ก.ย.', () => {
  const r = ctx.calcCompute_([
    X({ notice_uid: 'A', date_ok: 'BEFORE', delivered_date: '2026-10-05' }),     // ยืนยัน ก.ย. แต่ส่ง ต.ค. → นับ
    X({ notice_uid: 'B', date_ok: 'BEFORE', delivered_date: '' }),               // ยืนยัน ก.ย. ยังไม่มีวันที่ส่ง → ก่อนเริ่มปีงบ ไม่นับ
    X({ notice_uid: 'C', date_ok: '', delivered_date: '2026-10-07' }),           // ไม่ได้ยืนยัน แต่ส่ง ต.ค. → นับ
    X({ notice_uid: 'D', date_ok: 'AFTER', delivered_date: '2026-09-28', fy: '2569' }),  // ส่งก่อนเริ่มปีงบ → ไม่นับ
    X({ notice_uid: 'E', date_ok: '', delivered_date: '' }),                     // ยังไม่รู้ทั้งวันจ่ายและวันส่ง → รอยืนยัน (เดิม)
    X({ notice_uid: 'F', pay_type: 'BUDGET', amount_src: '0', date_ok: 'BEFORE', delivered_date: '2026-10-05' })   // หมายฟรียืนยัน ก.ย. → ไม่นับ (เดิม)
  ], opt).byNotice;
  assert.deepEqual(['A', 'B', 'C', 'D', 'E', 'F'].map(k => r[k].calc_rule), ['PAID', 'PRE_START', 'PAID', 'PRE_START', 'WAIT_ISSUE_DATE', 'PRE_START']);
  assert.equal(r.A.calc_amount, '700'); assert.equal(r.C.calc_amount, '700');
});

t('หมายฟรีจ่ายหมายปีงบหนึ่งแต่ส่งปีงบถัดไป ไม่นับและไม่รวมหน่วยกับหมายปีใหม่ (ทุกปีงบ)', () => {
  const F = (id, o) => Object.assign({ notice_uid: id, pay_type: 'BUDGET', amount_src: '0', area_id: '160101', officer_id: 'OF01', moo: '1', place_key: 'ม.1', addr_type: 'MOO', fy: '2571', delivered_date: '2027-10-04' }, o);
  const r = ctx.calcCompute_([F('OLD', { issued_date: '2027-09-20', house_no: '1', case_no: 'A/2570' }), F('NEW', { issued_date: '2027-10-01', house_no: '2', case_no: 'B/2570' })], opt);
  assert.equal(r.byNotice.OLD.calc_rule, 'PRE_START'); assert.equal(r.byNotice.NEW.calc_rule, 'SINGLE'); assert.equal(r.byNotice.NEW.calc_amount, '300');
});

t('หมายฟรีพ้นปีงบโดยยังไม่เบิก: ทุกหน้าใช้กฎเดียวกัน (freeExpired_) และรอบเบิกไม่เสนอ', () => {
  const n = { notice_uid: 'E1', pay_type: 'BUDGET', fy: '2570', issued_date: '2026-11-01', delivered_date: '2026-11-03', reported_date: '2026-11-03', calc_rule: 'SINGLE', calc_amount: '300', officer_id: 'OF01' };
  assert.equal(g.freeExpired_(n, '2027-09-30'), false); assert.equal(g.freeExpired_(n, '2027-10-01'), true);
  assert.equal(g.freeExpired_(Object.assign({}, n, { payout_round_id: 'R' }), '2027-10-01'), false, 'เบิกแล้วไม่ถือว่าพ้นปี');
  assert.equal(g.freeExpired_(Object.assign({}, n, { pay_type: 'PAID' }), '2027-10-01'), false, 'หมายมีเงินคงกฎเดิม');
  const late = g.payoutFreeItems_([n], { cutoff: '2027-10-05', today: '2027-10-05' }), ok = g.payoutFreeItems_([n], { cutoff: '2027-09-29', today: '2027-09-29' });
  assert.equal(late.items.length, 0); assert.equal(late.blocked.expired, 1); assert.equal(ok.items.length, 1);
  const linked = g.linkNotices_([n], [{ round_id: 'Z', status: 'CANCELLED' }], [{ round_id: 'Z', notice_uids: 'E1', included: true, amount: '300' }]);
  assert.equal(linked[0].payout_round_id, undefined, 'รอบยกเลิกไม่นับเป็นประวัติ');
});

// ---- หน้าเว็บ (DOM) ----
const { JSDOM } = require(process.env.NP_JSDOM_PATH || 'jsdom');
g.appendRows_('PAYOUT_ROUNDS', [{ round_id: 'R-X', fy, pay_date: fyStart, status: 'CONFIRMED', round_type: 'PAID', total: '1000', lines_json: JSON.stringify([{ officer_id: 'OF02', paid_c: 100000, budget_c: 0, c60: 60000, c40: 40000 }]) }]);
const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true }), w = dom.window;
w.NP_CONFIG = { VERSION: '0.7.10', API_URL: 'http://localhost/api' }; w.matchMedia = () => ({ matches: false }); w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
const actions = []; w.fetch = async (u, o) => { const d = JSON.parse(o.body); actions.push(d); return { json: async () => call(d.action, d) }; };
w.crypto.randomUUID = w.crypto.randomUUID || (() => 'ui-' + Math.random().toString(36).slice(2, 12));
w.eval(fs.readFileSync(path.join(__dirname, '../web/import-formats.js'), 'utf8'));
w.eval(fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8').replace(/\}\)\(\);\s*$/, 'window.__T={S,go,enterApp};})();'));
const a = w.__T, tick = (ms) => new Promise(r => setTimeout(r, ms || 60)), text = () => w.document.querySelector('#main').textContent.replace(/\u00a0/g, ' ');
(async () => {
  await tick(); a.S.token = token; a.S.user = auth.user; a.S.fy = fy; a.enterApp(); await tick();
  a.go('compensation'); await tick();
  assert.ok(text().includes('ยังไม่บันทึกหลักฐานจ่าย')); assert.ok(!text().includes('ยังไม่มีหลักฐานจ่าย'));
  assert.ok(text().includes('ไม่ได้แปลว่ายังไม่จ่าย'));
  const pick = w.document.querySelector('[data-comp-pick="R-X"]'); assert.ok(pick && w.document.querySelector('#compPay'));
  assert.equal(w.document.querySelectorAll('[data-comp-pick]').length, 1, 'รอบที่บันทึกจ่ายแล้วไม่มีช่องเลือก');
  pick.checked = true; w.document.querySelector('#compRef').value = 'ใบแบ่งยอดทดสอบ';
  w.document.querySelector('#compPay').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await tick();
  const ok = Array.from(w.document.querySelectorAll('button')).find(b => /ตกลง|ยืนยัน/.test(b.textContent) && b.closest('.ask-box,.askbox,[role=dialog],dialog'));
  assert.ok(ok, 'ต้องมีกล่องยืนยันกลางจอ'); ok.click(); await tick(150);
  const sent = actions.filter(x => x.action === 'round_payment_bulk').at(-1); assert.deepEqual(sent.round_ids, ['R-X']); assert.ok(sent.request_id);
  assert.equal(g.readTable_('PAYOUT_ROUNDS').rows.find(r => r.round_id === 'R-X').payment_status, 'PAID');
  a.go('budget'); await tick(150);
  assert.ok(text().includes('หมายเงินงบประมาณคงค้าง')); assert.ok(text().includes('ยอดในทะเบียน (รวมที่เบิกแล้ว)')); assert.ok(text().includes('เบิกแล้ว (ไม่นับคงค้าง)'));
  a.go('reports'); await tick(150);
  assert.ok(text().includes('มีบัญชีจ่ายแล้ว แต่ยังไม่มีรอบแบ่งในระบบ'));
  a.go('payout'); await tick(150);
  assert.ok(text().includes('มีบัญชีจ่ายแล้ว แต่ยังไม่มีรอบแบ่งในระบบ')); assert.ok(text().includes('จับคู่ทะเบียนไม่ได้ 1'));
  assert.ok(!text().includes('is not defined'));
  console.log('✓ หน้าเว็บ: ข้อความสถานะจ่าย บันทึกจ่ายหลายรอบ ยอดคงค้างหมายฟรี และบัญชีจ่ายที่ไม่มีรอบ'); count++;
  dom.window.close();
  console.log('ผ่าน ' + count + ' ชุดทดสอบ 0.7.10 (ประวัติรอบ หลักฐานจ่าย บัญชีไม่มีรอบ ยอดคงค้าง กฎข้ามปีงบ)');
})().catch(e => { console.error(e); dom.window.close(); process.exitCode = 1; });
