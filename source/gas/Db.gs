/**
 * ============================================================================
 *  ระบบค่าหมาย · ไฟล์ Db.gs
 *  หน้าที่ : เปิดฐานข้อมูล อ่าน/เขียนชีตแบบหัวคอลัมน์ ค่าตั้ง Audit ข้อผิดพลาด
 * ============================================================================
 */

/* ---------- Script Properties ---------- */
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }
function setProp_(k, v) { PropertiesService.getScriptProperties().setProperty(k, String(v)); }

/* ---------- ข้อผิดพลาดที่ส่งกลับหน้าเว็บ ---------- */
function appErr_(code, msg, extra) {
  const e = new Error(msg);
  e.appCode = code;
  e.extra = extra || null;
  return e;
}

/* ---------- ฐานข้อมูลระบบค่าหมาย ---------- */
let DB_CACHE_ = null;
function db_() {
  if (DB_CACHE_) return DB_CACHE_;
  const id = prop_('DB_ID');
  if (id) { DB_CACHE_ = SpreadsheetApp.openById(id); return DB_CACHE_; }
  const bound = SpreadsheetApp.getActiveSpreadsheet();
  if (bound) { DB_CACHE_ = bound; return DB_CACHE_; }
  throw appErr_('NOT_INSTALLED', 'ยังไม่ได้ติดตั้งระบบ — ผู้ดูแลต้องรันฟังก์ชัน setupSystem ก่อน');
}
function sheet_(name) {
  const sh = db_().getSheetByName(name);
  if (!sh) throw appErr_('NOT_INSTALLED', 'ไม่พบชีต ' + name + ' — รัน setupSystem อีกครั้ง');
  return sh;
}

/* ---------- ค่าในเซลล์: กันสูตร (ขึ้นต้น = + - @) และอ่านคืน ---------- */
function cellPut_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Bangkok', "yyyy-MM-dd'T'HH:mm:ss");
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  return /^[=+\-@]/.test(s) ? ("'" + s) : s;
}
function cellGet_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  const s = String(v);
  return s.charAt(0) === "'" ? s.slice(1) : s;
}

/* ---------- อ่านตารางทั้งชีตเป็น object ตามหัวคอลัมน์ (อ่านหัวจริงในชีต — เพิ่มคอลัมน์รุ่นใหม่ต่อท้ายได้) ---------- */
let HEAD_CACHE_ = {};
function headOf_(name, sh) {
  if (HEAD_CACHE_[name]) return HEAD_CACHE_[name];
  sh = sh || sheet_(name);
  const n = Math.max(sh.getLastColumn(), 1);
  const h = sh.getRange(1, 1, 1, n).getValues()[0].map(function (x) { return String(x).trim(); });
  while (h.length && !h[h.length - 1]) h.pop();
  HEAD_CACHE_[name] = h.length ? h : SHEETS[name].slice();
  return HEAD_CACHE_[name];
}
function readTable_(name) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  const head = headOf_(name, sh);
  if (last < 2) return { sh: sh, head: head, rows: [] };
  const vals = sh.getRange(2, 1, last - 1, head.length).getValues();
  const rows = vals.map(function (r, i) {
    const o = { _r: i + 2 };
    head.forEach(function (h, j) { if (h) o[h] = cellGet_(r[j]); });
    return o;
  });
  return { sh: sh, head: head, rows: rows };
}
function toRow_(name, o) {
  return headOf_(name).map(function (h) { return h ? cellPut_(o[h]) : ''; });
}
function appendRows_(name, objs) {
  if (!objs.length) return;
  const sh = sheet_(name);
  const head = headOf_(name, sh);
  const start = sh.getLastRow() + 1;
  ensureGrid_(sh, start + objs.length - 1, head.length);
  // เก็บเป็นข้อความเสมอ — กัน "121/2569" หรือ "2026-11-01" ถูกแปลงเป็นวันที่/ตัวเลข
  sh.getRange(start, 1, objs.length, head.length).setNumberFormat('@')
    .setValues(objs.map(function (o) { return toRow_(name, o); }));
}
function updateRow_(name, rowNo, o) {
  const sh = sheet_(name);
  const head = headOf_(name, sh);
  sh.getRange(rowNo, 1, 1, head.length).setNumberFormat('@').setValues([toRow_(name, o)]);
}

/* ---------- ค่าตั้ง (CONFIG) — อ่านครั้งเดียวต่อคำขอ ---------- */
let CFG_CACHE_ = null;
function cfg_(key, dflt) {
  if (!CFG_CACHE_) {
    CFG_CACHE_ = {};
    try { readTable_('CONFIG').rows.forEach(function (r) { CFG_CACHE_[r.key] = r.value; }); } catch (e) {}
  }
  const v = CFG_CACHE_[key];
  return (v === undefined || v === '') ? dflt : v;
}
function cfgNum_(key, dflt) { const n = Number(cfg_(key, dflt)); return isFinite(n) ? n : dflt; }

/* ---------- เวลา (ไทย) ---------- */
function now_() { return Utilities.formatDate(new Date(), 'Asia/Bangkok', "yyyy-MM-dd'T'HH:mm:ss"); }
function newId_(prefix) {
  return prefix + '-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyMMddHHmmss') + '-' +
         Utilities.getUuid().slice(0, 4).toUpperCase();
}

/* ---------- Audit ---------- */
function audit_(code, action, target, detail) {
  try {
    appendRows_('AUDIT', [{ at: now_(), user_code: code || '', action: action, target: target || '',
                            detail: typeof detail === 'string' ? detail : JSON.stringify(detail || {}) }]);
  } catch (e) { /* ไม่ให้ audit ทำให้งานหลักล้ม */ }
}

/* ---------- จำกัดอัตราคำขอ (กันไล่เดา) ---------- */
function rateLimit_(bucket, max, seconds) {
  const c = CacheService.getScriptCache();
  const k = 'RL_' + bucket + '_' + Math.floor(Date.now() / (seconds * 1000));
  const n = Number(c.get(k) || 0) + 1;
  c.put(k, String(n), seconds + 5);
  if (n > max) throw appErr_('BUSY', 'มีการเรียกใช้งานถี่เกินไป กรุณารอสักครู่');
}

/* ---------- ตัดข้อความ ---------- */
function str_(v, max) { return String(v === null || v === undefined ? '' : v).trim().slice(0, max || 200); }

/** Grow grids before additive migrations and journal writes; preserve all existing cells. */
function ensureGrid_(sh, rows, cols) {
  if (sh.getMaxRows && sh.insertRowsAfter && sh.getMaxRows() < rows) sh.insertRowsAfter(sh.getMaxRows(), rows - sh.getMaxRows());
  if (sh.getMaxColumns && sh.insertColumnsAfter && sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
}
