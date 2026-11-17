/**
 * ============================================================================
 *  ระบบค่าหมาย · ไฟล์ Users.gs
 *  หน้าที่ : ผู้ใช้และสิทธิ์ (ผูกบัญชี PrintHub) · ผู้ส่งหมาย 10 คน · อัตรา · ค่าตั้ง
 * ============================================================================
 */

/* ---------- รายชื่อบัญชี PrintHub + สิทธิ์ในระบบนี้ (ผู้ดูแล) ---------- */
function apiUsersList_(ctx) {
  const x = phRead_();
  const mine = {};
  readTable_('USERS').rows.forEach(function (r) { mine[String(r.user_code)] = r; });
  const admins = adminCodes_();
  const out = x.rows.map(function (r) { return phParse_(r, x.map); })
    .filter(function (u) { return u.code; })
    .map(function (u) {
      const m = mine[u.code] || {};
      return { code: u.code, name: u.name, dept: u.dept, ph_active: u.active, has_pin: u.hasPin,
               must_change: u.mustChg,
               roles: String(m.roles || '').split(',').map(function (s) { return s.trim(); }).filter(String),
               boot_admin: admins.indexOf(u.code) >= 0,
               officer_id: String(m.officer_id || ''), active: m.user_code ? String(m.active).toUpperCase() !== 'FALSE' : false,
               last_login: m.last_login ? String(m.last_login) : '' };
    });
  return { users: out, roles: ROLES.map(function (r) { return { code: r, th: ROLE_TH[r] }; }) };
}

function apiUserSave_(ctx, d) {
  const code = str_(d.code, 20);
  if (!code || !phAccount_(code)) throw appErr_('BAD_REQUEST', 'ไม่พบบัญชีนี้ในปริ้นฮับ');
  const roles = (Array.isArray(d.roles) ? d.roles : []).map(function (r) { return String(r).toUpperCase(); })
    .filter(function (r) { return ROLES.indexOf(r) >= 0; });
  const officerId = str_(d.officer_id, 10);
  if (roles.indexOf('COURIER') >= 0 && !officerId) throw appErr_('BAD_REQUEST', 'บทบาทเจ้าหน้าที่ส่งหมายต้องเลือกชื่อผู้ส่งที่ผูกด้วย');
  if (officerId && !readTable_('OFFICERS').rows.some(function (o) { return o.officer_id === officerId; }))
    throw appErr_('BAD_REQUEST', 'ไม่พบรหัสผู้ส่ง ' + officerId);

  const ph = phAccount_(code);
  const t = readTable_('USERS');
  let row = null;
  t.rows.forEach(function (r) { if (String(r.user_code) === code) row = r; });
  const obj = { user_code: code, full_name: ph.name, dept: ph.dept, roles: roles.join(','), officer_id: officerId,
                active: d.active !== false, last_login: row ? row.last_login : '', updated_by: ctx.user.code, updated_at: now_() };
  if (row) updateRow_('USERS', row._r, obj); else appendRows_('USERS', [obj]);

  // ผูกรหัส PrintHub ไว้ที่ผู้ส่งด้วย (ให้ข้อมูลตรงกันสองทาง)
  if (officerId) {
    const ot = readTable_('OFFICERS');
    ot.rows.forEach(function (o) {
      if (o.officer_id === officerId && o.printhub_code !== code) { o.printhub_code = code; o.updated_at = now_(); updateRow_('OFFICERS', o._r, o); }
    });
  }
  audit_(ctx.user.code, 'USER_SAVE', code, { roles: roles, officer_id: officerId, active: obj.active });
  return { ok: true };
}

/* ---------- ผู้ส่งหมาย ---------- */
function officersAll_() {
  return readTable_('OFFICERS').rows.map(function (o) {
    return { officer_id: o.officer_id, maplibre_id: o.maplibre_id, first_name: o.first_name, last_name: o.last_name,
             name: String(o.first_name || '').trim(), full_name: (o.first_name + ' ' + (o.last_name || '')).trim(), name_aliases: o.name_aliases,
             printhub_code: o.printhub_code, active: String(o.active).toUpperCase() !== 'FALSE', color: o.color };
  });
}
function apiOfficersList_(ctx) {
  const areas = readTable_('RATE_AREAS').rows;
  return { officers: officersAll_().map(function (o) {
    const mine = areas.filter(function (a) { return a.officer_id === o.officer_id; });
    o.tambon_count = mine.length;
    o.amphoes = Array.from(new Set(mine.map(function (a) { return a.amphoe_name; }))).join(' / ');
    return o;
  }) };
}
function apiOfficerSave_(ctx, d) {
  const id = str_(d.officer_id, 10);
  const t = readTable_('OFFICERS');
  const o = t.rows.filter(function (r) { return r.officer_id === id; })[0];
  if (!o) throw appErr_('BAD_REQUEST', 'ไม่พบผู้ส่ง ' + id);
  o.first_name = str_(d.first_name, 60) || o.first_name;
  o.last_name = str_(d.last_name, 60);
  o.name_aliases = str_(d.name_aliases, 300);
  o.printhub_code = str_(d.printhub_code, 20);
  o.active = d.active !== false;
  o.updated_at = now_();
  updateRow_('OFFICERS', o._r, o);
  audit_(ctx.user.code, 'OFFICER_SAVE', id, { last_name: o.last_name, aliases: o.name_aliases });
  return { ok: true };
}

/* ---------- อัตรา (อ่านอย่างเดียวในระยะนี้) ---------- */
function apiRatesList_(ctx) {
  const off = {};
  officersAll_().forEach(function (o) { off[o.officer_id] = o.name; });
  return {
    areas: readTable_('RATE_AREAS').rows.map(function (r) {
      return { area_id: r.area_id, amphoe_name: r.amphoe_name, tambon_name: r.tambon_name,
               officer: off[r.officer_id] || '', rate: Number(r.rate), effective_from: String(r.effective_from), source: r.source };
    }),
    budget: readTable_('RATE_BUDGET').rows.map(function (r) {
      return { amphoe_name: r.amphoe_name, rate: Number(r.rate), effective_from: String(r.effective_from), source: r.source };
    })
  };
}

/* ---------- ค่าตั้ง (ผู้ดูแล · อ่านอย่างเดียวในระยะนี้) ---------- */
function apiConfigList_(ctx) {
  return { config: readTable_('CONFIG').rows.map(function (r) { return { key: r.key, value: String(r.value), description: r.description }; }),
           rules: readTable_('CALC_RULES').rows.map(function (r) { return { rule_code: r.rule_code, mode: r.mode, description: r.description, doc_ref: r.doc_ref }; }) };
}

/* ---------- 0.7.17 ประวัติการใช้งาน (AUDIT) · ผู้ดูแลเท่านั้น · อ่านอย่างเดียว ยกเว้นล้างบันทึกเข้า/ออกระบบที่เกินระยะเก็บ ---------- */
const AUDIT_GROUPS_ = {
  LOGIN:  { th: 'เข้า/ออกระบบ', test: function (a) { return a === 'LOGIN' || a === 'LOGOUT'; } },
  IMPORT: { th: 'นำเข้า/ตรวจข้อมูล', test: function (a) { return a === 'IMPORT' || a === 'CALC' || a === 'NOTICE_SPLIT' || /^REVIEW_/.test(a) || /^DATE_OK_/.test(a); } },
  MONEY:  { th: 'รอบเบิก/การจ่ายเงิน', test: function (a) { return /^PAYOUT_/.test(a) || /^ROUND_PAYMENT/.test(a) || /^LEDGER_/.test(a); } },
  ADMIN:  { th: 'ผู้ใช้/ตั้งค่า/ระบบ', test: function (a) { return /^(USER_SAVE|OFFICER_SAVE|SCHEMA_UPGRADE|SYSTEM)$/.test(a) || /PRIVACY|^ADMIN_/.test(a); } },
  ERROR:  { th: 'ข้อผิดพลาด', test: function (a) { return a === 'ERROR'; } }
};
const AUDIT_ACTION_TH_ = { LOGIN: 'เข้าระบบ', LOGOUT: 'ออกจากระบบ', IMPORT: 'นำเข้าไฟล์', CALC: 'คำนวณยอด', NOTICE_SPLIT: 'แยกฉบับ',
  PAYOUT_CONFIRM: 'ยืนยันรอบ', PAYOUT_CANCEL: 'ยกเลิกรอบ', ROUND_PAYMENT: 'บันทึกจ่ายจริง', ROUND_PAYMENT_BULK: 'บันทึกจ่ายจริงหลายรอบ',
  LEDGER_PAY: 'บัญชีจ่ายเงิน', LEDGER_OUTSIDE: 'บันทึกแบ่งนอกระบบ', LEDGER_OUTSIDE_UNDO: 'ยกเลิกแบ่งนอกระบบ',
  USER_SAVE: 'แก้ผู้ใช้/สิทธิ์', OFFICER_SAVE: 'แก้ผู้ส่งหมาย', SCHEMA_UPGRADE: 'ปรับโครงสร้างฐาน', SYSTEM: 'ระบบ', ERROR: 'ข้อผิดพลาด' };
function auditGroupOf_(a) { const k = Object.keys(AUDIT_GROUPS_).filter(function (g) { return AUDIT_GROUPS_[g].test(a); })[0]; return k || 'OTHER'; }
function auditDay_(v) { const s = String(v || ''); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); const d = new Date(v); return isNaN(d) ? '' : Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd'); }
function auditStamp_(v) { const s = String(v || ''); if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 19); const d = new Date(v); return isNaN(d) ? s : Utilities.formatDate(d, 'Asia/Bangkok', "yyyy-MM-dd'T'HH:mm:ss"); }

/** ล้างเฉพาะบันทึกเข้า/ออกระบบที่เก่ากว่า AUDIT_LOGIN_KEEP_DAYS (ค่าเริ่มต้น 365 วัน) · ทำวันละครั้ง · บันทึกเงิน/นำเข้า/สิทธิ์ เก็บถาวร */
function auditPurge_(userCode, todayIso) {
  const today = todayIso || now_().slice(0, 10);
  if (String(cfg_('AUDIT_PURGED_AT', '')).slice(0, 10) === today) return { removed: 0, skipped: true };
  const keep = Math.max(30, cfgNum_('AUDIT_LOGIN_KEEP_DAYS', 365));
  const cut = new Date(today + 'T00:00:00Z'); cut.setUTCDate(cut.getUTCDate() - keep);
  const cutIso = cut.toISOString().slice(0, 10);
  const lock = writeLock_();
  try { lock.waitLock(20000); } catch (e) { return { removed: 0, skipped: true }; }
  try {
    const t = readTable_('AUDIT'), sh = sheet_('AUDIT'), head = headOf_('AUDIT');
    const drop = t.rows.filter(function (r) { const a = String(r.action || ''); return (a === 'LOGIN' || a === 'LOGOUT') && auditDay_(r.at) && auditDay_(r.at) < cutIso; });
    if (drop.length) {
      const keepRows = t.rows.filter(function (r) { return drop.indexOf(r) < 0; });
      const n = t.rows.length;
      if (keepRows.length) sh.getRange(2, 1, keepRows.length, head.length).setValues(keepRows.map(function (r) { return toRow_('AUDIT', r); }));
      sh.getRange(2 + keepRows.length, 1, n - keepRows.length, head.length).clearContent();
    }
    setCfg_('AUDIT_PURGED_AT', today);
    if (drop.length) audit_(userCode, 'SYSTEM', 'AUDIT', 'ล้างบันทึกเข้า/ออกระบบที่เก่ากว่า ' + keep + ' วัน ' + drop.length + ' รายการ');
    return { removed: drop.length, keep_days: keep, cut: cutIso };
  } finally { lock.releaseLock(); }
}

function apiAuditList_(ctx, d) {
  d = d || {};
  const purge = auditPurge_(ctx.user.code);
  const today = now_().slice(0, 10);
  const def = new Date(today + 'T00:00:00Z'); def.setUTCDate(def.getUTCDate() - 30);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(d.from || '')) ? String(d.from) : def.toISOString().slice(0, 10);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(d.to || '')) ? String(d.to) : today;
  const group = AUDIT_GROUPS_[d.group] || d.group === 'OTHER' ? String(d.group) : 'ALL';
  const user = str_(d.user, 40), q = str_(d.q, 60).toLowerCase();
  const limit = Math.min(500, Math.max(20, Number(d.limit) || 300));
  const names = {};
  try { readTable_('USERS').rows.forEach(function (u) { names[String(u.user_code)] = String(u.full_name || ''); }); } catch (e) {}
  const inRange = readTable_('AUDIT').rows.map(function (r) {
    const a = String(r.action || '');
    return { at: auditStamp_(r.at), day: auditDay_(r.at), user_code: String(r.user_code || ''), action: a, group: auditGroupOf_(a),
             target: String(r.target || '').slice(0, 120), detail: String(r.detail || '').slice(0, 300) };
  }).filter(function (r) { return r.day && r.day >= from && r.day <= to; });
  const counts = {}; Object.keys(AUDIT_GROUPS_).concat(['OTHER']).forEach(function (g) { counts[g] = 0; });
  const per = {};
  inRange.forEach(function (r) {
    if (!user || r.user_code === user) counts[r.group]++;
    if (r.action === 'LOGIN' && r.user_code) {
      const p = per[r.user_code] || (per[r.user_code] = { user_code: r.user_code, name: names[r.user_code] || '', ok: 0, fail: 0, last_ok: '' });
      if (/^สำเร็จ/.test(r.detail)) { p.ok++; if (r.at > p.last_ok) p.last_ok = r.at; } else p.fail++;
    }
  });
  const rows = inRange.filter(function (r) {
    return (group === 'ALL' || r.group === group) && (!user || r.user_code === user) &&
      (!q || (r.action + ' ' + r.target + ' ' + r.detail).toLowerCase().indexOf(q) >= 0);
  }).sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
  return {
    from: from, to: to, group: group, user: user, total: rows.length, truncated: rows.length > limit,
    rows: rows.slice(0, limit).map(function (r) { return Object.assign({ user_name: names[r.user_code] || '', action_th: AUDIT_ACTION_TH_[r.action] || r.action }, r); }),
    counts: counts, groups: Object.keys(AUDIT_GROUPS_).map(function (g) { return { id: g, th: AUDIT_GROUPS_[g].th }; }).concat([{ id: 'OTHER', th: 'อื่น ๆ' }]),
    per_user: Object.keys(per).map(function (k) { return per[k]; }).sort(function (a, b) { return a.last_ok < b.last_ok ? 1 : -1; }),
    users: Object.keys(names).map(function (k) { return { code: k, name: names[k] }; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; }),
    keep_days: Math.max(30, cfgNum_('AUDIT_LOGIN_KEEP_DAYS', 365)), purged: purge.removed || 0
  };
}
