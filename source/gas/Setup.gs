/**
 * ============================================================================
 *  ระบบค่าหมาย · ไฟล์ Setup.gs
 *  หน้าที่ : ติดตั้งครั้งแรก — สร้างไฟล์ฐานข้อมูล ชีต หัวคอลัมน์ และข้อมูลตั้งต้น
 * ----------------------------------------------------------------------------
 *  วิธีใช้ : เปิดโปรเจกต์ Apps Script → เลือกฟังก์ชัน setupSystem → Run (ครั้งเดียว)
 *  รันซ้ำได้ปลอดภัย : สร้างเฉพาะชีตที่ยังไม่มี · เติมข้อมูลตั้งต้นเฉพาะชีตที่ว่าง
 *  ไม่แตะข้อมูลที่มีอยู่แล้ว และไม่เขียนอะไรลงฐาน PrintHub
 * ============================================================================
 */

const PRINTHUB_DB_DEFAULT = '1mLJm9FRDq3QBmhNa725ksfqi5Ns4UTKi4hiE-VEA_pM';

function setupSystem() {
  try { PropertiesService.getScriptProperties().setProperty('DATA_VER', String(Date.now())); } catch (e) { /* ไม่สำคัญ */ }
  let ss;
  const id = prop_('DB_ID');
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('ระบบค่าหมาย · ฐานข้อมูล');
    setProp_('DB_ID', ss.getId());
  }
  DB_CACHE_ = ss;

  Object.keys(SHEETS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const head = SHEETS[name];
    ensureGrid_(sh, 1, head.length);
    const cur = sh.getRange(1, 1, 1, head.length).getValues()[0];
    if (cur.join('') === '') {
      sh.getRange(1, 1, 1, head.length).setValues([head])
        .setFontWeight('bold').setBackground('#DDF0E2').setFontColor('#1D3A2C');
      sh.setFrozenRows(1);
    } else {
      // อัปเกรดรุ่น: เพิ่มคอลัมน์ใหม่ต่อท้าย (ไม่ย้าย/ไม่ลบคอลัมน์เดิม)
      const have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
      const miss = head.filter(function (h) { return have.indexOf(h) < 0; });
      if (miss.length) ensureGrid_(sh, 1, have.length + miss.length);
      if (miss.length) sh.getRange(1, have.length + 1, 1, miss.length).setValues([miss])
        .setFontWeight('bold').setBackground('#DDF0E2').setFontColor('#1D3A2C');
    }
  });
  HEAD_CACHE_ = {};
  const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('แผ่น1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);

  // เก็บเลขคดี/เลขหมาย/บ้านเลขที่/หมู่ เป็นข้อความ (กัน 121/2569 กลายเป็นวันที่)
  const nsh = ss.getSheetByName('NOTICES');
  const nh = nsh.getRange(1, 1, 1, Math.max(nsh.getLastColumn(), 1)).getValues()[0].map(String);
  ['notice_uid', 'case_no', 'case_ref', 'red_no', 'notice_no', 'house_no', 'moo', 'area_id',
   'issued_date', 'delivered_date', 'reported_date', 'amount_src', 'rate_ref']
    .forEach(function (c) {
      const col = nh.indexOf(c) + 1;
      if (!col) return;
      ss.getSheetByName('NOTICES').getRange(1, col, ss.getSheetByName('NOTICES').getMaxRows(), 1).setNumberFormat('@');
    });

  seedIfEmpty_('CONFIG', CONFIG_DEFAULTS.map(function (r) { return { key: r[0], value: r[1], description: r[2] }; }));
  (function () {                                                    // ค่าตั้งต้นที่เพิ่มในรุ่นหลัง: เติมเฉพาะคีย์ที่ยังไม่มี
    const have = {}; readTable_('CONFIG').rows.forEach(function (r) { have[r.key] = true; });
    const add = CONFIG_DEFAULTS.filter(function (r) { return !have[r[0]]; }).map(function (r) { return { key: r[0], value: r[1], description: r[2] }; });
    if (add.length) appendRows_('CONFIG', add);
  })();
  seedIfEmpty_('CALC_RULES', CALC_RULES_DEFAULTS.map(function (r) {
    return { rule_code: r[0], mode: r[1], description: r[2], effective_from: r[3], approved_by: r[4], doc_ref: r[5] };
  }));
  // กฎที่เพิ่มในรุ่นหลัง: เติมเฉพาะรหัสที่ยังไม่มี (ไม่แก้ค่าที่ผู้ดูแลตั้งไว้)
  (function () {
    const have = {}; readTable_('CALC_RULES').rows.forEach(function (r) { have[r.rule_code] = true; });
    const add = CALC_RULES_DEFAULTS.filter(function (r) { return !have[r[0]]; }).map(function (r) {
      return { rule_code: r[0], mode: r[1], description: r[2], effective_from: r[3], approved_by: r[4], doc_ref: r[5] };
    });
    if (add.length) appendRows_('CALC_RULES', add);
  })();
  seedIfEmpty_('OFFICERS', OFFICERS_SEED.map(function (r) {
    return { officer_id: r[0], maplibre_id: r[1], first_name: r[2], last_name: r[3], name_aliases: r[4],
             printhub_code: r[5], active: true, color: r[6], updated_at: now_() };
  }));
  seedIfEmpty_('RATE_AREAS', RATES_SEED.map(function (r) {
    return { area_id: r[0], amphoe_code: r[0].slice(0, 4), amphoe_name: AMPHOE_NAMES[r[0].slice(0, 4)],
             tambon_name: r[1], officer_id: r[2], rate: r[3], effective_from: RATE_EFFECTIVE, source: RATE_SOURCE };
  }));
  seedIfEmpty_('RATE_BUDGET', RATE_BUDGET_SEED.map(function (r) {
    return { amphoe_code: r[0], amphoe_name: r[1], rate: r[2], effective_from: r[3], source: r[4] };
  }));

  // ค่าที่เพิ่มในรุ่นหลัง (ติดตั้งทับของเดิม) + ปีงบเริ่มประมวลผล = ปีงบปัจจุบัน
  const cfgRows = readTable_('CONFIG').rows;
  const haveKey = {}; cfgRows.forEach(function (r) { haveKey[r.key] = r; });
  CONFIG_DEFAULTS.forEach(function (d) { if (!haveKey[d[0]]) appendRows_('CONFIG', [{ key: d[0], value: d[1], description: d[2] }]); });
  const sf = readTable_('CONFIG').rows.filter(function (r) { return r.key === 'PROCESS_START_FY'; })[0];
  if (sf && !String(sf.value)) {
    sf.value = fiscalYear_(Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd'), 10);
    updateRow_('CONFIG', sf._r, sf);
  }

  if (!prop_('PRINTHUB_DB_ID')) setProp_('PRINTHUB_DB_ID', PRINTHUB_DB_DEFAULT);
  if (!prop_('ADMIN_CODES')) setProp_('ADMIN_CODES', 'U001');

  Logger.log('ติดตั้งเรียบร้อย · ฐานข้อมูล: ' + ss.getUrl());
  Logger.log('PRINTHUB_DB_ID = ' + prop_('PRINTHUB_DB_ID') + ' · ADMIN_CODES = ' + prop_('ADMIN_CODES') + ' · เริ่มประมวลผลปีงบ ' + (sf ? sf.value : ''));
  return ss.getUrl();
}

function seedIfEmpty_(name, objs) {
  const sh = sheet_(name);
  if (sh.getLastRow() > 1) return;
  appendRows_(name, objs);
}

/** เมนูในชีต (กรณีผูกสคริปต์กับชีต) */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('ระบบค่าหมาย')
      .addItem('① ติดตั้ง/ตรวจโครงสร้างชีต', 'setupSystem')
      .addToUi();
  } catch (e) {}
}

/** อัปเกรดโครงสร้างอัตโนมัติ: ครั้งแรกที่มีการเรียกหลังขึ้นรุ่นใหม่ — รัน setupSystem + คำนวณใหม่ (ไม่ต้องกด Run ในหน้า Apps Script) */
function ensureSchema_() {
  if (prop_('SCHEMA_VER') === SCHEMA_VERSION) return;
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { throw appErr_('BUSY', 'ระบบกำลังอัปเกรดโครงสร้าง กรุณาลองใหม่ในอีกสักครู่'); }
  try {
    if (prop_('SCHEMA_VER') === SCHEMA_VERSION) return;
    setupSystem();
    migrate_(prop_('SCHEMA_VER') || '');
    // Preserve verified amounts during additive 0.7.0 migration.
    if (!prop_('SCHEMA_VER') || prop_('SCHEMA_VER') < '0.6.3') calcRunCore_('SYSTEM');
    setProp_('SCHEMA_VER', SCHEMA_VERSION);
    audit_('SYSTEM', 'SCHEMA_UPGRADE', SCHEMA_VERSION, {});
  } finally { lock.releaseLock(); }
}

/** ปรับค่าตั้งต้นเดิมตามข้อตกลงใหม่ (ทำครั้งเดียวต่อรุ่น — ไม่ทับค่าที่ผู้ดูแลแก้เอง) */
function migrate_(from) {
  CFG_CACHE_ = null;
  if (from < '0.6.0') {
    // 0.6.0: ใบแบ่งยอดของศาลปัดลงเป็นบาท เศษยกไป · คนนั่งงาน 48 คน (ใบ 30 ต.ค. 2569)
    if (cfg_('ROUNDING_POLICY', '') === 'DOWN_SATANG_CARRY') setCfg_('ROUNDING_POLICY', 'DOWN_BAHT_CARRY');
    if (cfg_('DEFAULT_SEATS', '') === '50') setCfg_('DEFAULT_SEATS', '48');
  }
  if (from && from < '0.6.3') {
    // 0.6.3: กฎจับคู่ผลหมายใหม่ (เลือกฉบับจากผลการส่ง · แถวซ้ำ) → ลองจับคู่แถวรอตรวจที่ค้างอยู่ให้ทันที
    try { reviewRetry_('SYSTEM'); } catch (e) { audit_('SYSTEM', 'REVIEW_RETRY_ERROR', '', { msg: String(e && e.message || e) }); }
  }
}
