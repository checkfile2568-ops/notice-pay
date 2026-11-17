// 0.7.17 ประวัติการใช้งาน (ข้อมูลสมมติ): กรอง · สรุปเข้าระบบรายคน · ล้างเฉพาะบันทึกเข้า/ออกระบบที่เกินระยะเก็บ · บันทึกเงินเก็บถาวร
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { g, call, props } = require('./harness');
const { JSDOM } = require(process.env.NP_JSDOM_PATH || 'jsdom');
let count = 0; const t = (n, f) => { f(); count++; console.log('✓', n); };
g.setupSystem(); props.PRINTHUB_DB_ID = 'PH';
const auth = call('login', { code: 'U001', pin: '1234' }).data, token = auth.token;
const C = (a, d) => { const r = call(a, Object.assign({ token }, d || {})); assert.ok(r.ok, a + ' ' + JSON.stringify(r)); return r.data; };
const today = g.now_().slice(0, 10);
const daysAgo = (n) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
g.appendRows_('AUDIT', [
  { at: daysAgo(400) + 'T08:00:00', user_code: 'U001', action: 'LOGIN', target: 'U001', detail: 'สำเร็จ ADMIN' },
  { at: daysAgo(380) + 'T08:00:00', user_code: 'U001', action: 'LOGOUT', target: 'U001', detail: '' },
  { at: daysAgo(400) + 'T09:00:00', user_code: 'U001', action: 'PAYOUT_CONFIRM', target: 'PR-OLD', detail: '{"total":1000}' },
  { at: daysAgo(400) + 'T09:30:00', user_code: 'U001', action: 'IMPORT', target: 'B-OLD', detail: 'ไฟล์ 50' },
  { at: daysAgo(3) + 'T10:00:00', user_code: 'U001', action: 'LOGIN', target: 'U001', detail: 'PIN ผิด 1' },
  { at: daysAgo(3) + 'T10:01:00', user_code: 'U001', action: 'ROUND_PAYMENT_BULK', target: '8 รอบ', detail: '{"total":360090}' },
  { at: daysAgo(2) + 'T11:00:00', user_code: 'U001', action: 'ERROR', target: '', detail: 'ทดสอบข้อผิดพลาด' }
]);
const auditRows = () => g.readTable_('AUDIT').rows;

t('ล้างเฉพาะบันทึกเข้า/ออกระบบที่เก่ากว่า 365 วัน · รอบเบิก/นำเข้าเก่าเก็บไว้', () => {
  const before = auditRows().length;
  const d = C('audit_list', {});
  assert.equal(d.purged, 2);
  const rows = auditRows();
  assert.ok(!rows.some(r => r.target === 'U001' && String(r.at).startsWith(daysAgo(400))), 'LOGIN เก่าถูกล้าง');
  assert.ok(rows.some(r => r.target === 'PR-OLD') && rows.some(r => r.target === 'B-OLD'), 'บันทึกเงิน/นำเข้าเก่าคงอยู่');
  assert.equal(rows.length, before - 2 + 1, 'มีบันทึก SYSTEM การล้าง 1 รายการ');
  assert.equal(C('audit_list', {}).purged, 0, 'ล้างวันละครั้ง');
});

t('ช่วงเริ่มต้น 30 วัน · นับตามประเภท · สรุปเข้าระบบรายคน', () => {
  const d = C('audit_list', {});
  assert.equal(d.from, daysAgo(30)); assert.equal(d.to, today);
  assert.ok(!d.rows.some(r => r.target === 'PR-OLD'), 'นอกช่วงไม่แสดง');
  assert.ok(d.counts.MONEY >= 1 && d.counts.ERROR >= 1 && d.counts.LOGIN >= 2);
  const me = d.per_user.find(p => p.user_code === 'U001');
  assert.ok(me.ok >= 1 && me.fail >= 1);
  assert.ok(d.rows[0].at >= d.rows[d.rows.length - 1].at, 'ใหม่ก่อน');
  assert.ok(d.rows.some(r => r.action_th === 'บันทึกจ่ายจริงหลายรอบ'));
});

t('กรองประเภท ผู้ใช้ คำค้น และช่วงวันที่ย้อนหลัง', () => {
  assert.ok(C('audit_list', { group: 'MONEY' }).rows.every(r => r.group === 'MONEY'));
  assert.equal(C('audit_list', { q: '8 รอบ' }).total, 1);
  assert.equal(C('audit_list', { user: 'NOPE' }).total, 0);
  const old = C('audit_list', { from: daysAgo(500), to: daysAgo(390) });
  assert.ok(old.rows.some(r => r.target === 'PR-OLD') && old.rows.some(r => r.target === 'B-OLD'));
  assert.ok(!old.rows.some(r => r.action === 'LOGIN'));
});

t('ต้องเข้าระบบ · ผู้ดูแลเท่านั้น (เส้นทาง ADMIN)', () => {
  assert.ok(!call('audit_list', {}).ok);
  const src = fs.readFileSync(path.join(__dirname, '../gas/Code.gs'), 'utf8');
  assert.ok(/audit_list:\s*\{ auth: true, roles: ADMIN, fn: apiAuditList_ \}/.test(src));
});

// หน้าเว็บ
const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true }), w = dom.window;
w.NP_CONFIG = { VERSION: '0.7.17', API_URL: 'http://localhost/api' }; w.matchMedia = () => ({ matches: false }); w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
w.fetch = async (u, o) => { const d = JSON.parse(o.body); return { json: async () => call(d.action, d) }; };
w.eval(fs.readFileSync(path.join(__dirname, '../web/import-formats.js'), 'utf8'));
w.eval(fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8').replace(/\}\)\(\);\s*$/, 'window.__T={S,go,enterApp};})();'));
const a = w.__T, tick = (ms) => new Promise(r => setTimeout(r, ms || 80)), $ = (q) => w.document.querySelector(q);
(async () => {
  await tick(); a.S.token = token; a.S.user = auth.user; a.enterApp(); await tick(200);
  a.go('users'); await tick(300);
  const tab = [...w.document.querySelectorAll('.section-tabs button')].find(b => b.textContent === 'ประวัติการใช้งาน');
  assert.ok(tab, 'ผู้ดูแลเห็นแท็บประวัติการใช้งาน');
  tab.click(); await tick(300);
  const txt = $('#main').textContent;
  assert.ok(txt.includes('การเข้าระบบรายคน') && txt.includes('บันทึกจ่ายจริงหลายรอบ'));
  w.document.querySelector('#auF [name=group]').value = 'ERROR';
  $('#auF').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(300);
  const rows = [...w.document.querySelectorAll('#main table.wide-tbl')].pop().querySelectorAll('tbody tr');
  assert.ok(rows.length >= 1 && [...rows].every(r => r.textContent.includes('ข้อผิดพลาด')));
  assert.ok(!$('#main').textContent.includes('is not defined'));
  console.log('✓ หน้าเว็บ: แท็บ · ตาราง · กรองประเภท'); count++;
  dom.window.close(); console.log('audit-0717: ผ่าน ' + count + ' ชุด');
})().catch(e => { console.error(e); dom.window.close(); process.exitCode = 1; });
