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
