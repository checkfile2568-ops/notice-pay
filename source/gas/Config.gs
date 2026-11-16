/**
 * ============================================================================
 *  ระบบค่าหมาย · ไฟล์ Config.gs
 *  หน้าที่ : ค่าคงที่ โครงสร้างชีต และข้อมูลตั้งต้น (อัตรา 85 ตำบล · ผู้ส่ง 10 คน)
 * ----------------------------------------------------------------------------
 *  ศาลจังหวัดลพบุรี · ระยะ 1–3 (ตั้งค่า · เข้าใช้งาน · นำเข้า · คำนวณค่าหมาย) · รุ่น 0.4.0
 *  บัญชีเจ้าของ : checkfile2568@gmail.com
 * ============================================================================
 */

const API_VERSION = '0.7.10';
const SCHEMA_VERSION = '0.7.0';   // เปลี่ยนเมื่อเพิ่มชีต/คอลัมน์ → ระบบรัน setupSystem ให้เองครั้งแรกที่มีการเรียก
const APP_NAME    = 'ระบบบริหารจัดการค่าส่งคำคู่ความ ศาลจังหวัดลพบุรี';

/* ---------- บทบาทในระบบนี้ (1 บัญชีมีได้หลายบทบาท คั่นด้วย ,) ---------- */
const ROLES = ['NOTICE', 'CASE', 'FINANCE', 'COURIER', 'VIEWER', 'ADMIN'];
const ROLE_TH = {
  NOTICE : 'งานหมาย',
  CASE   : 'ส่วนบริหารจัดการคดี',
  FINANCE: 'การเงิน / ส่วนคลัง',
  COURIER: 'เจ้าหน้าที่ส่งหมาย',
  VIEWER : 'ดูสถิติ (ทุกคน)',
  ADMIN  : 'ผู้ดูแลระบบ'
};

/* ---------- โครงสร้างชีตในฐานข้อมูลระบบค่าหมาย ---------- */
const SHEETS = {
  CONFIG        : ['key', 'value', 'description'],
  USERS         : ['user_code', 'full_name', 'dept', 'roles', 'officer_id', 'active',
                   'last_login', 'updated_by', 'updated_at'],
  OFFICERS      : ['officer_id', 'maplibre_id', 'first_name', 'last_name', 'name_aliases',
                   'printhub_code', 'active', 'color', 'updated_at'],
  RATE_AREAS    : ['area_id', 'amphoe_code', 'amphoe_name', 'tambon_name', 'officer_id',
                   'rate', 'effective_from', 'source'],
  RATE_BUDGET   : ['amphoe_code', 'amphoe_name', 'rate', 'effective_from', 'source'],
  CALC_RULES    : ['rule_code', 'mode', 'description', 'effective_from', 'approved_by', 'doc_ref'],
  NOTICES       : ['notice_uid', 'fy', 'pay_type', 'case_no', 'case_ref', 'red_no', 'notice_no', 'notice_kind',
                   'recipient', 'house_no', 'moo', 'tambon', 'amphoe', 'area_id', 'address_text',
                   'addr_type', 'place_key', 'officer_id', 'officer_raw', 'issued_date', 'delivered_date',
                   'reported_date', 'result', 'amount_src', 'rate_ref', 'payer', 'status', 'flags', 'row_hash', 'result_hash',
                   'payout_round_id', 'budget_unit_id', 'locked', 'calc_amount', 'calc_rule', 'calc_note',
                   'first_batch', 'last_batch', 'created_at', 'updated_at',
                   'amount_ok_value', 'amount_ok_by', 'amount_ok_at', 'date_ok', 'date_ok_by', 'date_ok_at', 'claim_piece',
                   'court_amount', 'court_at', 'paid_amount', 'noclaim_reason', 'noclaim_by', 'noclaim_at'],
  BUDGET_UNITS  : ['unit_id', 'fy', 'officer_id', 'delivered_date', 'area_id', 'place_key', 'addr_type',
                   'rule_code', 'notice_count', 'sub_units', 'rate_base', 'multiplier', 'amount',
                   'notice_uids', 'case_list', 'status', 'payout_round_id', 'claim_ref', 'locked',
                   'rule_version', 'computed_at', 'created_at'],
  NOTICE_CHANGES: ['change_id', 'notice_uid', 'field', 'old_value', 'new_value', 'source',
                   'batch_id', 'status', 'created_by', 'created_at', 'decided_by', 'decided_at'],
  IMPORT_BATCHES: ['batch_id', 'kind', 'file_name', 'file_size', 'checksum', 'sheet_name',
                   'rows_total', 'n_new', 'n_same', 'n_changed', 'n_ambiguous', 'n_error',
                   'n_held', 'n_outside', 'status', 'imported_by', 'imported_at', 'note',
                   'period_from', 'period_to'],
  IMPORT_REVIEW : ['batch_id', 'row_no', 'class', 'reason', 'notice_uid', 'raw_json',
                   'resolved', 'resolved_by', 'resolved_at'],
  MAP_TEMPLATES : ['kind', 'name', 'mapping_json', 'key_fields', 'options_json',
                   'updated_by', 'updated_at'],
  PAYOUT_ROUNDS : ['round_id', 'fy', 'pay_date', 'cutoff_date', 'include_paid', 'include_budget', 'seat_count',
                   'rounding_policy', 'n_items', 'n_excluded', 'total_paid', 'total_budget', 'total', 'courier60',
                   'pool40', 'carry_in', 'pool_total', 'per_seat', 'paid_out', 'carry_out', 'extra_one', 'lines_json',
                   'status', 'note', 'created_by', 'created_at', 'cancelled_by', 'cancelled_at', 'cancel_reason',
                   'round_type', 'source_label', 'carry_note', 'payment_status', 'payment_date', 'payment_ref', 'payment_by', 'payment_at'],
  PAYOUT_ITEMS  : ['round_id', 'item_key', 'item_type', 'officer_id', 'amount', 'notice_uids', 'case_list',
                   'delivered_date', 'included', 'reason', 'created_at', 'notice_kind', 'tambon', 'reported_date', 'reference_amount'],
  LEDGER        : ['ledger_id', 'source', 'pay_date', 'officer_id', 'officer_raw', 'case_no', 'recipient', 'receipt_no',
                   'received_date', 'amount', 'notice_uids', 'match', 'batch_id', 'round_id', 'created_at'],
  OPERATIONS    : ['request_id', 'action', 'user_code', 'request_hash', 'status', 'result_json', 'error', 'created_at', 'updated_at'],
  OP_SNAPSHOTS  : ['request_id', 'table_name', 'seq', 'payload'],
  AUDIT         : ['at', 'user_code', 'action', 'target', 'detail']
};

/* ---------- ค่าตั้งต้นในชีต CONFIG ---------- */
const CONFIG_DEFAULTS = [
  ['FY_START_MONTH', '10', 'เดือนเริ่มปีงบประมาณ (ตุลาคม)'],
  ['FY_COUNT_BY', 'DELIVERED', 'นับหมายเข้าปีงบตามวันที่ส่ง (ไม่มีวันที่ส่งใช้วันจ่ายหมาย)'],
  ['SPLIT_COURIER', '0.60', 'ส่วนผู้ส่งหมาย (ข้อตกลงภายใน)'],
  ['SPLIT_POOL', '0.40', 'ส่วนกองกลางคนนั่ง (ข้อตกลงภายใน)'],
  ['ROUNDING_POLICY', 'DOWN_BAHT_CARRY', 'วิธีปัดเศษส่วนแบ่งคนนั่ง — ปัดลงเป็นบาท เศษยกไปรอบหน้า (ตามใบแบ่งยอดของศาล)'],
  ['SESSION_MINUTES', '30', 'อายุการเข้าใช้งาน (นาที) ต่ออายุเมื่อใช้งาน'],
  ['PIN_MAX_FAIL', '5', 'ใส่ PIN ผิดกี่ครั้งจึงล็อก (เฉพาะระบบนี้)'],
  ['PIN_LOCK_MINUTES', '15', 'ล็อกกี่นาที'],
  ['RECHECK_MINUTES', '5', 'ตรวจบัญชี PrintHub ซ้ำทุกกี่นาที (PIN เปลี่ยน → หลุด)'],
  ['IMPORT_MAX_ROWS', '20000', 'จำนวนแถวสูงสุดต่อไฟล์'],
  ['DEFAULT_SEATS', '48', 'จำนวนคนนั่งงาน (N) ล่าสุด — ระบบจำค่าที่ใช้ในรอบล่าสุดให้เอง แก้ได้ทุกรอบ (รอบเก่าไม่เปลี่ยน)'],
  ['OPENING_CARRY', '0', 'เศษยกมาตั้งต้น (บาท) ก่อนรอบแรกในระบบ'],
  ['PROCESS_START_FY', '', 'ปีงบประมาณ (พ.ศ.) ที่เริ่มประมวลผล — หมายที่จ่ายก่อน 1 ต.ค. ของปีงบนี้ไม่นำเข้า (ติดตั้งครั้งแรกตั้งเป็นปีงบปัจจุบันให้เอง)']
];

/* ---------- กฎรวมหมาย (ระยะ 3 ใช้คำนวณ — ตั้งค่าไว้ก่อน) ---------- */
const CALC_RULES_DEFAULTS = [
  ['FREE_SAME_CASE_SAME_MOO', 'ONE', 'หมายฟรี: คดีเดียว ผู้รับหลายคน หมู่เดียวกัน = 1 หมาย', '2019-05-01', '', 'ระเบียบ ก.บ.ศ. 2562 ข้อ 7(1)'],
  ['FREE_MULTI_CASE_SAME_ADDR', 'ONE', 'หมายฟรี: หลายคดี ที่อยู่เดียวกัน = 1 หมาย', '2019-05-01', '', 'ข้อ 7(2)'],
  ['FREE_MULTI_CASE_SAME_MOO', 'HALF', 'หมายฟรี: หลายคดี ต่างบ้าน หมู่เดียวกัน = หมายละกึ่งหนึ่ง (ทางเลือก ONE)', '2019-05-01', '', 'ข้อ 7(3)'],
  ['FREE_DIFF_MOO', 'FULL', 'หมายฟรี: ต่างหมู่ = เต็มอัตรา', '2019-05-01', '', 'ข้อ 7'],
  ['FREE_GROUP_KEY', 'officer+delivered_date+amphoe+tambon+moo', 'นิยาม "คราวเดียวกัน"', '2019-05-01', '', 'ข้อ 7'],
  ['FREE_MAX_RATE', '1000', 'หมายฟรี: อัตราสูงสุดต่อหมาย (บาท) — ตำบลที่อัตราเกินคิดเท่านี้ ตามบัญชีหมายฟรีของศาล · 0 = ไม่จำกัด', '2019-05-01', '', 'บัญชีจ่ายหมาย ประเภท 18 (ศาลจังหวัดลพบุรี)'],
  ['FREE_URBAN_GROUP', 'TAMBON', 'หมายฟรีที่อยู่ไม่มีหมู่ (เขตเมือง): TAMBON = ทั้งตำบลนับเป็นหมู่บ้านเดียวกัน (ตามบัญชีค่าใช้จ่ายของศาล) · ROAD = แยกตามถนน/ซอย', '2019-05-01', '', 'ข้อ 7(3) แนวปฏิบัติศาลจังหวัดลพบุรี'],
  ['PAID_SAME_HOUSE', 'ONE', 'หมายมีเงิน: ผู้รับหลายคน บ้านเลขที่เดียวกัน = รายเดียว', '2025-06-01', '', 'ประกาศศาลจังหวัดลพบุรี 2568'],
  ['PAID_DIFF_HOUSE', 'EACH', 'หมายมีเงิน: ต่างบ้านเลขที่ = แยกหมาย', '2025-06-01', '', 'ประกาศศาลจังหวัดลพบุรี 2568'],
  ['PAID_DIFF_KIND', 'EACH', 'หมายมีเงิน: หมายต่างประเภท = แยกหมาย', '2025-06-01', '', 'ประกาศศาลจังหวัดลพบุรี 2568']
];

/* ---------- ผู้ส่งหมาย 10 คน (จากระบบเขตพื้นที่ MapLibre · นามสกุลตามบัญชีจ่ายหมายของศาล) ---------- */
const OFFICERS_SEED = [
  // officer_id, maplibre_id, first_name, last_name, aliases, printhub_code, color
  ['OF01', 'legacy-jampai',             'อำไพพรรณ', 'วงศ์ตา', '', '', '#49c551'],
  ['OF02', 'legacy-gomol',              'โกมล',     'ไผ่งาม', '', 'U006', '#9449c5'],
  ['OF03', 'legacy-nawaparat',          'นวพรรษ',   'เพชรรุ่ง', '', '', '#c54959'],
  ['OF04', 'staff-1787907600-3',        'สุพัตรา',   'ฉัตรเงิน', '', '', '#608f24'],
  ['OF05', 'staff-1784987702700-q10g5', 'ชนินทร์',   'โพธิ์ศรี', '', '', '#499cc5'],
  ['OF06', 'legacy-boy',                'ถนิจ',      'มีทรัพย์', '', '', '#248f6f'],
  ['OF07', 'legacy-patcharin',          'พัชรินทร์', 'อ่อนสำอางค์', '', '', '#c5ad49'],
  ['OF08', 'staff-1784993803984-w6gmn', 'ณรงค์',     'นวลอินทร์', '', '', '#8f3624'],
  ['OF09', 'staff-1787907600-8',        'วรางคณา',  'กรีโสภา', '', '', '#24278f'],
  ['OF10', '',                          'ชุตาภรณ์',  'สุขเจริญ', '', '', '#8f2470']   // รหัส MapLibre รอเติม
];

/* ---------- อัตรารายตำบล · ประกาศศาลจังหวัดลพบุรี 2568 (เริ่มใช้ 1 มิ.ย. 2568) = MapLibre ---------- */
const RATE_SOURCE = 'ประกาศศาลจังหวัดลพบุรี เรื่อง การกำหนดอัตราค่าพาหนะและค่าป่วยการฯ พ.ศ. 2568';
const RATE_EFFECTIVE = '2025-06-01';
const AMPHOE_NAMES = { '1601': 'เมืองลพบุรี', '1602': 'พัฒนานิคม', '1603': 'โคกสำโรง',
                       '1605': 'ท่าวุ้ง', '1606': 'บ้านหมี่', '1611': 'หนองม่วง' };
const RATES_SEED = [
  // area_id, tambon, officer_id, rate
  ['160101','ทะเลชุบศร','OF06',500],['160102','ท่าหิน','OF01',450],['160103','กกโก','OF06',600],
  ['160104','โก่งธนู','OF01',650],['160105','เขาพระงาม','OF01',650],['160106','เขาสามยอด','OF01',600],
  ['160107','โคกกะเทียม','OF10',600],['160108','โคกลำพาน','OF01',550],['160109','โคกตูม','OF08',700],
  ['160110','งิ้วราย','OF01',550],['160111','ดอนโพธิ์','OF01',550],['160112','ตะลุง','OF01',550],
  ['160114','ท่าแค','OF05',550],['160115','ท่าศาลา','OF06',550],['160116','นิคมสร้างตนเอง','OF06',650],
  ['160117','บางขันหมาก','OF10',550],['160118','บ้านข่อย','OF09',650],['160119','ท้ายตลาด','OF09',600],
  ['160120','ป่าตาล','OF06',600],['160121','พรหมมาสตร์','OF01',500],['160122','โพธิ์เก้าต้น','OF10',500],
  ['160123','โพธิ์ตรุ','OF10',550],['160124','สี่คลอง','OF09',650],['160125','ถนนใหญ่','OF05',500],
  ['160201','พัฒนานิคม','OF08',900],['160202','ช่องสาริกา','OF08',900],['160203','มะนาวหวาน','OF09',1100],
  ['160204','ดีลัง','OF08',850],['160205','โคกสลุง','OF09',1050],['160206','ชอนน้อย','OF08',900],
  ['160207','หนองบัว','OF08',1000],['160208','ห้วยขุนราม','OF09',1300],['160209','น้ำสุด','OF09',1100],
  ['160301','โคกสำโรง','OF03',800],['160302','เกาะแก้ว','OF03',1000],['160303','ถลุงเหล็ก','OF05',800],
  ['160304','หลุมข้าว','OF05',700],['160305','ห้วยโป่ง','OF05',750],['160306','คลองเกตุ','OF05',1000],
  ['160307','สะแกราบ','OF04',900],['160308','เพนียด','OF04',850],['160309','วังเพลิง','OF04',1000],
  ['160310','ดงมะรุม','OF04',1050],['160318','วังขอนขว้าง','OF05',700],['160320','วังจั่น','OF03',900],
  ['160322','หนองแขม','OF03',900],
  ['160501','ท่าวุ้ง','OF07',650],['160502','บางคู้','OF07',550],['160503','โพตลาดแก้ว','OF07',550],
  ['160504','บางลี่','OF07',700],['160505','บางงา','OF07',750],['160506','โคกสลุด','OF07',700],
  ['160507','เขาสมอคอน','OF07',750],['160508','หัวสำโรง','OF07',700],['160509','ลาดสาลี่','OF07',650],
  ['160510','บ้านเบิก','OF07',700],['160511','มุจลินท์','OF07',700],
  ['160601','ไผ่ใหญ่','OF02',950],['160602','บ้านทราย','OF02',700],['160603','บ้านกล้วย','OF02',700],
  ['160604','ดงพลับ','OF03',900],['160605','บ้านชี','OF02',800],['160606','พุคา','OF04',650],
  ['160607','หินปัก','OF03',700],['160608','บางพึ่ง','OF02',800],['160609','หนองทรายขาว','OF04',700],
  ['160610','บางกะพี้','OF03',900],['160611','หนองเต่า','OF04',700],['160612','โพนทอง','OF02',700],
  ['160613','บางขาม','OF02',800],['160614','ดอนดึง','OF02',1000],['160615','ชอนม่วง','OF02',1000],
  ['160616','หนองกระเบียน','OF02',950],['160617','สายห้วยแก้ว','OF02',950],['160618','มหาสอน','OF02',800],
  ['160619','บ้านหมี่','OF02',700],['160620','เชียงงา','OF02',800],['160621','หนองเมือง','OF02',850],
  ['160622','สนามแจง','OF02',750],
  ['161101','หนองม่วง','OF03',1000],['161102','บ่อทอง','OF03',1100],['161103','ดงดินแดง','OF03',1150],
  ['161104','ชอนสมบูรณ์','OF10',1150],['161105','ยางโทน','OF10',1000],['161106','ชอนสารเดช','OF10',1000]
];

/* หมายฟรี: อำเภอที่ศาลตั้ง = 300 คงที่ · อำเภออื่นใช้ RATE_AREAS ตามตำบล (ตามที่ตกลง) */
const RATE_BUDGET_SEED = [
  ['1601', 'เมืองลพบุรี', 300, '2019-05-01', 'ระเบียบ ก.บ.ศ. ว่าด้วยค่าตอบแทนในการส่งคำคู่ความฯ พ.ศ. 2562 บัญชีท้าย']
];

/* ---------- ชื่อหัวคอลัมน์ PrintHub (อ่านอย่างเดียว · หาจากชื่อหัว) ---------- */
const PH = { CODE: 0, FIRST: 1, LAST: 2, DEPT: 3, ROLE: 4, ACTIVE: 5, TEMP: 6, HASH: 7, SALT: 8,
             MUSTCHG: 9, QUOTA: 10, FAIL: 11, LOCK: 12, LASTIN: 13 };
const PH_COLS = 15;
const PH_HEADS = { CODE: ['user_code', 'รหัส', 'รหัสผู้ใช้'], FIRST: ['ชื่อ'], LAST: ['นามสกุล'],
                   DEPT: ['ส่วนงาน'], ACTIVE: ['ใช้งาน', 'active'], HASH: ['pin_hash'], SALT: ['pin_salt'],
                   MUSTCHG: ['ต้องเปลี่ยนรหัส', 'ต้องเปลี่ยน pin', 'must_change'],
                   LOCK: ['ล็อกถึง', 'lock_until'] };
