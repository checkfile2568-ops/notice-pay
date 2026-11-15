// ชุดจำลอง GAS (mock SpreadsheetApp ฯลฯ) ใช้ร่วมกันระหว่าง gas.smoke.js และ realfile.check.js
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');

/* ---------- mock Google Sheets ---------- */
function makeSheet(name) {
  const data = [];
  const sh = {
    name, data,
    getName: () => name,
    getLastRow: () => { let n = data.length; while (n > 0 && data[n - 1].every(v => v === '' || v === undefined)) n--; return n; },
    getLastColumn: () => Math.max(0, ...data.map(r => r.length)),
    getMaxRows: () => Math.max(1000, data.length),
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const row = data[r - 1 + i] || []; const v = row[c - 1 + j]; return v === undefined ? '' : v; })),
      setValues: (vals) => { vals.forEach((row, i) => { while (data.length < r + i) data.push([]); row.forEach((v, j) => { data[r - 1 + i][c - 1 + j] = v; }); }); return this; },
      clearContent: () => { for (let i = 0; i < nr; i++) { const row = data[r - 1 + i]; if (row) for (let j = 0; j < nc; j++) row[c - 1 + j] = ''; } },
      setNumberFormat() { return this; }, setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }
    }),
    setFrozenRows() {}
  };
  // chainable helpers
  const orig = sh.getRange;
  sh.getRange = (...a) => { const rg = orig(...a); ['setNumberFormat', 'setFontWeight', 'setBackground', 'setFontColor', 'setValues'].forEach(k => { const f = rg[k]; rg[k] = (...x) => { f(...x); return rg; }; }); return rg; };
  return sh;
}
function makeSS(id) {
  const sheets = {};
  return { id, sheets,
    getId: () => id, getUrl: () => 'https://sheet/' + id,
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = makeSheet(n)),
    getSheets: () => Object.values(sheets), deleteSheet: s => { delete sheets[s.name]; } };
}
const spreadsheets = {};
// PrintHub USERS (อ่านอย่างเดียว)
const ph = makeSS('PH'); spreadsheets.PH = ph;
const U = ph.insertSheet('USERS');
const salt = 'salt-1';
const hash = crypto.createHash('sha256').update(salt + '|1234|PrintHub').digest('base64');
U.data.push(['user_code', 'ชื่อ', 'นามสกุล', 'ส่วนงาน', 'บทบาท', 'ใช้งาน', 'รหัสชั่วคราว', 'pin_hash', 'pin_salt', 'ต้องเปลี่ยนรหัส', 'โควตา', 'ผิดพลาดสะสม', 'ล็อกถึง', 'เข้าใช้ล่าสุด', 'สร้างเมื่อ']);
U.data.push(['U001', 'ผู้ดูแล', 'ทดสอบ', 'ส่วนช่วยพิจารณาคดี', 'admin', true, '', hash, salt, false, '', 0, '', '', '']);
U.data.push(['U006', 'โกมล', 'ไผ่งาม', 'ส่วนช่วยพิจารณาคดี', 'user', true, '', hash, salt, false, '', 0, '', '', '']);
U.data.push(['U009', 'ไม่มี', 'พิน', 'ส่วนคลัง', 'user', true, '', '', '', false, '', 0, '', '', '']);

const props = {}; const cache = {};
let idn = 0;
const g = {
  console,
  SpreadsheetApp: {
    openById: id => { if (!spreadsheets[id]) throw new Error('no ss'); return spreadsheets[id]; },
    getActiveSpreadsheet: () => null,
    create: name => { const s = makeSS('DB'); spreadsheets.DB = s; return s; },
    getUi: () => { throw new Error('no ui'); }
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
  CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()),
    base64Encode: bytes => Buffer.from(bytes.map(b => b & 255)).toString('base64'),
    getUuid: () => crypto.randomUUID(),
    formatDate: (d, tz, f) => { const z = new Date(d.getTime() + 7 * 3600000).toISOString(); return f.startsWith('yyMM') ? z.slice(2, 4) + z.slice(5, 7) + z.slice(8, 10) + z.slice(11, 13) + z.slice(14, 16) + z.slice(17, 19) + (idn++) : f === 'yyyy-MM-dd' ? z.slice(0, 10) : z.slice(0, 19); }
  },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ s, setMimeType() { return this; } }) },
  Logger: { log() {} }
};
vm.createContext(g);
const dir = path.join(__dirname, '../gas');
['Config.gs', 'ImportFormats.gs', 'Core.gs', 'Db.gs', 'Setup.gs', 'Auth.gs', 'Users.gs', 'Import.gs', 'Calc.gs', 'Dashboard.gs', 'Payout.gs', 'Ledger.gs', 'Operations.gs', 'Tracking.gs', 'Code.gs', 'PrivacyMigration.gs']
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), g, { filename: f }));

// ทุกคำขอเริ่มใหม่ (ล้างแคชระดับคำขอเหมือน GAS)
function call(action, body = {}) {
  vm.runInContext('DB_CACHE_=null;CFG_CACHE_=null;PH_CACHE_=null;HEAD_CACHE_={};', g);
  const out = g.doPost({ postData: { contents: JSON.stringify(Object.assign({ action }, body)) } });
  return JSON.parse(out.s);
}
module.exports = { g, call, props, spreadsheets };
