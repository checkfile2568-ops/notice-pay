// 0.7.13 ข้อมูลสมมติเท่านั้น: หมายเงินงบประมาณ เบิกจ่ายจริง / ยังไม่เบิก (เต็มอัตราตามวันที่ส่ง) และข้อความกำกับ
const assert = require('assert'), fs = require('fs'), path = require('path');
const { g, call, props } = require('./harness');
let count = 0; const t = (name, fn) => { fn(); count++; console.log('✓', name); };
g.setupSystem(); props.PRINTHUB_DB_ID = 'PH';
const auth = call('login', { code: 'U001', pin: '1234' }).data, token = auth.token;
const C = (a, d) => { const r = call(a, Object.assign({ token }, d || {})); assert.ok(r.ok, a + ' ' + JSON.stringify(r)); return r.data; };
const fy = String(g.currentFy_()), y = Number(fy) - 544, d1 = y + '-10-05', d2 = y + '-10-06';
const base = { pay_type: 'BUDGET', fy, area_id: '160101', tambon: 'ทะเลชุบศร', amphoe: 'เมืองลพบุรี', officer_id: 'OF01', issued_date: y + '-10-01' };
const N = (id, o) => Object.assign({ notice_uid: id, case_no: id + '/2569', recipient: 'R1-' + id }, base, o);

// 3 คดีคนละบ้าน หมู่ 3 วันเดียวกัน (กึ่งหนึ่ง) · 1 ฉบับต่างวัน · 1 ฉบับไม่มีหมู่ · 1 รอผล · 1 เข้ารอบแล้ว (ยอดรอบ 150) · 1 ปิดไม่เบิก
g.appendRows_('NOTICES', [
  N('A1', { moo: '3', addr_type: 'MOO', house_no: '1', delivered_date: d1, calc_rule: 'HALF', calc_amount: '150' }),
  N('A2', { moo: '3', addr_type: 'MOO', house_no: '2', delivered_date: d1, calc_rule: 'HALF', calc_amount: '150' }),
  N('A3', { moo: '3', addr_type: 'MOO', house_no: '3', delivered_date: d1, calc_rule: 'HALF', calc_amount: '150' }),
  N('B1', { moo: '3', addr_type: 'MOO', house_no: '4', delivered_date: d2, calc_rule: 'SINGLE', calc_amount: '300' }),
  N('C1', { moo: '', addr_type: 'URBAN', house_no: '9', delivered_date: d2, calc_rule: 'SINGLE', calc_amount: '300' }),
  N('W1', { moo: '5', addr_type: 'MOO', delivered_date: '', calc_rule: 'WAIT_DELIVERY', calc_amount: '' }),
  N('R1', { moo: '7', addr_type: 'MOO', house_no: '5', delivered_date: d1, calc_rule: 'HALF', calc_amount: '150' }),
  N('X1', { moo: '8', addr_type: 'MOO', delivered_date: d1, calc_rule: 'SINGLE', calc_amount: '300', noclaim_at: d2 }),
  N('P1', { pay_type: 'PAID', delivered_date: d1, calc_rule: 'PAID', calc_amount: '500', amount_src: '500' }),
  N('O2', { officer_id: 'OF02', moo: '1', addr_type: 'MOO', delivered_date: d1, calc_rule: 'SINGLE', calc_amount: '300' })
]);
g.appendRows_('PAYOUT_ROUNDS', [{ round_id: 'RF', fy, pay_date: d2, status: 'CONFIRMED', round_type: 'FREE', total: '150', lines_json: '[]' }]);
g.appendRows_('PAYOUT_ITEMS', [{ round_id: 'RF', item_key: 'N:R1', item_type: 'BUDGET', officer_id: 'OF01', amount: '150', notice_uids: 'R1', included: true }]);

t('ยังไม่เบิกคิดเต็มอัตราต่อฉบับตามวันที่ส่ง · เบิกจริงใช้ยอดในรอบ · รอผลไม่คิดเงิน', () => {
  const d = C('free_claim', { fy }), o = d.officers.find(x => x.officer_id === 'OF01');
  assert.equal(o.unclaimed_n, 5); assert.equal(o.unclaimed_full, 1500, 'ไม่หักกึ่งหนึ่ง: 300 × 5');
  assert.equal(o.claimed_n, 1); assert.equal(o.claimed_amount, 150);
  assert.equal(o.delivered_n, 6); assert.equal(o.wait_n, 1); assert.equal(o.closed_n, 1); assert.equal(o.no_moo_n, 1);
  assert.equal(d.totals.unclaimed_full, 1800); assert.equal(d.totals.claimed_amount, 150);
  assert.ok(!JSON.stringify(d).includes('R1-'), 'ไม่มีรหัสผู้รับ'); assert.ok(!JSON.stringify(d).includes('/2569'), 'ไม่มีเลขคดี');
});

t('ผู้ส่งเห็นเฉพาะของตนเอง · ไอดีดูสถิติเห็นทุกคน', () => {
  const own = g.freeClaimData_({ user: { roles: ['COURIER'], officer_id: 'OF02' } }, fy);
  assert.equal(own.officers.length, 1); assert.equal(own.officers[0].officer_id, 'OF02'); assert.equal(own.officers[0].unclaimed_full, 300);
  const viewer = g.freeClaimData_({ user: { roles: ['VIEWER'] } }, fy);
  assert.equal(viewer.officers.length, 2);
});

t('ฟังก์ชันล้วน: พ้นปีงบ = ไม่เบิกจ่าย และอัตราอำเภออื่นตามตำบล', () => {
  const n = { pay_type: 'BUDGET', fy: '2570', officer_id: 'A', issued_date: '2026-11-01', delivered_date: '2026-11-02', area_id: '160201', moo: '1' };
  const rate = (x) => x.area_id === '160201' ? 800 : 300;
  assert.equal(g.freeClaimSummary_([n], { fy: '2570', today: '2027-09-30', rateOf: rate }).totals.unclaimed_full, 800);
  const late = g.freeClaimSummary_([n], { fy: '2570', today: '2027-10-01', rateOf: rate }).totals;
  assert.equal(late.unclaimed_n, 0); assert.equal(late.closed_n, 1);
});

t('นำเข้าไฟล์หมายแล้วตรวจรายการรอยืนยันการจับคู่ให้อัตโนมัติ · ปิดได้ด้วย CONFIG · ยอดเงินไม่เปลี่ยน', () => {
  const off = g.officersAll_().find(o => o.officer_id === 'OF01'), cs = 'ZZ9/2569', rawName = 'สมมติ ทดสอบ';
  g.appendRows_('LEDGER', [{ ledger_id: 'LZ1', source: 'PAY', pay_date: y + '-11-20', officer_raw: off.full_name || off.name, officer_id: 'OF01', case_no: cs, recipient: rawName, amount: '650', match: 'NONE', notice_uids: '', round_id: '' }]);
  const before = JSON.stringify(g.readTable_('LEDGER').rows.map(r => [r.ledger_id, r.amount, r.pay_date, r.round_id]));
  assert.equal(g.ledgerAutoReconcile_('U001').newly_matched, 0, 'ยังไม่มีหมายในทะเบียน');
  g.appendRows_('NOTICES', [N('ZZ9', { case_no: cs, recipient: g.NoticeImportFormat.recipient(cs, rawName), pay_type: 'PAID', amount_src: '650', calc_rule: 'PAID', calc_amount: '650', delivered_date: y + '-11-10', issued_date: y + '-11-01' })]);
  const r = g.ledgerAutoReconcile_('U001');
  assert.equal(r.auto, true); assert.equal(r.newly_matched, 1); assert.equal(r.amounts_unchanged, true);
  const row = g.readTable_('LEDGER').rows.find(x => x.ledger_id === 'LZ1'); assert.equal(row.match, 'OK'); assert.equal(row.notice_uids, 'ZZ9');
  assert.equal(JSON.stringify(g.readTable_('LEDGER').rows.map(x => [x.ledger_id, x.amount, x.pay_date, x.round_id])), before, 'ยอด วันที่ รอบ คงเดิม');
  const cfg = g.readTable_('CONFIG'); const k = cfg.rows.find(x => x.key === 'LEDGER_AUTO_RECONCILE'); assert.ok(k, 'มีค่าตั้ง LEDGER_AUTO_RECONCILE');
  k.value = 'FALSE'; g.updateRow_('CONFIG', k._r, k); require('vm').runInContext('CFG_CACHE_ = null; DB_CACHE_ = null;', g);
  assert.equal(g.ledgerAutoReconcile_('U001').auto, false);
  k.value = 'TRUE'; g.updateRow_('CONFIG', k._r, k); require('vm').runInContext('CFG_CACHE_ = null; DB_CACHE_ = null;', g);
  assert.ok(fs.readFileSync(path.join(__dirname, '../gas/Import.gs'), 'utf8').includes('out.ledger_check = ledgerAutoReconcile_(ctx.user.code)'), 'เรียกหลังนำเข้าไฟล์หมาย');
});

// ---- หน้าเว็บ: ตารางและข้อความกำกับในหน้าสถิติและหน้าหมายเงินงบประมาณ ----
const { JSDOM } = require(process.env.NP_JSDOM_PATH || 'jsdom');
const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true }), w = dom.window;
w.NP_CONFIG = { VERSION: '0.7.13', API_URL: 'http://localhost/api' }; w.matchMedia = () => ({ matches: false }); w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
w.fetch = async (u, o) => { const d = JSON.parse(o.body); return { json: async () => call(d.action, d) }; };
w.crypto.randomUUID = w.crypto.randomUUID || (() => 'ui-' + Math.random().toString(36).slice(2, 12));
w.eval(fs.readFileSync(path.join(__dirname, '../web/import-formats.js'), 'utf8'));
w.eval(fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8').replace(/\}\)\(\);\s*$/, 'window.__T={S,go,enterApp};})();'));
const a = w.__T, tick = (ms) => new Promise(r => setTimeout(r, ms || 80)), text = () => w.document.querySelector('#main').textContent.replace(/ /g, ' ');
(async () => {
  await tick(); a.S.token = token; a.S.user = auth.user; a.S.fy = fy; a.enterApp(); await tick(200);
  a.go('home'); await tick(250);
  assert.ok(text().includes('หมายเงินงบประมาณ · เบิกจ่ายจริง และยังไม่เบิก'));
  assert.ok(text().includes('ยังไม่เบิก*')); assert.ok(text().includes('บาท · เต็มอัตรา')); assert.ok(text().includes('1,800.00'));
  assert.ok(text().includes('คิดเต็มอัตราต่อฉบับตามวันที่ส่ง')); assert.ok(text().includes('กึ่งหนึ่ง (เช่น 150 บาท)'));
  assert.ok(text().includes('ต.ท่าหิน ต.ท่าศาลา และ ต.ทะเลชุบศร มีหมู่บ้าน'));
  a.S.payoutSub = 'round:RF'; a.go('payout'); await tick(350);
  assert.ok(w.document.querySelector('#pImage') && w.document.querySelector('#pImage').textContent === 'บันทึกเป็นรูป', 'หน้ารอบมีปุ่มบันทึกเป็นรูป');
  const css = fs.readFileSync(path.join(__dirname, '../web/app.css'), 'utf8');
  assert.ok(/\.top h2\{flex:1 1 240px\}/.test(css) && css.includes('.top h2{flex-basis:100%}'), 'หัวเรื่องทุกเมนูไม่ถูกบีบบนมือถือ');
  a.go('budget'); await tick(300);
  assert.ok(text().includes('หมายเงินงบประมาณ · เบิกจ่ายจริง และยังไม่เบิก'), 'หน้าทะเบียนหมายเงินงบประมาณมีตารางเดียวกัน');
  assert.ok(!text().includes('is not defined'));
  console.log('✓ หน้าเว็บ: ตารางเบิกจริง/ยังไม่เบิก และข้อความกำกับ ในหน้าสถิติและหน้าหมายเงินงบประมาณ'); count++;
  dom.window.close();
  console.log('ผ่าน ' + count + ' ชุดทดสอบ 0.7.13');
})().catch(e => { console.error(e); dom.window.close(); process.exitCode = 1; });
