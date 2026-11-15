/**
 * ============================================================================
 *  ระบบค่าหมาย · ไฟล์ Import.gs
 *  หน้าที่ : นำเข้า 2 ขั้น — ไฟล์จ่ายหมาย (ISSUE) และไฟล์ผลหมาย (RESULT) · ต่างวันกันได้
 * ----------------------------------------------------------------------------
 *  ลำดับ : หน้าเว็บอ่าน Excel (SheetJS) → ส่งแถว + การจับคู่คอลัมน์
 *          → import_preview  แสดงจำนวน ใหม่/เดิม/เปลี่ยน/กำกวม/ผิดพลาด ก่อนยืนยัน
 *          → import_commit   ล็อก → จัดกลุ่มซ้ำกับข้อมูลล่าสุด → บันทึก (กันคนนำเข้าพร้อมกัน)
 *  ไม่มีการลบข้อมูลใด ๆ จากการนำเข้า (กฎข้อ 5)
 * ============================================================================
 */

const IMPORT_KINDS = { ISSUE: 'ไฟล์จ่ายหมาย', RESULT: 'ไฟล์ผลหมาย' };

/* ---------- แม่แบบการจับคู่คอลัมน์ + ข้อมูลประกอบหน้าเว็บ ---------- */
function apiImportTemplates_(ctx) {
  const tpl = {};
  readTable_('MAP_TEMPLATES').rows.forEach(function (r) {
    tpl[r.kind] = { mapping: safeJson_(r.mapping_json, {}), key_fields: String(r.key_fields || '').split(',').filter(String),
                    options: safeJson_(r.options_json, {}), updated_by: r.updated_by, updated_at: String(r.updated_at) };
  });
  return {
    fields: IMPORT_FIELDS,
    default_keys: DEFAULT_KEY_FIELDS,
    templates: tpl,
    officers: officersAll_().filter(function (o) { return o.active; }).map(function (o) { return { officer_id: o.officer_id, name: o.name }; }),
    max_rows: cfgNum_('IMPORT_MAX_ROWS', 20000),
    start_fy: cfg_('PROCESS_START_FY', ''),
    last: lastImports_()
  };
}

/** ช่วงวันที่ของไฟล์ที่นำเข้า: จากหัวรายงาน "ตั้งแต่วันที่ … ถึงวันที่ …" ถ้าไม่มี ใช้วันที่น้อยสุด–มากสุดในไฟล์ */
function batchPeriod_(req, res) {
  if (req.opts.period_from && req.opts.period_to) return { from: req.opts.period_from, to: req.opts.period_to };
  const ds = res.map(function (r) {
    const x = r.rec || {};
    return String(req.kind === 'RESULT' ? (x.delivered_date || '') : (x.issued_date || '')).slice(0, 10);
  }).filter(function (s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }).sort();
  return { from: ds[0] || '', to: ds[ds.length - 1] || '' };
}

/** ไฟล์ล่าสุดที่นำเข้าแต่ละชนิด (แสดงสถานะบนกล่องเลือกชนิดไฟล์) — ไม่มีข้อมูลคดี */
function lastImports_() {
  const out = {};
  readTable_('IMPORT_BATCHES').rows.forEach(function (b) {
    if (String(b.status) !== 'CONFIRMED') return;
    const k = String(b.kind), at = String(b.imported_at || '');
    const o = out[k] = out[k] || { n: 0, at: '' };
    o.n++;
    if (at >= o.at) Object.assign(o, { at: at, file: String(b.file_name || ''), rows: Number(b.rows_total) || 0, batch_id: String(b.batch_id),
                                       from: String(b.period_from || '').slice(0, 10), to: String(b.period_to || '').slice(0, 10) });
  });
  // บัญชีจ่ายเงินที่นำเข้าก่อนรุ่น 0.6.2 ไม่ได้บันทึกช่วงวันที่ → ใช้วันที่จ่ายน้อยสุด–มากสุดของชุดนั้น
  const p = out.PAY;
  if (p && !p.from) {
    const ds = readTable_('LEDGER').rows.filter(function (l) { return l.source === 'PAY' && String(l.batch_id) === p.batch_id; })
      .map(function (l) { return String(l.pay_date).slice(0, 10); }).filter(String).sort();
    if (ds.length) { p.from = ds[0]; p.to = ds[ds.length - 1]; p.derived = true; }
  }
  Object.keys(out).forEach(function (k) { delete out[k].batch_id; });
  return out;
}
function safeJson_(s, d) { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } }

/* ---------- ตรวจคำขอ ---------- */
function readImportRequest_(d) {
  const kind = String(d.kind || '').toUpperCase();
  if (!IMPORT_KINDS[kind]) throw appErr_('BAD_REQUEST', 'ไม่รู้จักชนิดไฟล์');
  let rows = Array.isArray(d.rows) ? d.rows : [];
  if (!rows.length) throw appErr_('BAD_REQUEST', 'ไม่มีแถวข้อมูลในไฟล์');
  const max = cfgNum_('IMPORT_MAX_ROWS', 20000);
  if (rows.length > max) throw appErr_('BAD_REQUEST', 'ไฟล์มี ' + rows.length + ' แถว เกินกำหนด ' + max + ' แถว');
  const mapping = d.mapping && typeof d.mapping === 'object' ? d.mapping : {};
  rows = rows.map(function(row, i) {
    try { return NoticeImportFormat.mapped(row || {}, mapping); }
    catch(e) { throw appErr_('BAD_REQUEST', 'แถว '+(i+1)+': '+e.message); }
  });
  const keys = (Array.isArray(d.key_fields) ? d.key_fields : DEFAULT_KEY_FIELDS).map(String);
  const kerr = validateKeyFields_(keys);
  if (kerr) throw appErr_('BAD_REQUEST', kerr);
  const fileOff = !!(d.options && d.options.file_officer_id);
  const useKeys = String(d.kind || '').toUpperCase() === 'RESULT' ? resultKeys_(keys) : keys;
  useKeys.forEach(function (k) {
    if (OPTIONAL_KEY_FIELDS.indexOf(k) >= 0 || (k === 'officer' && fileOff)) return;
    if ((k === 'house_no' || k === 'moo') && mapping.address_text) return;
    if (!mapping[k]) throw appErr_('BAD_REQUEST', 'ช่องคีย์ "' + fieldTh_(k) + '" ยังไม่ได้จับคู่คอลัมน์');
  });
  const o = d.options || {};
  const opts = { file_officer_id: str_(o.file_officer_id, 10),
                 privacy_mode: true,
                 default_pay_type: str_(o.default_pay_type, 10).toUpperCase(),
                 period_from: parseDate_(str_(o.period_from, 60)) || '',
                 period_to: parseDate_(str_(o.period_to, 60)) || '',
                 start_date: fyStartDate_(cfg_('PROCESS_START_FY', ''), cfgNum_('FY_START_MONTH', 10)) };
  if (kind === 'ISSUE') {
    if (!mapping.officer && !opts.file_officer_id) throw appErr_('BAD_REQUEST', 'ต้องจับคู่คอลัมน์ผู้ส่งหมาย หรือเลือก "ผู้ส่งทั้งไฟล์" (ไฟล์แยกรายคน)');
    if (!mapping.issued_date && !mapping.delivered_date && !opts.period_to) throw appErr_('BAD_REQUEST', 'ต้องจับคู่คอลัมน์วันที่จ่ายหมาย หรือระบุช่วงวันที่ของรายงาน');
    if (!mapping.pay_type && !opts.default_pay_type && !mapping.amount) throw appErr_('BAD_REQUEST', 'ต้องจับคู่คอลัมน์ราคา (0.00 = หมายฟรี) หรือคอลัมน์ประเภทหมาย หรือเลือกประเภททั้งไฟล์');
    if (!mapping.tambon) throw appErr_('BAD_REQUEST', 'ต้องจับคู่คอลัมน์ตำบล (ใช้หาอัตราค่าหมาย)');
    // ไฟล์จ่ายหมายไม่มีวันที่รายแถว — ช่วงวันที่คร่อมวันเริ่มปีงบ: รับทุกแถว แต่ทำเครื่องหมาย "รอยืนยันวันที่จ่าย" ยังไม่คิดเงิน
    // จนกว่าไฟล์ 42 จะเติมวันที่จ่าย (หมายฟรีจ่ายก่อนวันเริ่ม → ไม่นับ · หมายมีเงิน → นับตามวันที่ส่ง)
    if (!mapping.issued_date && opts.start_date && opts.period_from && opts.period_to &&
        opts.period_from < opts.start_date && opts.period_to >= opts.start_date) opts.date_unsure = true;
  } else if (!mapping.delivered_date) {
    throw appErr_('BAD_REQUEST', 'ไฟล์ผลหมายต้องจับคู่คอลัมน์วันที่ส่ง');
  }
  const file = d.file || {};
  const rowNos = Array.isArray(d.row_nos) && d.row_nos.length === rows.length ? d.row_nos.map(Number) : null;
  return { kind: kind, rows: rows, mapping: mapping, keys: keys, opts: opts, rowNos: rowNos,
           file: { name: str_(file.name, 200), size: Number(file.size) || 0,
                   checksum: str_(file.checksum, 80), sheet: str_(file.sheet, 100) } };
}
function fieldTh_(f) { const x = IMPORT_FIELDS.filter(function (i) { return i.f === f; })[0]; return x ? x.th : f; }

/* ---------- ข้อมูลเดิม ---------- */
function existingNotices_() {
  const t = readTable_('NOTICES');
  const map = {};
  t.rows.forEach(function (r) {
    map[String(r.notice_uid)] = { row_hash: String(r.row_hash), result_hash: String(r.result_hash),
      locked: !!(r.payout_round_id || r.budget_unit_id || String(r.locked).toUpperCase() === 'TRUE'), obj: r };
  });
  return { table: t, map: map };
}

function classifyAll_(req, existingMap) {
  // Match legacy names in memory only. Preserve IDs and all confirmed round references.
  const privateMap = {};
  Object.keys(existingMap).forEach(function(uid) {
    const e = existingMap[uid], o = e.obj || {}, match = storedMatchRec_(o);
    match.recipient = NoticeImportFormat.recipient(o.case_no, o.recipient);
    const obj = Object.assign({}, o, {recipient: match.recipient, payer: o.payer ? 'มีผู้วางเงิน' : ''});
    const normalized = Object.assign({}, obj, match);
    privateMap[uid] = Object.assign({}, e, {obj: obj, row_hash: hashOf_(normalized, ISSUE_HASH_FIELDS), canonical_uid: uid});
  });
  if (req.kind === 'ISSUE') Object.keys(existingMap).forEach(function(uid) {
    const e = privateMap[uid], alias = keyOf_(storedMatchRec_(e.obj), req.keys);
    if (!alias || alias === uid) return;
    if (privateMap[alias] && privateMap[alias].canonical_uid !== uid) privateMap[alias] = {privacy_collision: true};
    else privateMap[alias] = e;
  });
  existingMap = privateMap;
  const offIdx = buildOfficerIndex_(officersAll_());
  const areaIdx = buildAreaIndex_(readTable_('RATE_AREAS').rows);
  return req.kind === 'ISSUE'
    ? classifyIssue_(req.rows, req.mapping, req.keys, req.opts, existingMap, offIdx, areaIdx)
    : classifyResult_(req.rows, req.mapping, req.keys, req.opts, existingMap, offIdx, areaIdx);
}

function sampleOf_(res, req) {
  const byCls = {};
  // แถวที่มีหมายเหตุสีแดงขึ้นก่อน ให้งานหมายเห็นทันที
  const red = function (r) { return String(r.rec.flags).indexOf(FLAG_PRICE_NE_RATE) >= 0 ? 0 : 1; };
  res.slice().sort(function (a, b) { return red(a) - red(b) || a.i - b.i; }).forEach(function (r) {
    const list = byCls[r.cls] = byCls[r.cls] || [];
    if (list.length < 30) list.push({ row_no: (req.rowNos && req.rowNos[r.i]) || r.i + 2, reason: r.reason, case_no: r.rec.case_no,
      case_ref: r.rec.case_ref, notice_kind: r.rec.notice_kind,
      recipient: r.rec.recipient_disp, officer: r.rec.officer_raw || r.rec.officer_id, pay_type: r.rec.pay_type,
      amount: r.rec.amount_src, rate: r.rec.rate_ref, addr_type: ADDR_TYPE_TH[r.rec.addr_type] || '',
      place: [r.rec.house_no, r.rec.moo ? 'ม.' + r.rec.moo : '', r.rec.tambon ? 'ต.' + r.rec.tambon : '', r.rec.amphoe ? 'อ.' + r.rec.amphoe : ''].filter(String).join(' '),
      issued_date: r.rec.issued_date || '', delivered_date: r.rec.delivered_date || '', flags: r.rec.flags, adj: amountAdj_(r.rec) });
  });
  return byCls;
}

function seenChecksum_(checksum) {
  if (!checksum) return null;
  const hit = readTable_('IMPORT_BATCHES').rows.filter(function (b) { return b.checksum === checksum && b.status === 'CONFIRMED'; });
  return hit.length ? { batch_id: hit[hit.length - 1].batch_id, at: String(hit[hit.length - 1].imported_at) } : null;
}

/* ---------- 1) ตรวจก่อนนำเข้า ---------- */
function apiImportPreview_(ctx, d) {
  const req = readImportRequest_(d);
  const ex = existingNotices_();
  const res = classifyAll_(req, ex.map);
  const flagged = res.filter(function (r) { return r.rec.flags; }).length;
  const red = res.filter(function (r) { return String(r.rec.flags).indexOf(FLAG_PRICE_NE_RATE) >= 0; }).length;
  const unsure = res.filter(function (r) { return r.cls === 'NEW' && String(r.rec.flags).indexOf(FLAG_DATE_UNSURE) >= 0; }).length;
  const sum = { PAID: { n: 0, amount: 0 }, BUDGET: { n: 0, amount: 0 } };
  const adj = { up: 0, up_baht: 0, dn: 0, dn_baht: 0, calc: 0 };       // หมายมีเงินราคาไม่เท่าอัตรา → คิดตามอัตราตำบล
  if (req.kind === 'ISSUE') res.forEach(function (r) {
    if (['NEW', 'CHANGED', 'SAME', 'HELD'].indexOf(r.cls) < 0 || !sum[r.rec.pay_type]) return;
    sum[r.rec.pay_type].n++; sum[r.rec.pay_type].amount += Number(r.rec.amount_src) || 0;
    if (r.rec.pay_type !== 'PAID') return;
    const aj = amountAdj_(r.rec);
    adj.calc += aj ? aj.rate : (Number(r.rec.amount_src) || 0);
    if (aj && aj.dir === 'UP') { adj.up++; adj.up_baht += aj.diff; }
    if (aj && aj.dir === 'DOWN') { adj.dn++; adj.dn_baht += aj.diff; }
  });
  return { kind: req.kind, kind_th: IMPORT_KINDS[req.kind], rows_total: res.length,
           counts: countClasses_(res), flagged: flagged, price_ne_rate: red, totals: req.kind === 'ISSUE' ? sum : null, price_adj: req.kind === 'ISSUE' ? adj : null,
           period: req.opts.period_to ? { from: req.opts.period_from, to: req.opts.period_to } : null,
           start_fy: cfg_('PROCESS_START_FY', ''), start_date: req.opts.start_date,
           crosses_start: !!req.opts.date_unsure, date_unsure: unsure,
           samples: sampleOf_(res, req), duplicate_file: seenChecksum_(req.file.checksum) };
}

/* ---------- 2) ยืนยันนำเข้า ---------- */
function apiImportCommit_(ctx, d) {
  const req = readImportRequest_(d);
  const lock = writeLock_();
  try { lock.waitLock(30000); } catch (e) { throw appErr_('BUSY', 'มีผู้อื่นกำลังนำเข้าข้อมูล กรุณาลองใหม่อีกครั้ง'); }
  try {
    const out = importCommitCore_(req, ctx.user.code, {});
    // 0.6.3: แถวรอตรวจที่ค้างจากไฟล์ก่อน (เช่น ผลหมายที่ยังไม่พบต้นทาง) ลองจับคู่ใหม่ทันที — ไม่ต้องนำเข้าไฟล์ผลซ้ำ
    let retry = null;
    try { retry = reviewRetry_(ctx.user.code); } catch (e) { retry = { error: String(e && e.message || e) }; }
    if (retry && retry.closed) out.review_auto_resolved = (out.review_auto_resolved || 0) + retry.closed;
    out.retry = retry;
    // ระยะ 3: คำนวณค่าหมายใหม่ทันทีหลังนำเข้า (ยอดเงินอัปเดตตลอดปีงบ)
    try { out.calc = calcRunCore_(ctx.user.code); } catch (e) { out.calc = { error: String(e && e.message || e) }; }
    audit_(ctx.user.code, 'IMPORT', out.batch_id, { kind: req.kind, file: req.file.name, counts: out.counts, retry_closed: retry && retry.closed });
    return out;
  } finally { lock.releaseLock(); }
}

/**
 * แกนบันทึกการนำเข้า (เรียกภายใต้ล็อกเท่านั้น)
 * opt.retry = ลองจับคู่แถวรอตรวจเดิมใหม่: ไม่สร้างแถวรอตรวจซ้ำ · ไม่บันทึกแม่แบบ · บันทึกชุดเป็นสถานะ AUTO (ไม่นับเป็น "ไฟล์ล่าสุด")
 */
function importCommitCore_(req, userCode, opt) {
  opt = opt || {};
  {
    const ex = existingNotices_();            // อ่านใหม่ภายใต้ล็อก — กันนำเข้าพร้อมกันสร้างซ้ำ
    const res = classifyAll_(req, ex.map);
    const counts = countClasses_(res);
    const batchId = newId_(opt.retry ? 'AUT' : (req.kind === 'ISSUE' ? 'IMP' : 'RES'));
    const ts = now_();
    const fyStart = cfgNum_('FY_START_MONTH', 10);
    const newRows = [], reviews = [], changes = [];
    let updated = 0;

    res.forEach(function (r) {
      const rec = r.rec;
      if (r.cls === 'NEW') {
        newRows.push({
          notice_uid: r.uid, fy: fiscalYear_(rec.delivered_date || rec.issued_date || rec.period_to, fyStart), pay_type: rec.pay_type,
          case_no: rec.case_no, case_ref: rec.case_ref, red_no: rec.red_no, notice_no: rec.notice_no, notice_kind: rec.notice_kind,
          recipient: rec.recipient_disp, house_no: rec.house_no, moo: rec.moo, tambon: rec.tambon, amphoe: rec.amphoe, area_id: rec.area_id,
          address_text: rec.address_text, addr_type: rec.addr_type, place_key: rec.place_key,
          officer_id: rec.officer_id, officer_raw: rec.officer_raw,
          issued_date: rec.issued_date, delivered_date: rec.delivered_date, reported_date: rec.reported_date || '',
          result: rec.result, amount_src: rec.amount_src, rate_ref: rec.rate_ref, payer: rec.payer,
          status: rec.delivered_date ? 'DELIVERED' : 'ISSUED', flags: rec.flags,
          row_hash: rec.row_hash, result_hash: rec.result_hash || '', payout_round_id: '', budget_unit_id: '', locked: false,
          first_batch: batchId, last_batch: batchId, created_at: ts, updated_at: ts });
        ex.map[r.uid] = { row_hash: rec.row_hash, result_hash: rec.result_hash || '', locked: false, rec: rec };
      } else if (r.cls === 'CHANGED') {
        const o = ex.map[r.uid].obj;
        if (req.kind === 'ISSUE') {
          ['pay_type', 'case_no', 'case_ref', 'red_no', 'notice_no', 'notice_kind', 'house_no', 'moo', 'tambon', 'amphoe', 'area_id',
           'address_text', 'addr_type', 'place_key', 'officer_id', 'officer_raw', 'amount_src', 'rate_ref', 'payer', 'flags', 'row_hash'].forEach(function (k) { o[k] = rec[k]; });
          if (rec.issued_date) o.issued_date = rec.issued_date;          // ไม่ล้างวันที่จ่ายที่ได้จากไฟล์ผลหมาย
          o.recipient = rec.recipient_disp;
          if (rec.delivered_date) { o.delivered_date = rec.delivered_date; o.result = rec.result; o.result_hash = rec.result_hash; }
        } else {
          o.delivered_date = rec.delivered_date; o.result = rec.result; o.result_hash = rec.result_hash;
          if (rec.issued_date && !o.issued_date) o.issued_date = rec.issued_date;   // บัญชีจ่ายหมายไม่มีวันที่รายแถว → เติมจากไฟล์ผล
          if (rec.reported_date) o.reported_date = rec.reported_date;
        }
        o.status = o.delivered_date ? 'DELIVERED' : 'ISSUED';
        o.fy = fiscalYear_(String(o.delivered_date || o.issued_date), fyStart) || o.fy;
        o.last_batch = batchId; o.updated_at = ts;
        updateRow_('NOTICES', o._r, o);
        updated++;
      } else if (r.cls === 'HELD') {
        const o = ex.map[r.uid].obj;
        const fields = req.kind === 'ISSUE'
          ? ['pay_type', 'notice_kind', 'house_no', 'moo', 'tambon', 'amphoe', 'officer_id', 'issued_date', 'amount_src', 'delivered_date', 'result']
          : ['delivered_date', 'result'];
        fields.forEach(function (k) {
          const nv = String(rec[k] || ''), ov = String(o[k] || '');
          if (nv && nv !== ov) changes.push({ change_id: newId_('CHG'), notice_uid: r.uid, field: k, old_value: ov, new_value: nv,
            source: 'IMPORT', batch_id: batchId, status: 'PENDING', created_by: userCode, created_at: ts, decided_by: '', decided_at: '' });
        });
      } else if ((r.cls === 'AMBIGUOUS' || r.cls === 'ERROR') && !opt.retry) {
        reviews.push({ batch_id: batchId, row_no: (req.rowNos && req.rowNos[r.i]) || r.i + 2, class: r.cls, reason: r.reason, notice_uid: r.uid,
                       raw_json: JSON.stringify(req.rows[r.i]).slice(0, 4000), resolved: false, resolved_by: '', resolved_at: '' });
      }
    });

    // แถวรอตรวจสอบเดิมที่ยังไม่แก้ ไม่บันทึกซ้ำเมื่อนำเข้าไฟล์เดิมอีกครั้ง
    const openSig = {};
    readTable_('IMPORT_REVIEW').rows.forEach(function (x) {
      if (String(x.resolved).toUpperCase() !== 'TRUE') openSig[x.class + '|' + x.reason + '|' + x.raw_json] = true;
    });
    const freshReviews = reviews.filter(function (x) {
      const sig = x.class + '|' + x.reason + '|' + x.raw_json;
      if (openSig[sig]) return false;
      openSig[sig] = true; return true;
    });
    // รายการปรับปรุงที่รออนุมัติอยู่แล้ว (หมาย+ช่อง+ค่าใหม่เดียวกัน) ไม่บันทึกซ้ำ
    const openChg = {};
    readTable_('NOTICE_CHANGES').rows.forEach(function (x) {
      if (x.status === 'PENDING') openChg[x.notice_uid + '|' + x.field + '|' + x.new_value] = true;
    });
    const freshChanges = changes.filter(function (x) { return !openChg[x.notice_uid + '|' + x.field + '|' + x.new_value]; });

    // แถวที่เคยค้าง "รอตรวจ" แล้วรอบนี้จับคู่ได้ (เช่น นำเข้าไฟล์จ่ายหมายเดือนก่อนแล้ว) → ปิดให้อัตโนมัติ
    let autoResolved = 0;
    const okRaw = {};
    res.forEach(function (r) { if (['NEW', 'CHANGED', 'SAME', 'HELD', 'OUTSIDE'].indexOf(r.cls) >= 0) okRaw[JSON.stringify(req.rows[r.i]).slice(0, 4000)] = true; });
    readTable_('IMPORT_REVIEW').rows.forEach(function (x) {
      if (String(x.resolved).toUpperCase() === 'TRUE' || !okRaw[x.raw_json]) return;
      x.resolved = true; x.resolved_by = 'AUTO:' + batchId; x.resolved_at = ts;
      updateRow_('IMPORT_REVIEW', x._r, x); autoResolved++;
    });

    appendRows_('NOTICES', newRows);
    appendRows_('NOTICE_CHANGES', freshChanges);
    appendRows_('IMPORT_REVIEW', freshReviews);
    if (!opt.retry || updated || newRows.length || autoResolved)
      appendRows_('IMPORT_BATCHES', [{ batch_id: batchId, kind: req.kind, file_name: req.file.name, file_size: req.file.size,
        checksum: req.file.checksum, sheet_name: req.file.sheet, rows_total: res.length, n_new: counts.NEW, n_same: counts.SAME,
        n_changed: counts.CHANGED, n_ambiguous: counts.AMBIGUOUS, n_error: counts.ERROR, n_held: counts.HELD, n_outside: counts.OUTSIDE,
        status: opt.retry ? 'AUTO' : 'CONFIRMED', imported_by: userCode, imported_at: ts, note: opt.retry ? 'ระบบลองจับคู่แถวรอตรวจเดิมใหม่' : '',
        period_from: opt.retry ? '' : batchPeriod_(req, res).from, period_to: opt.retry ? '' : batchPeriod_(req, res).to }]);
    if (!opt.retry) saveTemplate_(req, userCode);
    return { batch_id: batchId, counts: counts, inserted: newRows.length, updated: updated, held_changes: freshChanges.length,
             review_rows: freshReviews.length, review_auto_resolved: autoResolved };
  }
}

/* ---------- 0.6.3 แถวรอตรวจ: ลองจับคู่ใหม่อัตโนมัติ · ให้เจ้าหน้าที่เลือกเองเฉพาะที่เหลือ ---------- */
function reviewOpen_() {
  const kindOf = {};
  readTable_('IMPORT_BATCHES').rows.forEach(function (b) { kindOf[b.batch_id] = b.kind; });
  return readTable_('IMPORT_REVIEW').rows.filter(function (x) { return String(x.resolved).toUpperCase() !== 'TRUE'; })
    .map(function (x) { x.kind = kindOf[x.batch_id] || (/^RES-/.test(x.batch_id) ? 'RESULT' : /^IMP-/.test(x.batch_id) ? 'ISSUE' : ''); return x; });
}
function templateOf_(kind) {
  const r = readTable_('MAP_TEMPLATES').rows.filter(function (t) { return t.kind === kind; })[0];
  if (!r) return null;
  const keys = String(r.key_fields || '').split(',').filter(String);
  return { mapping: safeJson_(r.mapping_json, {}), keys: keys.length ? keys : DEFAULT_KEY_FIELDS, options: safeJson_(r.options_json, {}) };
}
/** เรียกภายใต้ล็อก · คืน { closed, filled } */
function reviewRetry_(userCode) {
  const open = reviewOpen_();
  const out = { closed: 0, filled: 0, left: 0 };
  if (!open.length) return out;
  const ts = now_();
  // ไฟล์จ่ายหมาย: แถวซ้ำกันทุกช่องของหมายที่มีในระบบแล้ว → ปิด (นับฉบับเดียว)
  const uids = {}; readTable_('NOTICES').rows.forEach(function (n) { uids[String(n.notice_uid)] = true; });
  open.filter(function (x) { return x.kind === 'ISSUE' && /^แถวซ้ำกันทุกช่อง/.test(String(x.reason)) && uids[String(x.notice_uid)]; }).forEach(function (x) {
    x.resolved = true; x.resolved_by = 'AUTO:ซ้ำ นับฉบับเดียว'; x.resolved_at = ts; delete x.kind;
    updateRow_('IMPORT_REVIEW', x._r, x); out.closed++;
  });
  // ไฟล์ผลหมาย: นำแถวที่ค้างมาจับคู่ใหม่ด้วยกฎล่าสุด (แถวที่จับคู่ได้ ระบบปิดให้เองในแกนบันทึก)
  const res = open.filter(function (x) { return x.kind === 'RESULT'; });
  const tpl = res.length ? templateOf_('RESULT') : null;
  if (tpl) {
    const seen = {}, rows = [];
    res.forEach(function (x) { if (seen[x.raw_json]) return; seen[x.raw_json] = 1; const o = safeJson_(x.raw_json, null); if (o) rows.push(o); });
    const req = { kind: 'RESULT', rows: rows, mapping: tpl.mapping, keys: tpl.keys, rowNos: null,
                  opts: { file_officer_id: '', default_pay_type: '', period_from: '', period_to: '',
                          start_date: fyStartDate_(cfg_('PROCESS_START_FY', ''), cfgNum_('FY_START_MONTH', 10)) },
                  file: { name: 'แถวรอตรวจเดิม (ระบบลองจับคู่ใหม่)', size: 0, checksum: '', sheet: '' } };
    const r = importCommitCore_(req, userCode, { retry: true });
    out.closed += r.review_auto_resolved || 0; out.filled += r.updated || 0;
  }
  out.left = reviewOpen_().length;
  return out;
}

/** รายการแถวรอตรวจที่ยังค้าง + หมายในระบบที่อาจเป็นฉบับเดียวกัน (ให้เลือก) */
function apiReviewOpen_(ctx) {
  const open = reviewOpen_();
  const nt = readTable_('NOTICES').rows;
  const byCase = {};
  nt.forEach(function (n) { const k = normCase_(String(n.case_no || '').split(/\r?\n/)[0]); (byCase[k] = byCase[k] || []).push(n); });
  const tpl = { RESULT: templateOf_('RESULT'), ISSUE: templateOf_('ISSUE') };
  const offIdx = buildOfficerIndex_(officersAll_()), areaIdx = buildAreaIndex_(readTable_('RATE_AREAS').rows);
  const offName = {}; officersAll_().forEach(function (o) { offName[o.officer_id] = o.name; });
  const all = open.map(function (x) {
    const raw = safeJson_(x.raw_json, {});
    const t = tpl[x.kind];
    let rec = {};
    try { if (t) rec = toRecord_(raw, t.mapping, { start_date: '' }, offIdx, areaIdx) || {}; } catch (e) { rec = {}; }
    const cs = normCase_(String(rec.case_no || '').split(/\r?\n/)[0]);
    const cands = (byCase[cs] || []).filter(function (n) { return !rec.officer_id || n.officer_id === rec.officer_id; }).slice(0, 12).map(function (n) {
      return { notice_uid: String(n.notice_uid), pay_type: n.pay_type, notice_kind: String(n.notice_kind || ''), recipient: String(n.recipient || ''),
               tambon: String(n.tambon || ''), house_no: String(n.house_no || ''), moo: String(n.moo || ''), status: n.status,
               delivered_date: String(n.delivered_date || '').slice(0, 10), result: String(n.result || ''), locked: !!n.payout_round_id,
               officer: offName[n.officer_id] || n.officer_id, court_amount: n.court_at ? Number(n.court_amount) || 0 : null,
               like: !!(rec.result && resultLike_(rec.result, n.result) && !n.delivered_date) };
    });
    return { id: x.batch_id + '#' + x.row_no, batch_id: x.batch_id, row_no: Number(x.row_no), kind: x.kind, cls: x.class, reason: x.reason,
             case_no: String(rec.case_no || ''), notice_kind: String(rec.notice_kind || ''), recipient: String(rec.recipient_disp || rec.recipient || ''),
             officer: offName[rec.officer_id] || rec.officer_raw || '', delivered_date: rec.delivered_date || '', reported_date: rec.reported_date || '',
             issued_date: rec.issued_date || '', result: String(rec.result || ''), cands: cands };
  });
  // แถวที่มีหมายให้เลือกขึ้นก่อน · แถวที่ยังไม่มีหมายต้นทาง (รอไฟล์ 50) สรุปเป็นกลุ่ม
  const act = all.filter(function (r) { return r.cands.length; }), wait = all.filter(function (r) { return !r.cands.length; });
  const ds = wait.map(function (r) { return String(r.issued_date || r.delivered_date || '').slice(0, 10); }).filter(String).sort();
  return { rows: act.slice(0, 150).concat(wait.slice(0, 150)), total: all.length, n_action: act.length, n_wait: wait.length,
           wait_from: ds[0] || '', wait_to: ds[ds.length - 1] || '' };
}

/** (d.op) เจ้าหน้าที่เลือกเอง: APPLY = ใช้ผลแถวนี้กับหมายที่เลือก · IGNORE = ปิด ไม่ใช้แถวนี้ (ต้องมีเหตุผล) · RETRY = ให้ระบบลองจับคู่ใหม่ */
function apiReviewResolve_(ctx, d) {
  const lock = writeLock_();
  try { lock.waitLock(30000); } catch (e) { throw appErr_('BUSY', 'มีผู้อื่นกำลังนำเข้าข้อมูล กรุณาลองใหม่อีกครั้ง'); }
  try {
    const action = str_(d.op, 10).toUpperCase();
    if (action === 'RETRY') {
      const r = reviewRetry_(ctx.user.code);
      if (r.filled) calcRunCore_(ctx.user.code);
      audit_(ctx.user.code, 'REVIEW_RETRY', '', r);
      return r;
    }
    const bid = str_(d.batch_id, 40), rowNo = Number(d.row_no);
    const t = readTable_('IMPORT_REVIEW');
    const rows = t.rows.filter(function (x) { return x.batch_id === bid && Number(x.row_no) === rowNo && String(x.resolved).toUpperCase() !== 'TRUE'; });
    if (!rows.length) throw appErr_('NOT_FOUND', 'ไม่พบแถวนี้ หรือแถวนี้ปิดไปแล้ว');
    const x = rows[0], ts = now_(), who = ctx.user.code;
    // แถวที่มีข้อมูลเดียวกันจากไฟล์อื่น ปิดไปพร้อมกัน
    const sameRaw = t.rows.filter(function (y) { return y.raw_json === x.raw_json && String(y.resolved).toUpperCase() !== 'TRUE'; });
    let applied = null;
    if (action === 'IGNORE') {
      const why = str_(d.reason, 200);
      if (!why) throw appErr_('BAD_REQUEST', 'กรุณาระบุเหตุผลที่ไม่ใช้แถวนี้');
      sameRaw.forEach(function (y) { y.resolved = true; y.resolved_by = who + ':ไม่ใช้ — ' + why; y.resolved_at = ts; updateRow_('IMPORT_REVIEW', y._r, y); });
    } else if (action === 'APPLY') {
      const kind = /^RES-|^AUT-/.test(bid) ? 'RESULT' : 'ISSUE';
      if (kind !== 'RESULT') throw appErr_('BAD_REQUEST', 'แถวจากไฟล์จ่ายหมายให้แก้ที่ไฟล์ต้นทาง หรือกด "ไม่ใช้แถวนี้"');
      const tpl = templateOf_('RESULT');
      if (!tpl) throw appErr_('BAD_REQUEST', 'ยังไม่มีแม่แบบไฟล์ผลหมาย');
      const rec = toRecord_(safeJson_(x.raw_json, {}), tpl.mapping, { start_date: '' }, buildOfficerIndex_(officersAll_()), buildAreaIndex_(readTable_('RATE_AREAS').rows));
      if (!rec.delivered_date) throw appErr_('BAD_REQUEST', 'แถวนี้ไม่มีวันที่ส่ง');
      const nt = readTable_('NOTICES');
      const uid = str_(d.notice_uid, 400);
      const o = nt.rows.filter(function (n) { return String(n.notice_uid) === uid; })[0];
      if (!o) throw appErr_('NOT_FOUND', 'ไม่พบหมายที่เลือก');
      if (o.payout_round_id) throw appErr_('BAD_REQUEST', 'หมายนี้เข้ารอบเบิกแล้ว แก้ผลการส่งไม่ได้');
      if (normCase_(String(o.case_no).split(/\r?\n/)[0]) !== normCase_(String(rec.case_no || '').split(/\r?\n/)[0]))
        throw appErr_('BAD_REQUEST', 'เลขคดีของหมายที่เลือกไม่ตรงกับแถวผลหมาย');
      o.delivered_date = rec.delivered_date; o.result = rec.result; o.result_hash = hashOf_(rec, RESULT_HASH_FIELDS);
      if (rec.issued_date && !o.issued_date) o.issued_date = rec.issued_date;
      if (rec.reported_date) o.reported_date = rec.reported_date;
      o.status = 'DELIVERED'; o.fy = fiscalYear_(String(o.delivered_date), cfgNum_('FY_START_MONTH', 10)) || o.fy;
      o.last_batch = 'MANUAL:' + who; o.updated_at = ts;
      updateRow_('NOTICES', o._r, o);
      sameRaw.forEach(function (y) { y.resolved = true; y.resolved_by = who + ':เลือกหมาย ' + uid.slice(0, 80); y.resolved_at = ts; updateRow_('IMPORT_REVIEW', y._r, y); });
      applied = { notice_uid: uid, delivered_date: o.delivered_date };
      calcRunCore_(who);
    } else throw appErr_('BAD_REQUEST', 'ไม่รู้จักคำสั่ง');
    audit_(who, 'REVIEW_' + action, bid + '#' + rowNo, { notice_uid: d.notice_uid || '', reason: d.reason || '' });
    return { ok: true, applied: applied, closed: sameRaw.length, left: reviewOpen_().length };
  } finally { lock.releaseLock(); }
}

function saveTemplate_(req, by) {
  const t = readTable_('MAP_TEMPLATES');
  const row = t.rows.filter(function (r) { return r.kind === req.kind; })[0];
  const obj = { kind: req.kind, name: 'ล่าสุด', mapping_json: JSON.stringify(req.mapping), key_fields: req.keys.join(','),
                options_json: JSON.stringify({ default_pay_type: req.opts.default_pay_type }), updated_by: by, updated_at: now_() };
  if (row) updateRow_('MAP_TEMPLATES', row._r, obj); else appendRows_('MAP_TEMPLATES', [obj]);
}

/* ---------- ประวัติ / แถวรอตรวจสอบ ---------- */
function apiImportHistory_(ctx) {
  const rows = readTable_('IMPORT_BATCHES').rows.slice(-50).reverse();
  return { batches: rows.map(function (b) {
    return { batch_id: b.batch_id, kind_th: IMPORT_KINDS[b.kind] || (typeof LEDGER_KINDS !== 'undefined' && LEDGER_KINDS[b.kind] ? LEDGER_KINDS[b.kind].th : b.kind), file_name: b.file_name, rows_total: Number(b.rows_total),
             n_new: Number(b.n_new), n_same: Number(b.n_same), n_changed: Number(b.n_changed), n_held: Number(b.n_held),
             n_ambiguous: Number(b.n_ambiguous), n_error: Number(b.n_error), n_outside: Number(b.n_outside) || 0, imported_by: b.imported_by, imported_at: String(b.imported_at) };
  }) };
}
function apiImportReview_(ctx, d) {
  const bid = str_(d.batch_id, 40);
  const rows = readTable_('IMPORT_REVIEW').rows.filter(function (r) {
    return (bid ? r.batch_id === bid : String(r.resolved).toUpperCase() !== 'TRUE');
  }).slice(-300);
  return { rows: rows.map(function (r) {
    return { batch_id: r.batch_id, row_no: Number(r.row_no), cls: r.class, reason: r.reason, notice_uid: r.notice_uid, raw: safeJson_(r.raw_json, {}) };
  }) };
}
