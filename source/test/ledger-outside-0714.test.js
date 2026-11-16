// 0.7.14 ข้อมูลสมมติเท่านั้น: บัญชีจ่ายเงินวันที่ที่แบ่ง 60:40 นอกระบบแล้ว (งานก่อนเริ่มระบบ)
// ต้องไม่แก้แถวบัญชี/ยอด ไม่สร้างรอบ แต่เลิกนับเป็น "รอตั้งรอบ" และ "รอยืนยันการจับคู่" · ยกเลิกได้
const assert = require('assert');
const { g, call, props } = require('./harness');
let count = 0; const t = (name, fn) => { fn(); count++; console.log('✓', name); };
g.setupSystem(); props.PRINTHUB_DB_ID = 'PH';
const auth = call('login', { code: 'U001', pin: '1234' }).data, token = auth.token;
const C = (a, d) => { const r = call(a, Object.assign({ token }, d || {})); assert.ok(r.ok, a + ' ' + JSON.stringify(r)); return r.data; };
const E = (a, d) => { const r = call(a, Object.assign({ token }, d || {})); assert.ok(!r.ok, a + ' ควรไม่ผ่าน'); return r; };
const fy = String(g.currentFy_()), y = Number(fy) - 544, dOut = y + '-10-02', dOk = y + '-10-03';
const off = g.officersAll_().find(o => o.officer_id === 'OF01');
const L = (id, date, cs, amt) => ({ ledger_id: id, source: 'PAY', pay_date: date, officer_raw: off.full_name || off.name, officer_id: 'OF01', case_no: cs, recipient: 'สมมติ ' + id, amount: String(amt), match: 'NONE', notice_uids: '', round_id: '' });
g.appendRows_('LEDGER', [L('LA1', dOut, 'ก1/2568', 600), L('LA2', dOut, 'ก2/2568', 650), L('LA3', dOut, 'ก3/2568', 700), L('LB1', dOk, 'ข1/2569', 500)]);
// วันที่ dOk มีหมายในระบบจับคู่ได้ → ห้ามปิดทั้งวันว่าแบ่งนอกระบบ
g.appendRows_('NOTICES', [{ notice_uid: 'NB1', case_no: 'ข1/2569', recipient: g.NoticeImportFormat.recipient('ข1/2569', 'สมมติ LB1'), pay_type: 'PAID', fy,
  officer_id: 'OF01', amount_src: '500', calc_rule: 'PAID', calc_amount: '500', issued_date: y + '-10-01', delivered_date: y + '-10-02', area_id: '160101', tambon: 'ทะเลชุบศร', amphoe: 'เมืองลพบุรี' }]);
g.ledgerAutoReconcile_('U001');
const snap = () => JSON.stringify(g.readTable_('LEDGER').rows.map(r => [r.ledger_id, r.pay_date, r.amount, r.round_id, r.case_no]));
const before = snap(), roundsBefore = g.readTable_('PAYOUT_ROUNDS').rows.length;

t('ก่อนบันทึก: วันที่ 2 ต.ค. อยู่ในรายการรอตั้งรอบ และรอยืนยันการจับคู่ 3 รายการ', () => {
  const l = C('payout_list');
  assert.ok(l.pending_dates.some(x => x.pay_date === dOut && x.rows === 3 && x.none === 3));
  assert.equal(C('ledger_pending', { fy }).total_rows, 3);
});

t('ต้องระบุเหตุผล · ปิดวันที่ที่มีหมายจับคู่ได้ไม่ได้ · ปิดวันที่ไม่มีบัญชีไม่ได้', () => {
  assert.ok(/เหตุผล/.test(E('ledger_outside', { pay_date: dOut, reason: '' }).msg));
  assert.ok(/จับคู่กับหมายในระบบได้/.test(E('ledger_outside', { pay_date: dOk, reason: 'ทดสอบ ปิดไม่ได้' }).msg));
  E('ledger_outside', { pay_date: y + '-12-31', reason: 'ไม่มีบัญชีวันนี้' });
});

t('บันทึกว่าแบ่งนอกระบบ: เลิกนับรอตั้งรอบ/รอจับคู่ · ยอดบัญชีและรอบคงเดิม', () => {
  const r = C('ledger_outside', { pay_date: dOut, reason: 'งานเดือน ก.ย. ก่อนเริ่มระบบ แบ่ง 60:40 นอกระบบแล้ว' });
  assert.equal(r.rows, 3); assert.equal(r.amount, 1950);
  const l = C('payout_list');
  assert.ok(!l.pending_dates.some(x => x.pay_date === dOut), 'ไม่อยู่ในรายการรอตั้งรอบ');
  assert.ok(l.pending_dates.some(x => x.pay_date === dOk), 'วันอื่นยังอยู่');
  assert.equal(l.outside.dates.length, 1); assert.equal(l.outside.n, 3); assert.equal(l.outside.amount, 1950);
  const p = C('ledger_pending', { fy }); assert.equal(p.total_rows, 0); assert.equal(p.outside.n, 3);
  const tr = C('tracking', { fy, pay_type: 'PAID' }).ledger_summary;
  assert.equal(tr.outside_n, 3); assert.equal(tr.outside_amount, 1950); assert.equal(tr.unmatched_n, 0);
  assert.equal(tr.count, 4, 'ยอดควบคุมยังนับทุกแถว'); assert.equal(tr.amount, 2450);
  const bd = tr.by_date.find(x => x.pay_date === dOut); assert.equal(bd.state, 'OUTSIDE'); assert.ok(/นอกระบบ/.test(bd.state_th));
  assert.equal(snap(), before, 'แถวบัญชี ยอด วันที่ ไม่เปลี่ยน');
  assert.equal(g.readTable_('PAYOUT_ROUNDS').rows.length, roundsBefore, 'ไม่สร้างรอบ');
  assert.equal(g.ledgerAutoReconcile_('U001').pending, 0, 'ตรวจจับคู่หลังนำเข้าไม่นับวันที่นอกระบบ');
});

t('ตั้งรอบซ้ำให้วันที่ที่แบ่งนอกระบบไม่ได้ · ปุ่มไม่แสดงซ้ำ', () => {
  assert.ok(/นอกระบบ/.test(E('payout_confirm', { round_type: 'PAID', pay_date: dOut, seats: 48, request_id: 'rq-out-1' }).msg));
  assert.equal(C('payout_candidates', { round_type: 'PAID', pay_date: dOut }).can_outside, false);
  assert.equal(C('payout_candidates', { round_type: 'PAID', pay_date: dOk }).can_outside, true);
  assert.equal(C('payout_candidates', { round_type: 'FREE', pay_date: dOk }).can_outside, false, 'หมายฟรีไม่มีปุ่มนี้');
});

t('ยกเลิกการบันทึก → กลับมารอตั้งรอบตามเดิม', () => {
  C('ledger_outside', { pay_date: dOut, undo: true });
  assert.ok(C('payout_list').pending_dates.some(x => x.pay_date === dOut));
  assert.equal(C('ledger_pending', { fy }).total_rows, 3);
  assert.equal(snap(), before);
});


// ---- หน้าเว็บ: ปุ่มในหน้าตั้งรอบ → รายการรอบแสดงวันที่แบ่งนอกระบบ → ยกเลิกได้ ----
const fs = require('fs'), path = require('path');
const { JSDOM } = require(process.env.NP_JSDOM_PATH || 'jsdom');
const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true }), w = dom.window;
w.NP_CONFIG = { VERSION: '0.7.14', API_URL: 'http://localhost/api' }; w.matchMedia = () => ({ matches: false }); w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
w.fetch = async (u, o) => { const d = JSON.parse(o.body); return { json: async () => call(d.action, d) }; };
w.crypto.randomUUID = w.crypto.randomUUID || (() => 'ui-' + Math.random().toString(36).slice(2, 12));
w.eval(fs.readFileSync(path.join(__dirname, '../web/import-formats.js'), 'utf8'));
w.eval(fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8').replace(/\}\)\(\);\s*$/, 'window.__T={S,go,enterApp};})();'));
const a = w.__T, tick = (ms) => new Promise(r => setTimeout(r, ms || 80)), $ = (q) => w.document.querySelector(q), text = () => $('#main').textContent;
(async () => {
  await tick(); a.S.token = token; a.S.user = auth.user; a.S.fy = fy; a.enterApp(); await tick(200);
  a.S.payoutSub = 'list'; a.go('payout'); await tick(300);
  assert.ok([...w.document.querySelectorAll('.pdate')].some(b => b.dataset.pd === dOut), 'มีปุ่มวันที่รอตั้งรอบ');
  a.S.payoutSub = 'new:PAID:' + dOut; a.go('payout'); await tick(300);
  $('#pLoad').click(); await tick(400);
  assert.ok($('#pOutside'), 'ผู้ดูแลเห็นปุ่มบันทึกว่าแบ่งจ่ายนอกระบบแล้ว');
  $('#pOutside').click(); await tick(60);
  assert.equal($('.ask-in').value, 'งานเดือน ก.ย. ก่อนเริ่มระบบ แบ่ง 60:40 นอกระบบแล้ว', 'เติมเหตุผลตั้งต้นให้');
  $('.ask-ok').click(); await tick(500);
  assert.ok(text().includes('แบ่ง 60:40 นอกระบบแล้ว (ไม่ตั้งรอบ)'), 'หน้ารอบเบิกแสดงวันที่ที่แบ่งนอกระบบ');
  assert.ok(![...w.document.querySelectorAll('.pdate')].some(b => b.dataset.pd === dOut), 'ไม่อยู่ในปุ่มรอตั้งรอบแล้ว');
  assert.equal(snap(), before, 'กดจากหน้าเว็บแล้วยอดบัญชีคงเดิม');
  $('[data-outundo]').click(); await tick(60); $('.ask-ok').click(); await tick(500);
  assert.ok([...w.document.querySelectorAll('.pdate')].some(b => b.dataset.pd === dOut), 'ยกเลิกแล้วกลับมารอตั้งรอบ');
  assert.ok(!text().includes('is not defined'));
  console.log('✓ หน้าเว็บ: ปุ่มแบ่งนอกระบบ · รายการรอบ · ยกเลิก'); count++;
  dom.window.close();
  console.log('ledger-outside-0714: ผ่าน ' + count + ' ชุด');
})().catch(e => { console.error(e); dom.window.close(); process.exitCode = 1; });
