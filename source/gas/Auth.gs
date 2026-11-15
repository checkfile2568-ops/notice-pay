/**
 * ============================================================================
 *  ระบบค่าหมาย · ไฟล์ Auth.gs
 *  หน้าที่ : ค้นชื่อ · ตรวจ PIN กับบัญชี PrintHub (อ่านอย่างเดียว) · session · บทบาท
 * ----------------------------------------------------------------------------
 *  รูปแบบเดียวกับระบบเบิกวัสดุ (Auth.gs ฉบับ 1.1.2)
 *   • อ่านชีต USERS ของ PrintHub (Script Property: PRINTHUB_DB_ID) — ไม่เขียนกลับ
 *   • หาคอลัมน์จากชื่อหัว (ไม่พบใช้ลำดับเดิมของ PrintHub)
 *   • PIN = base64(SHA-256(salt|PIN|PrintHub)) สูตรเดียวกับ PrintHub
 *   • นับ PIN ผิด/ล็อก เฉพาะระบบนี้ (Script Properties: PINF_<รหัส>)
 *   • PrintHub ล็อก / ปิดใช้งาน / ต้องเปลี่ยนรหัส → เข้าไม่ได้ จนกว่าจะแก้ที่ PrintHub
 *   • บทบาทของระบบนี้เก็บในชีต USERS ของระบบค่าหมาย (หลายบทบาทได้)
 *   • ADMIN_CODES (Script Property) = รหัสผู้ดูแลตั้งต้น เช่น U001
 * ============================================================================
 */

/* ---------------------------------------------------------------- PrintHub (อ่านอย่างเดียว) */
function phSheet_() {
  const id = prop_('PRINTHUB_DB_ID');
  if (!id) throw appErr_('ACCOUNTS_UNAVAILABLE', 'ยังไม่ได้เชื่อมบัญชีผู้ใช้ — ผู้ดูแลต้องตั้งค่า PRINTHUB_DB_ID');
  let ss;
  try { ss = SpreadsheetApp.openById(id); }
  catch (e) { throw appErr_('ACCOUNTS_UNAVAILABLE', 'เชื่อมฐานข้อมูลบัญชีผู้ใช้ไม่ได้ ติดต่อผู้ดูแลระบบ'); }
  const sh = ss.getSheetByName('USERS');
  if (!sh) throw appErr_('ACCOUNTS_UNAVAILABLE', 'ไม่พบรายชื่อบัญชีผู้ใช้ ติดต่อผู้ดูแลระบบ');
  return sh;
}

function phMap_(head) {
  const h = head.map(function (x) { return String(x).trim().toLowerCase(); });
  const m = { width: Math.max(PH_COLS, h.length) };
  Object.keys(PH).forEach(function (k) {
    let at = -1;
    (PH_HEADS[k] || []).some(function (name) { at = h.indexOf(name.toLowerCase()); return at >= 0; });
    m[k] = at >= 0 ? at : PH[k];
  });
  return m;
}

/** อ่านทั้งชีตครั้งเดียวต่อคำขอ */
let PH_CACHE_ = null;
function phRead_() {
  if (PH_CACHE_) return PH_CACHE_;
  const sh = phSheet_();
  const last = sh.getLastRow();
  const width = Math.max(PH_COLS, sh.getLastColumn());
  const head = sh.getRange(1, 1, 1, width).getValues()[0];
  const map = phMap_(head);
  const rows = last > 1 ? sh.getRange(2, 1, last - 1, width).getValues() : [];
  PH_CACHE_ = { map: map, rows: rows };
  return PH_CACHE_;
}

function phParse_(r, m) {
  const act = r[m.ACTIVE];
  const lock = r[m.LOCK] ? new Date(r[m.LOCK]).getTime() : 0;
  const first = String(cellGet_(r[m.FIRST])).trim();
  const last = String(cellGet_(r[m.LAST])).trim();
  return {
    code: String(r[m.CODE]).trim(),
    first: first, last: last, name: (first + ' ' + last).trim(),
    dept: String(cellGet_(r[m.DEPT])).trim(),
    active: act === true || String(act).toUpperCase() === 'TRUE',
    hasPin: !!String(cellGet_(r[m.HASH])),
    mustChg: r[m.MUSTCHG] === true || String(r[m.MUSTCHG]).toUpperCase() === 'TRUE',
    phLock: isFinite(lock) ? lock : 0
  };
}

function phAccount_(code) {
  const x = phRead_();
  for (let i = 0; i < x.rows.length; i++) {
    const r = x.rows[i];
    if (String(r[x.map.CODE]).trim() !== code) continue;
    const o = phParse_(r, x.map);
    o.hash = String(cellGet_(r[x.map.HASH]));
    o.salt = String(cellGet_(r[x.map.SALT]));
    return o;
  }
  return null;
}

function hashPin_(pin, salt) {
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + pin + '|PrintHub'));
}
function credentialVersion_(ph) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify([String(ph.hash || ''), String(ph.salt || '')])));
}

/* ---------------------------------------------------------------- นับ PIN ผิด (ของระบบนี้) */
function pinFail_(code) {
  try {
    const o = JSON.parse(prop_('PINF_' + code) || 'null');
    if (o) return { n: Number(o.n) || 0, until: Number(o.until) || 0 };
  } catch (e) {}
  return { n: 0, until: 0 };
}
function setPinFail_(code, o) {
  const p = PropertiesService.getScriptProperties();
  if (!o) p.deleteProperty('PINF_' + code); else p.setProperty('PINF_' + code, JSON.stringify(o));
}

/* ---------------------------------------------------------------- บทบาทของระบบนี้ */
function adminCodes_() {
  return prop_('ADMIN_CODES').split(',').map(function (s) { return s.trim(); }).filter(String);
}
function userRow_(code) {
  const t = readTable_('USERS');
  for (let i = 0; i < t.rows.length; i++) if (String(t.rows[i].user_code) === code) return t.rows[i];
  return null;
}
function rolesOf_(code, urow) {
  const set = {};
  if (urow && String(urow.active).toUpperCase() !== 'FALSE') {
    String(urow.roles || '').split(',').forEach(function (r) {
      r = r.trim().toUpperCase(); if (ROLES.indexOf(r) >= 0) set[r] = true;
    });
  }
  if (adminCodes_().indexOf(code) >= 0) set.ADMIN = true;
  return ROLES.filter(function (r) { return set[r]; });
}

/* ---------------------------------------------------------------- 1) ค้นชื่อ */
function apiSearchAccounts_(ctx, d) {
  const q = str_(d.q, 40).replace(/\s+/g, ' ');
  if (q.length < 1) return { users: [] };
  rateLimit_('SEARCH', 300, 60);
  const x = phRead_();
  const ql = q.toLowerCase();
  const out = [];
  for (let i = 0; i < x.rows.length && out.length < 8; i++) {
    const u = phParse_(x.rows[i], x.map);
    if (!u.code || !u.active) continue;
    const hay = (u.name + ' ' + u.last + ' ' + u.code).toLowerCase();
    if (hay.indexOf(ql) >= 0) out.push({ code: u.code, name: u.name, dept: u.dept });
  }
  return { users: out };
}

/* ---------------------------------------------------------------- 2) เข้าสู่ระบบ */
function apiLogin_(ctx, d) {
  const code = str_(d.code, 20);
  const pin = str_(d.pin, 10);
  if (!/^\d{4}$/.test(pin)) throw appErr_('BAD_PIN_FORMAT', 'PIN ต้องเป็นตัวเลข 4 หลัก');
  rateLimit_('LOGIN', 120, 60);

  const lock = writeLock_();
  try { lock.waitLock(10000); } catch (e) { throw appErr_('BUSY', 'ระบบไม่ว่าง ลองใหม่อีกครั้ง'); }
  try {
    const ph = code ? phAccount_(code) : null;
    if (!ph) throw appErr_('LOGIN_FAILED', 'ไม่พบบัญชีนี้');
    const nowMs = Date.now();
    if (!ph.active) { audit_(code, 'LOGIN', code, 'ปิดใช้งาน'); throw appErr_('ACCOUNT_DISABLED', 'บัญชีนี้ถูกปิดการใช้งาน ติดต่อผู้ดูแลระบบ'); }

    const f = pinFail_(code);
    if (f.until > nowMs) {
      const min = Math.ceil((f.until - nowMs) / 60000);
      throw appErr_('LOCKED', 'ใส่ PIN ผิดหลายครั้ง กรุณารออีก ' + min + ' นาที', { minutes: min });
    }
    if (ph.phLock > nowMs) {
      const min = Math.ceil((ph.phLock - nowMs) / 60000);
      throw appErr_('LOCKED', 'บัญชีนี้ถูกล็อกชั่วคราวที่ปริ้นฮับ กรุณารออีก ' + min + ' นาที', { minutes: min, source: 'PRINTHUB' });
    }
    if (!ph.hasPin) throw appErr_('NO_PIN', 'บัญชีนี้ยังไม่ได้ตั้ง PIN ติดต่อผู้ดูแลระบบ');

    if (hashPin_(pin, ph.salt) !== ph.hash) {
      const fail = f.n + 1;
      const max = cfgNum_('PIN_MAX_FAIL', 5);
      if (fail >= max) {
        const mins = cfgNum_('PIN_LOCK_MINUTES', 15);
        setPinFail_(code, { n: fail, until: nowMs + mins * 60000 });
        audit_(code, 'LOGIN', code, 'ล็อกบัญชี (ผิด ' + fail + ' ครั้ง)');
        throw appErr_('LOCKED', 'ใส่ PIN ผิด ' + max + ' ครั้ง ระบบล็อก ' + mins + ' นาที', { minutes: mins });
      }
      setPinFail_(code, { n: fail, until: 0 });
      audit_(code, 'LOGIN', code, 'PIN ผิด ' + fail);
      throw appErr_('LOGIN_FAILED', 'PIN ไม่ถูกต้อง เหลืออีก ' + (max - fail) + ' ครั้ง', { left: max - fail });
    }
    setPinFail_(code, null);

    if (ph.mustChg) throw appErr_('PIN_CHANGE_AT_PRINTHUB', 'บัญชีนี้ต้องตั้ง PIN ใหม่ที่ปริ้นฮับก่อน แล้วจึงใช้ PIN ใหม่เข้าระบบนี้');

    const urow = userRow_(code);
    const roles = rolesOf_(code, urow);
    if (!roles.length) {
      audit_(code, 'LOGIN', code, 'ไม่มีสิทธิ์');
      throw appErr_('NO_ACCESS', 'บัญชีนี้ยังไม่มีสิทธิ์ใช้ระบบค่าหมาย ติดต่อผู้ดูแลระบบ');
    }
    upsertUserOnLogin_(code, ph, urow);
    const sess = { code: code, name: ph.name, dept: ph.dept, roles: roles,
                   officer_id: urow ? String(urow.officer_id || '') : '', cv: credentialVersion_(ph) };
    const token = newSession_(sess);
    audit_(code, 'LOGIN', code, 'สำเร็จ ' + roles.join(','));
    return { token: token, user: publicUser_(sess) };
  } finally { lock.releaseLock(); }
}

function upsertUserOnLogin_(code, ph, urow) {
  if (urow) {
    urow.full_name = ph.name; urow.last_login = now_();
    if (!urow.dept) urow.dept = ph.dept;
    updateRow_('USERS', urow._r, urow);
  } else {
    // ผู้ดูแลตั้งต้น (ADMIN_CODES) ที่ยังไม่มีแถว
    appendRows_('USERS', [{ user_code: code, full_name: ph.name, dept: ph.dept, roles: 'ADMIN', officer_id: '',
                            active: true, last_login: now_(), updated_by: 'LOGIN', updated_at: now_() }]);
  }
}

function publicUser_(s) {
  return { code: s.code, name: s.name, dept: s.dept, roles: s.roles,
           roles_th: s.roles.map(function (r) { return ROLE_TH[r]; }), officer_id: s.officer_id || '' };
}

/* ---------------------------------------------------------------- Session */
function sessTtl_() { return Math.min(21600, Math.max(300, cfgNum_('SESSION_MINUTES', 30) * 60)); }
function newSession_(s) {
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase();
  s.iat = Date.now(); s.chk = Date.now();
  CacheService.getScriptCache().put('S_' + token, JSON.stringify(s), sessTtl_());
  return token;
}

function requireSession_(token) {
  token = String(token || '');
  if (!/^[0-9a-f]{64}$/.test(token)) throw appErr_('SESSION_EXPIRED', 'กรุณาเข้าสู่ระบบ');
  const cache = CacheService.getScriptCache();
  const raw = cache.get('S_' + token);
  if (!raw) throw appErr_('SESSION_EXPIRED', 'หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่');
  const s = JSON.parse(raw);

  const rv = cache.get('RV_' + s.code);
  if (rv && Number(rv) >= s.iat) { cache.remove('S_' + token); throw appErr_('SESSION_REVOKED', 'บัญชีนี้ถูกให้ออกจากระบบ กรุณาเข้าใหม่'); }

  // ตรวจซ้ำกับ PrintHub และบทบาท ทุก RECHECK_MINUTES
  const every = Math.max(1, Math.min(15, cfgNum_('RECHECK_MINUTES', 5))) * 60000;
  if (Date.now() - Number(s.chk || 0) > every) {
    const ph = phAccount_(s.code);
    if (!ph || !ph.active || ph.mustChg || credentialVersion_(ph) !== s.cv) {
      cache.remove('S_' + token);
      throw appErr_('SESSION_REVOKED', 'ข้อมูลบัญชีที่ปริ้นฮับเปลี่ยน กรุณาเข้าสู่ระบบใหม่');
    }
    const urow = userRow_(s.code);
    s.roles = rolesOf_(s.code, urow);
    s.officer_id = urow ? String(urow.officer_id || '') : '';
    if (!s.roles.length) { cache.remove('S_' + token); throw appErr_('NO_ACCESS', 'บัญชีนี้ถูกถอนสิทธิ์'); }
    s.chk = Date.now();
  }
  cache.put('S_' + token, JSON.stringify(s), sessTtl_());   // ต่ออายุ
  s.token = token;
  return s;
}

function hasRole_(s, roles) {
  if (!roles || !roles.length) return true;
  return s.roles.some(function (r) { return roles.indexOf(r) >= 0; });
}

function apiStatus_(ctx) { return { user: publicUser_(ctx.user) }; }
function apiLogout_(ctx) {
  CacheService.getScriptCache().remove('S_' + ctx.user.token);
  audit_(ctx.user.code, 'LOGOUT', ctx.user.code, '');
  return { ok: true };
}
