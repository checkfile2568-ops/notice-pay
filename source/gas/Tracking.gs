/** 0.7.0: read-only tracing from notice to financial round. Existing monetary rules are unchanged. */
var TRACK_STATUS_TH_ = { WAIT: 'รอผลการส่ง', REVIEW: 'รอตรวจข้อมูล', READY: 'พร้อมเบิก / ยังไม่พบประวัติรอบ', HELD: 'เลื่อนไปรอบหน้า', ROUND: 'อยู่ในรอบยืนยันแล้ว · ยังไม่บันทึกหลักฐานจ่าย', PAID: 'อยู่ในรอบ · บันทึกจ่ายจริงแล้ว', NOCLAIM: 'ไม่เบิกจ่าย / ปิดไม่เบิก' };
function trackingData_(ctx, d) {
  const scope = scopeOfficer_(ctx.user), rounds = {}, history = {}, held = payoutHeld_();
  const today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  const from = d.from ? parseDate_(d.from) : '', to = d.to ? parseDate_(d.to) : '';
  if (from === null || to === null || (from && to && from > to)) throw appErr_('BAD_REQUEST', 'ช่วงวันที่ค้นหาไม่ถูกต้อง');
  readTable_('PAYOUT_ROUNDS').rows.forEach(function (r) { rounds[r.round_id] = r; });
  readTable_('PAYOUT_ITEMS').rows.forEach(function (it) {
    if (String(it.included).toUpperCase() !== 'TRUE') return;
    const r = rounds[it.round_id]; if (!r || r.status !== 'CONFIRMED') return;
    String(it.notice_uids || '').split(',').filter(String).forEach(function (u) { (history[u] = history[u] || []).push({ round_id: r.round_id, pay_date: r.pay_date, amount: Number(it.amount) || 0, payment_status: r.payment_status || '', payment_date: r.payment_date || '', payment_ref: r.payment_ref || '' }); });
  });
  const allNotices = linkNotices_(readTable_('NOTICES').rows, Object.keys(rounds).map(function (k) { return rounds[k]; }), readTable_('PAYOUT_ITEMS').rows);
  const unitMembers = {}, legacyClaims = {}; allNotices.forEach(function (n) { if (n.budget_unit_id) (unitMembers[n.budget_unit_id] = unitMembers[n.budget_unit_id] || []).push(n.notice_uid); });
  readTable_('BUDGET_UNITS').rows.forEach(function(u) { if (u.claim_ref || /^(CLAIMED|PAID)$/.test(String(u.status || ''))) legacyClaims[u.unit_id] = true; });
  const names = officerNames_(), q = normText_(d.q || '').replace(/\s+/g, '').toUpperCase();
  const fy = String(d.fy || ''), type = String(d.pay_type || ''), status = String(d.status || ''), officer = scope || String(d.officer_id || '');
  const list = allNotices.filter(function (n) {
    if (d.unit_id && n.budget_unit_id !== String(d.unit_id)) return false;
    if (officer && n.officer_id !== officer) return false;
    if (d.area_id && String(n.area_id)!==String(d.area_id)) return false;
    if (fy && String(n.fy) !== fy) return false;
    if (type && n.pay_type !== type) return false;
    const date = parseDate_(n.delivered_date || n.issued_date) || '';
    if (from && (!date || date < from)) return false;
    if (to && (!date || date > to)) return false;
    return !q || [n.case_no, n.case_ref, n.red_no, n.notice_no].some(function (v) { return normText_(v).replace(/\s+/g, '').toUpperCase().indexOf(q) >= 0; });
  }).map(function (n) {
    const hs = history[n.notice_uid] || [];
    const prior = hs.slice().sort(function(a,b) { return String(a.pay_date).localeCompare(String(b.pay_date)) || String(a.round_id).localeCompare(String(b.round_id)); });
    const pointer = rounds[n.payout_round_id];
    const r = pointer && pointer.status === 'CONFIRMED' ? pointer : prior.length ? rounds[prior[prior.length-1].round_id] : pointer;
    let st = n.noclaim_at ? 'NOCLAIM' : !n.delivered_date ? 'WAIT' : /^REVIEW|WAIT_ISSUE/.test(String(n.calc_rule)) ? 'REVIEW' : held['N:' + n.notice_uid] ? 'HELD' : 'READY';
    // 0.7.10 กฎเดียวกับหน้าการเงิน/รอบเบิก/สถิติ: ก่อนเริ่มปีงบ หรือพ้นปีงบของวันที่จ่ายหมายโดยยังไม่เบิก = ไม่เบิกจ่าย
    const freeClosed = (n.pay_type === 'BUDGET' && String(n.calc_rule) === 'PRE_START') || freeExpired_(n, today) ||
      (n.pay_type === 'BUDGET' && /^25\d{2}$/.test(String(n.fy)) && (parseDate_(n.issued_date) || '9999') < (Number(n.fy)-544)+'-10-01');
    if (freeClosed) st = 'NOCLAIM';
    if (n.claim_status || legacyClaims[n.budget_unit_id]) st = 'REVIEW';
    if (n.payout_round_id && (!r || r.status !== 'CONFIRMED')) st = 'REVIEW';
    if (r && r.status === 'CONFIRMED') st = r.payment_status === 'PAID' ? 'PAID' : 'ROUND';
    const reference = n.calc_amount === '' || n.calc_amount === undefined ? null : Number(n.calc_amount);
    const actual = st === 'NOCLAIM' && n.pay_type === 'BUDGET' ? 0 : effAmount_(n), diff = st === 'NOCLAIM' || reference === null ? null : Math.round((actual - reference) * 100) / 100;
    return { notice_uid: n.notice_uid, fy: n.fy, pay_type: n.pay_type, case_no: n.case_no, notice_kind: n.notice_kind, recipient: n.recipient,
      officer_id: n.officer_id, officer: (names[n.officer_id] || {}).name || n.officer_raw, tambon: n.tambon, amphoe:n.amphoe, area_id:n.area_id, issued_date: String(n.issued_date || '').slice(0, 10), delivered_date: String(n.delivered_date || '').slice(0, 10), reported_date: String(n.reported_date || '').slice(0, 10),
      reference: reference, amount: actual, difference: diff, source: n.round_amount_c !== undefined && r && r.status === 'CONFIRMED' ? (n.pay_type === 'PAID' ? 'ยอดจ่ายตามบัญชี (ยอดเดิมในรอบ)' : 'ยอดเดิมในรอบเบิก') : n.pay_type === 'BUDGET' && n.court_at ? 'ราคาบัญชีศาล ประเภท 18' : 'ยอดระบบคำนวณ',
      status: st, status_th: TRACK_STATUS_TH_[st], round_id: r && r.status === 'CONFIRMED' ? r.round_id : '', round_date: r ? r.pay_date : '', payment_date: r ? r.payment_date || '' : '', payment_ref: r ? r.payment_ref || '' : '',
      unit_id: n.budget_unit_id || '', grouped_count: n.budget_unit_id ? (unitMembers[n.budget_unit_id] || []).length : 1, flags: n.flags || '', history: hs };
  }).filter(function (r) { return !status || r.status === status; });
  const totals = { count: list.length, amount: 0, shortage: 0, excess: 0, shortage_n: 0, excess_n: 0, statuses: {}, status_amount: {} }, per = {}, perArea = {};
  list.forEach(function (r) {
    totals.amount += Math.round(r.amount * 100); totals.statuses[r.status] = (totals.statuses[r.status] || 0) + 1;
    totals.status_amount[r.status] = (totals.status_amount[r.status] || 0) + Math.round(r.amount * 100);
    if (r.difference < 0) { totals.shortage += Math.round(-r.difference * 100); totals.shortage_n++; }
    if (r.difference > 0) { totals.excess += Math.round(r.difference * 100); totals.excess_n++; }
    const p = per[r.officer_id] = per[r.officer_id] || { officer_id: r.officer_id, officer: r.officer, count: 0, amount: 0, shortage: 0, excess: 0 };
    const a=perArea[r.area_id||'__unknown__']=perArea[r.area_id||'__unknown__']||{area_id:r.area_id||'',tambon:r.tambon||'ไม่ระบุพื้นที่',amphoe:r.amphoe||'',count:0,amount:0};a.count++;a.amount+=Math.round(r.amount*100);
    p.count++; p.amount += Math.round(r.amount * 100); p.shortage += Math.round(Math.max(0, -(r.difference || 0)) * 100); p.excess += Math.round(Math.max(0, r.difference || 0) * 100);
  });
  ['amount', 'shortage', 'excess'].forEach(function (k) { totals[k] /= 100; Object.keys(per).forEach(function (id) { per[id][k] /= 100; }); });
  Object.keys(totals.status_amount).forEach(function (k) { totals.status_amount[k] /= 100; });
  const ledger = readTable_('LEDGER').rows.filter(function(l){return l.source==='PAY' && (!officer || l.officer_id===officer) && (!fy || fiscalYear_(String(l.pay_date),10)===fy);});
  const controls={count:ledger.length,amount:0,unmatched_n:0,unmatched_amount:0}; ledger.forEach(function(l){controls.amount+=cents2_(l.amount);if(l.match!=='OK'){controls.unmatched_n++;controls.unmatched_amount+=cents2_(l.amount);}}); controls.amount/=100;controls.unmatched_amount/=100;
  controls.by_date = ledgerByDate_(ledger, rounds);
  // 0.7.10 หมายฟรีคงค้าง: ใช้ตัวคำนวณเดียวกับหน้า "การเงิน · ตรวจสอบก่อนเบิก" (ยอดทะเบียนรวมรายการที่เบิกแล้ว ใช้แทนยอดคงค้างไม่ได้)
  let budgetPending = null;
  if (type !== 'PAID' && /^25\d{2}$/.test(fy) && fyStartDate_(fy, 10) <= today) {
    const co = closeoutData_(readTable_('NOTICES').rows, Object.keys(rounds).map(function (k) { return rounds[k]; }), readTable_('PAYOUT_ITEMS').rows, names, fy, today, readTable_('BUDGET_UNITS').rows);
    const src = officer ? (co.per_officer.filter(function (o) { return o.officer_id === officer; })[0] || { count: 0, ready_n: 0, ready_units: 0, ready_amount: 0, wait_n: 0, review_n: 0, noclaim_n: 0 }) : co.totals;
    budgetPending = { fy: fy, from: co.from, to: co.to, count: src.count, ready_n: src.ready_n, ready_units: src.ready_units, ready_amount: src.ready_amount,
                      wait_n: src.wait_n, review_n: src.review_n, noclaim_n: src.noclaim_n, excluded_claimed: officer ? null : co.totals.excluded_claimed };
  }
  const rr=Object.keys(rounds).map(function(k){return rounds[k];}).filter(function(r){return r.status==='CONFIRMED' && (!fy || String(r.fy)===fy) && (!type || r.round_type===(type==='BUDGET'?'FREE':'PAID'));});
  const rc={count:rr.length,amount:rr.reduce(function(a,r){if(!officer)return a+cents2_(r.total);let lines=[];try{lines=JSON.parse(r.lines_json||'[]');}catch(e){}return a+lines.filter(function(l){return l.officer_id===officer;}).reduce(function(t,l){return t+l.total_c;},0);},0)/100};
  Object.keys(perArea).forEach(k=>perArea[k].amount/=100);
  return { budget_pending: budgetPending, per_area:Object.keys(perArea).map(k=>perArea[k]),ledger_summary:controls,round_summary:rc,rows: list, totals: totals, officers: names, areas:readTable_('RATE_AREAS').rows.map(a=>({area_id:a.area_id,tambon:a.tambon_name,amphoe:a.amphoe_name})),per_officer: Object.keys(per).map(function (id) { return per[id]; }), last_imports: lastImports_(), statuses: TRACK_STATUS_TH_, scope_officer: scope };
}
/**
 * 0.7.10 บัญชีจ่ายเงิน (PAY) แยกตามวันที่จ่าย: บอกชัดว่าวันใดมีบัญชีจ่ายแล้วแต่ยังไม่มีรอบแบ่งในระบบ
 * และจำนวนรายการที่จับคู่ทะเบียนไม่ได้ โดยไม่สรุปว่ายังไม่ได้จ่ายเงินจริง
 */
function ledgerByDate_(ledger, rounds) {
  const by = {};
  (ledger || []).forEach(function (l) {
    if (l.source && l.source !== 'PAY') return;
    const k = String(l.pay_date || '').slice(0, 10) || 'ไม่ระบุ';
    const b = by[k] = by[k] || { pay_date: k, rows: 0, amount_c: 0, unmatched_n: 0, unmatched_c: 0, in_round_n: 0, no_round_n: 0, no_round_c: 0, round_ids: [] };
    const c = cents2_(l.amount), rid = String(l.round_id || ''), r = rid && rounds ? rounds[rid] : null;
    b.rows++; b.amount_c += c;
    if (l.match !== 'OK') { b.unmatched_n++; b.unmatched_c += c; }
    if (r && r.status === 'CONFIRMED') { b.in_round_n++; if (b.round_ids.indexOf(rid) < 0) b.round_ids.push(rid); }
    else { b.no_round_n++; b.no_round_c += c; }
  });
  return Object.keys(by).sort().map(function (k) {
    const b = by[k];
    const state = !b.no_round_n ? 'IN_ROUND' : b.in_round_n ? 'PARTIAL' : 'NO_ROUND';
    return { pay_date: b.pay_date, rows: b.rows, amount: b.amount_c / 100, unmatched_n: b.unmatched_n, unmatched_amount: b.unmatched_c / 100,
             in_round_n: b.in_round_n, no_round_n: b.no_round_n, no_round_amount: b.no_round_c / 100, round_ids: b.round_ids, state: state,
             state_th: state === 'IN_ROUND' ? 'มีบัญชีจ่ายและรอบแบ่งในระบบแล้ว' : state === 'PARTIAL' ? 'มีบัญชีจ่ายแล้ว · บางรายการยังไม่อยู่ในรอบแบ่ง' : 'มีบัญชีจ่ายแล้ว แต่ยังไม่มีรอบแบ่งในระบบ' };
  });
}
function apiTracking_(ctx, d) {
  const out = trackingData_(ctx, d), page = Math.max(1, Math.floor(Number(d.page) || 1));
  out.total_rows = out.rows.length; out.page = page; out.rows = out.rows.slice((page - 1) * 100, page * 100); return out;
}
function apiReports_(ctx, d) {
  if (d.report_mode === 'closeout') return apiCloseout_(ctx, d);
  const out = trackingData_(ctx, d); delete out.rows; return out;
}
/** Read saved confirmed-round splits only. Never recompute or write financial records. */
function apiCompensationSummary_(ctx,d) {
  const fy=String(d.fy||''),scope=scopeOfficer_(ctx.user),names=officerNames_(),per={},rounds=[];
  if(fy&&!/^25\d{2}$/.test(fy))throw appErr_('BAD_REQUEST','ระบุปีงบประมาณ พ.ศ. 4 หลัก');
  Object.keys(names).forEach(function(id){if(!scope||id===scope)per[id]={officer_id:id,name:names[id].name,color:names[id].color,rounds:0,paid_c:0,budget_c:0,c60:0,c40:0,paid60_c:0,pending60_c:0};});
  function cents(v){const n=Number(v);if(v===undefined||v===null||v===''||!Number.isSafeInteger(n)||n<0)throw appErr_('DATA_REVIEW','ข้อมูลแบ่งยอดของรอบเดิมไม่ครบ กรุณาตรวจรายละเอียดรอบ');return n;}
  readTable_('PAYOUT_ROUNDS').rows.filter(r=>r.status==='CONFIRMED'&&(!fy||String(r.fy)===fy)).forEach(function(r){
    let lines;try{lines=JSON.parse(r.lines_json||'[]');}catch(e){throw appErr_('DATA_REVIEW','ข้อมูลแบ่งยอดของรอบเดิมอ่านไม่ได้');}
    if(!Array.isArray(lines)||!lines.length)throw appErr_('DATA_REVIEW','รอบยืนยันยังไม่มีข้อมูลแบ่งยอดรายคน กรุณาตรวจรอบเดิม');
    const paid=r.payment_status==='PAID',seen={},visible=lines.filter(l=>!scope||l.officer_id===scope);let total60=0;
    visible.forEach(function(l){const id=String(l.officer_id||'');if(!id)throw appErr_('DATA_REVIEW','รอบเดิมมีรายการไม่ระบุผู้ส่ง');
      const p=per[id]=per[id]||{officer_id:id,name:(names[id]||{}).name||id,color:(names[id]||{}).color||'#2e6b4f',rounds:0,paid_c:0,budget_c:0,c60:0,c40:0,paid60_c:0,pending60_c:0};
      const c60=cents(l.c60),c40=cents(l.c40),pc=cents(l.paid_c),bc=cents(l.budget_c);if(c60+c40!==pc+bc)throw appErr_('DATA_REVIEW','ยอดแบ่งในรอบเดิมไม่ตรงกับฐานยอด');
      p.paid_c+=pc;p.budget_c+=bc;p.c60+=c60;p.c40+=c40;p[paid?'paid60_c':'pending60_c']+=c60;total60+=c60;if(!seen[id]){p.rounds++;seen[id]=true;}
    });
    if(visible.length)rounds.push({round_id:r.round_id,fy:String(r.fy),pay_date:String(r.pay_date).slice(0,10),round_type:r.round_type,payment_status:paid?'PAID':'ROUND',payment_date:String(r.payment_date||'').slice(0,10),c60:total60/100,per_seat:scope?null:Number(r.per_seat)||0,carry_out:scope?null:Number(r.carry_out)||0});
  });
  const totals={paid:0,budget:0,c60:0,c40:0,paid60:0,pending60:0};
  const officers=Object.keys(per).map(function(id){const p=per[id],o={officer_id:id,name:p.name,color:p.color,rounds:p.rounds};[['paid','paid_c'],['budget','budget_c'],['c60','c60'],['c40','c40'],['paid60','paid60_c'],['pending60','pending60_c']].forEach(function(pair){o[pair[0]]=p[pair[1]]/100;totals[pair[0]]+=p[pair[1]];});return o;});
  Object.keys(totals).forEach(k=>totals[k]/=100);
  const unrecorded=rounds.filter(r=>r.payment_status!=='PAID').length;
  return {fy:fy,scope_officer:scope,officers:officers,totals:totals,rounds:rounds.sort((a,b)=>b.pay_date.localeCompare(a.pay_date)),source:'CONFIRMED_ROUND_LINES',
    unrecorded_rounds:unrecorded,can_payment:!scope&&hasRole_(ctx.user,['FINANCE','ADMIN'])};
}
function verify079ReadOnly() {
  const tables=['NOTICES','BUDGET_UNITS','LEDGER','PAYOUT_ROUNDS','PAYOUT_ITEMS','RATE_AREAS','RATE_BUDGET','CALC_RULES','CONFIG'];
  const hash=()=>{DB_CACHE_=null;HEAD_CACHE_={};return digestJson_(tables.map(k=>readTable_(k).rows));},before=hash(),d=apiCompensationSummary_({user:{roles:['ADMIN']}},{fy:currentFy_()});
  if(Math.round((d.totals.paid60+d.totals.pending60)*100)!==Math.round(d.totals.c60*100))throw new Error('Compensation status mismatch');
  const first=d.officers[0];if(first){const own=apiCompensationSummary_({user:{roles:['COURIER'],officer_id:first.officer_id}},{fy:currentFy_()});if(own.officers.length!==1||own.totals.c60!==first.c60)throw new Error('Compensation scope mismatch');}
  if(hash()!==before)throw new Error('Read-only verification changed data');
  console.log(JSON.stringify({verification:'0.7.9',unchanged:true,compensation_status_correct:true,scope_correct:true}));
}
/** 0.7.10 เจ้าของโครงการรันในตัวแก้ไข: ตรวจฐานจริงแบบอ่านอย่างเดียว (ไม่มี route) แล้วพิมพ์ตัวเลขเทียบรายงานตรวจ */
function verify0710ReadOnly() {
  const tables=['NOTICES','BUDGET_UNITS','LEDGER','PAYOUT_ROUNDS','PAYOUT_ITEMS','RATE_AREAS','RATE_BUDGET','CALC_RULES','CONFIG'];
  const hash=()=>{DB_CACHE_=null;HEAD_CACHE_={};return digestJson_(tables.map(k=>readTable_(k).rows));},before=hash(),fy=String(currentFy_());
  const admin={user:{code:'READ_ONLY_VERIFY',roles:['ADMIN']}},raw=readTable_('NOTICES').rows,linked=linkedNotices_(raw);
  const fromHistory=linked.filter(n=>n.round_from_history),shifted=fromHistory.filter(n=>{const o=raw.filter(x=>x.notice_uid===n.notice_uid)[0];return effAmount_(o)!==effAmount_(n);});
  const dash=apiDashboard_(admin,{fy:fy}),comp=apiCompensationSummary_(admin,{fy:fy}),tr=trackingData_(admin,{fy:fy,pay_type:'BUDGET'}),co=apiCloseout_(admin,{fy:fy});
  const ledgerNoRound=trackingData_(admin,{fy:fy}).ledger_summary.by_date.filter(x=>x.state!=='IN_ROUND');
  if(tr.budget_pending&&(tr.budget_pending.ready_n!==co.totals.ready_n||Math.round(tr.budget_pending.ready_amount*100)!==Math.round(co.totals.ready_amount*100)))throw new Error('Budget pending differs from finance page');
  if(hash()!==before)throw new Error('Read-only verification changed data');
  console.log(JSON.stringify({verification:'0.7.10',unchanged:true,fy:fy,
    round_links_from_history:fromHistory.length,amount_changed_by_history:shifted.length,
    amount_delta:Math.round(shifted.reduce((a,n)=>a+effAmount_(n)-effAmount_(raw.filter(x=>x.notice_uid===n.notice_uid)[0]),0)*100)/100,
    dashboard_check:dash.totals.money.check,dashboard_free_expired:dash.totals.free_expired,
    compensation:{c60:comp.totals.c60,recorded60:comp.totals.paid60,unrecorded60:comp.totals.pending60,unrecorded_rounds:comp.unrecorded_rounds},
    ledger_without_round:ledgerNoRound,budget_pending:tr.budget_pending,budget_register_amount:tr.totals.amount}));
}
function apiRoundPayment_(ctx, d) {
  const ref = str_(d.payment_ref, 200), date = String(d.payment_date || '');
  if (!ref || !validIso_(date)) throw appErr_('BAD_REQUEST', 'ระบุวันที่จ่ายจริงและเลขที่หลักฐาน');
  const table = readTable_('PAYOUT_ROUNDS'), r = table.rows.filter(function (x) { return x.round_id === String(d.round_id); })[0];
  if (!r || r.status !== 'CONFIRMED') throw appErr_('NOT_FOUND', 'ไม่พบรอบที่ยืนยันแล้ว');
  if (r.payment_status === 'PAID') throw appErr_('ALREADY_PAID', 'รอบนี้บันทึกจ่ายจริงแล้ว');
  r.payment_status = 'PAID'; r.payment_date = date; r.payment_ref = ref; r.payment_by = ctx.user.code; r.payment_at = now_();
  updateRow_('PAYOUT_ROUNDS', r._r, r); audit_(ctx.user.code, 'ROUND_PAYMENT', r.round_id, { date: date, reference: ref }); return { round_id: r.round_id, payment_date: date };
}
/**
 * 0.7.10 บันทึกหลักฐานจ่ายจริงหลายรอบพร้อมกัน (การเงิน/ผู้ดูแล) — สำหรับรอบที่จ่ายเงินแล้วแต่ยังไม่ได้บันทึกในระบบ
 * วันที่จ่ายจริง: ระบุวันเดียวให้ทุกรอบ หรือ use_pay_date = ใช้วันที่ของแต่ละรอบ · ไม่เปลี่ยนยอด/เศษ/รายการของรอบ
 */
function apiRoundPaymentBulk_(ctx, d) {
  const ref = str_(d.payment_ref, 200), ids = Array.isArray(d.round_ids) ? d.round_ids.map(String).filter(String) : [];
  const usePay = d.use_pay_date === true || String(d.use_pay_date) === 'true', date = String(d.payment_date || '');
  if (!ids.length) throw appErr_('BAD_REQUEST', 'เลือกรอบที่จ่ายเงินแล้ว');
  if (ids.length > 200) throw appErr_('BAD_REQUEST', 'เลือกได้ครั้งละไม่เกิน 200 รอบ');
  if (!ref) throw appErr_('BAD_REQUEST', 'ระบุเลขที่หลักฐาน / เอกสารการจ่าย');
  if (!usePay && !validIso_(date)) throw appErr_('BAD_REQUEST', 'ระบุวันที่จ่ายจริง หรือเลือกใช้วันที่ของแต่ละรอบ');
  const want = {}; ids.forEach(function (x) { want[x] = true; });
  return lockedEdit_(ctx, function () {
    const table = readTable_('PAYOUT_ROUNDS'), ts = now_(), done = [], skipped = [];
    table.rows.forEach(function (r) {
      if (!want[r.round_id]) return;
      if (r.status !== 'CONFIRMED' || r.payment_status === 'PAID') { skipped.push(r.round_id); return; }
      const pd = usePay ? String(r.pay_date || '').slice(0, 10) : date;
      if (!validIso_(pd)) { skipped.push(r.round_id); return; }
      r.payment_status = 'PAID'; r.payment_date = pd; r.payment_ref = ref; r.payment_by = ctx.user.code; r.payment_at = ts;
      updateRow_('PAYOUT_ROUNDS', r._r, r); done.push({ round_id: r.round_id, payment_date: pd });
    });
    ids.forEach(function (x) { if (!done.some(function (o) { return o.round_id === x; }) && skipped.indexOf(x) < 0) skipped.push(x); });
    if (done.length) audit_(ctx.user.code, 'ROUND_PAYMENT_BULK', done.map(function (o) { return o.round_id; }).join(',').slice(0, 900), { reference: ref, use_pay_date: usePay, date: usePay ? '' : date, n: done.length });
    return { updated: done.length, rounds: done, skipped: skipped };
  });
}
function validIso_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const d = new Date(String(s) + 'T12:00:00Z'); return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === String(s);
}

/** Owner/editor verification only. No setup, writes, imports, recalculation or payments. */
function verifyRelease075ReadOnly() {
  const tables = ['NOTICES','BUDGET_UNITS','LEDGER','PAYOUT_ROUNDS','PAYOUT_ITEMS','RATE_AREAS','RATE_BUDGET','CALC_RULES','CONFIG'];
  const before = {}; tables.forEach(function(k) { before[k] = digestJson_(readTable_(k).rows); });
  const ctx = {user:{code:'READ_ONLY_VERIFY',roles:['ADMIN']}}, fy = String(currentFy_());
  const tracking = trackingData_(ctx,{fy:fy}), report = apiCloseout_(ctx,{fy:fy});
  if (tracking.round_summary.count !== readTable_('PAYOUT_ROUNDS').rows.filter(function(r) { return r.status==='CONFIRMED' && String(r.fy)===fy; }).length) throw new Error('Round filter failed');
  const synthetic = normalizeIncomingImport_({action:'import_preview',mapping:{case_no:'case',recipient:'party',delivered_date:'date'},rows:[{case:'TEST/2569',party:'ชื่อคู่ความจำลอง',date:46332,plaintiff:'ไม่นำเข้า'}]});
  if (JSON.stringify(synthetic).indexOf('ชื่อคู่ความจำลอง')>=0 || synthetic.rows[0].date!=='2026-11-06') throw new Error('Import normalization failed');
  const nt = readTable_('NOTICES').rows, names=officerNames_(), officers=officersAll_();
  const ledger=readTable_('LEDGER').rows.filter(function(r){return r.source==='PAY';}).map(function(r) {
    return {case_no:r.case_no,recipient:r.recipient,officer:(names[r.officer_id]||{}).name||r.officer_raw,amount:Number(r.amount)||0};
  });
  const rawMatches=ledgerMatch_(ledger,nt,officers,'PAID'), privateMatches=ledgerMatch_(ledger.map(function(r){return Object.assign({},r,{recipient:NoticeImportFormat.recipient(r.case_no,r.recipient)});}),nt,officers,'PAID');
  if (JSON.stringify(rawMatches.map(function(r){return [r.match,r.notice_uids];}))!==JSON.stringify(privateMatches.map(function(r){return [r.match,r.notice_uids];}))) throw new Error('Legacy matching changed');
  const after = {}; tables.forEach(function(k) { after[k] = digestJson_(readTable_(k).rows); });
  const unchanged=JSON.stringify(before)===JSON.stringify(after); if(!unchanged)throw new Error('Read-only verification changed data');
  console.log(JSON.stringify({verification:'0.7.5',unchanged:unchanged,tables:tables.length,notices:nt.length,ledger_rows:ledger.length,legacy_matching_equal:true,tracking:tracking.totals,rounds:tracking.round_summary,closeout:report.totals}));
}

/** รายงานปัจจุบันสำหรับประเมินงบ: อ่านอย่างเดียว ไม่เปลี่ยนยอด/เศษ/สถานะรอบ */
function apiCloseout_(ctx, d) {
  if (!hasRole_(ctx.user, ['FINANCE', 'NOTICE', 'ADMIN'])) throw appErr_('FORBIDDEN', 'รายงานตรวจสอบก่อนปิดงบสำหรับงานหมายและการเงิน');
  const fy = String(d.fy || currentFy_());
  if (!/^25\d{2}$/.test(fy)) throw appErr_('BAD_REQUEST', 'ระบุปีงบประมาณ พ.ศ. 4 หลัก');
  const lock = writeLock_(); lock.waitLock(30000);
  try {
    const today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
    return closeoutData_(readTable_('NOTICES').rows, readTable_('PAYOUT_ROUNDS').rows,
      readTable_('PAYOUT_ITEMS').rows, officerNames_(), fy, today, readTable_('BUDGET_UNITS').rows);
  } finally { lock.releaseLock(); }
}
function closeoutData_(notices, rounds, payoutItems, names, fy, today, budgetUnits) {
  const year = Number(fy) - 543, from = (year - 1) + '-10-01', end = year + '-09-30';
  if (today < from) throw appErr_('BAD_REQUEST', 'ยังไม่เริ่มปีงบประมาณที่เลือก');
  const to = today < end ? today : end, expired = today > end;
  notices = linkNotices_(notices, rounds, payoutItems);              // 0.7.10 หมายที่ช่องรอบว่างแต่มีประวัติรอบ = เบิกแล้ว
  const confirmed = {}, claimed = {}, legacyUnits = {}, lockedUnits = {};
  rounds.forEach(function(r) { if (r.status === 'CONFIRMED') confirmed[r.round_id] = r; });
  payoutItems.forEach(function(it) {
    if (!confirmed[it.round_id] || String(it.included).toUpperCase() !== 'TRUE') return;
    String(it.notice_uids || '').split(',').filter(String).forEach(function(uid) { claimed[uid] = true; });
  });
  (budgetUnits || []).forEach(function(u) {
    if (u.claim_ref || /^(CLAIMED|PAID)$/.test(String(u.status || ''))) legacyUnits[u.unit_id] = true;
    else if (unitLocked_(u) && !confirmed[u.payout_round_id]) lockedUnits[u.unit_id] = true;
  });
  // ใช้ตัวคำนวณเสนอเบิกเดิม รวม rule7Cap_ และราคาบัญชี 18 ไม่เขียนกลับตาราง
  const candidates = {};
  payoutFreeItems_(notices, { cutoff: to, today: today }).items.forEach(function(it) { candidates[it.notice_uids[0]] = it; });
  const totals = { count: 0, ready_n: 0, ready_units: 0, ready_amount: 0, wait_n: 0, review_n: 0, noclaim_n: 0, excluded_claimed: 0 };
  const units = {}, per = {}, rows = [];
  notices.forEach(function(n) {
    if (n.pay_type !== 'BUDGET' || String(n.fy) !== fy) return;
    const issued = String(n.issued_date || '').slice(0, 10), delivered = String(n.delivered_date || '').slice(0, 10);
    if (issued && issued > to) return;
    if (claimed[n.notice_uid] || confirmed[n.payout_round_id] || n.claim_status || legacyUnits[n.budget_unit_id]) { totals.excluded_claimed++; return; }
    const it = candidates[n.notice_uid], rule = String(n.calc_rule || '');
    let status = 'REVIEW', reason = 'รอตรวจข้อมูลก่อนเสนอเบิก', amountC = 0;
    if (expired || n.noclaim_at || (issued && issued < from) || rule === 'PRE_START') {
      status = 'NOCLAIM'; reason = expired ? 'ไม่เบิกจ่าย — ไม่ได้เบิกภายในปีงบประมาณ' : n.noclaim_at ? 'ไม่เบิกจ่าย — ปิดไม่เบิกไว้แล้ว' : 'ไม่เบิกจ่าย — จ่ายหมายก่อนเริ่มปีงบประมาณ';
    } else if (n.payout_round_id || lockedUnits[n.budget_unit_id]) {
      reason = 'มีรหัสรอบเดิมที่ต้องตรวจสอบประวัติ';
    } else if (!delivered) {
      status = 'WAIT'; reason = 'ยังไม่มีข้อมูลผลส่ง — ยังประเมินยอดเบิกไม่ได้';
    } else if (delivered < from || delivered > to) {
      reason = 'วันที่ส่งอยู่นอกช่วงตรวจสอบ';
    } else if (it) {
      status = 'READY'; reason = it.amount_c === 0 ? 'รวมยอดในหน่วยเบิกเดียวกัน — ไม่นับเงินซ้ำ' : it.held ? 'มีผลส่งแล้ว — เคยเลื่อนไปรอบหน้า' : 'มีผลส่งแล้ว — ยังไม่พบการเบิก';
      amountC = it.amount_c;
    } else if (repDate_(n) > to) {
      reason = 'วันที่รายงานผลอยู่นอกช่วงตรวจสอบ';
    }
    const oid = String(n.officer_id || ''), unit = String(n.claim_piece || n.budget_unit_id || n.notice_uid);
    const p = per[oid] = per[oid] || { officer_id: oid, officer: (names[oid] || {}).full_name || (names[oid] || {}).name || n.officer_raw || oid,
      count: 0, ready_n: 0, ready_units: 0, ready_amount: 0, wait_n: 0, review_n: 0, noclaim_n: 0 };
    totals.count++; p.count++;
    const k = status === 'READY' ? 'ready_n' : status === 'WAIT' ? 'wait_n' : status === 'NOCLAIM' ? 'noclaim_n' : 'review_n';
    totals[k]++; p[k]++;
    if (status === 'READY') {
      totals.ready_amount += amountC; p.ready_amount += amountC;
      if (!units[unit]) { units[unit] = true; totals.ready_units++; p.ready_units++; }
    }
    rows.push({ notice_uid: n.notice_uid, case_no: n.case_no, notice_no: n.notice_no || '', notice_kind: n.notice_kind || '',
      recipient: n.recipient || '', officer_id: oid, officer: p.officer,
      place: [n.house_no, n.moo ? 'ม.' + n.moo : '', n.place_key && !/^X:/.test(n.place_key) ? n.place_key.replace(/^GOV:/, 'หน่วยงาน ') : '', n.tambon ? 'ต.' + n.tambon : '', n.amphoe ? 'อ.' + n.amphoe : ''].filter(String).join(' '),
      issued_date: issued, delivered_date: delivered, report_date: repDate_(n), unit_id: unit,
      amount: amountC / 100, reference: it ? it.amount_c / 100 : effAmount_(n), source: it && it.src === 'COURT' ? 'บัญชีศาล 18 / ตรวจรวมหน่วยเดิม' : 'คำนวณตามกฎเดิม',
      status: status, reason: reason });
  });
  totals.ready_amount /= 100;
  const officers = Object.keys(per).map(function(id) { per[id].ready_amount /= 100; return per[id]; }).sort(function(a,b) { return a.officer.localeCompare(b.officer, 'th'); });
  rows.sort(function(a,b) { return String(a.officer).localeCompare(String(b.officer), 'th') || String(a.case_no).localeCompare(String(b.case_no), 'th') || String(a.notice_uid).localeCompare(String(b.notice_uid)); });
  return { report_mode: 'closeout', report_version: '0.7.9', fy: fy, from: from, to: to, fiscal_end: end, checked_at: now_(), today: today, expired: expired,
    rows: rows, per_officer: officers, totals: totals, last_imports: lastImports_(), data_period: dashboardPeriod_(readTable_('IMPORT_BATCHES').rows, fy) };
}

/** Owner-run read-only verification; no route and no persistent state changes. */
function verifyCloseoutReadOnly() {
  const tables = ['NOTICES','BUDGET_UNITS','LEDGER','PAYOUT_ROUNDS','PAYOUT_ITEMS','RATE_AREAS','RATE_BUDGET','CALC_RULES','CONFIG'];
  const hash = function() {
    DB_CACHE_ = null; HEAD_CACHE_ = {};
    return tables.map(function(k) { const rows = readTable_(k).rows; return { table: k, rows: rows.length, hash: Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(rows))) }; });
  };
  const before = hash(), report = apiCloseout_({user:{roles:['ADMIN']}},{fy:currentFy_()}), after = hash();
  const rateMap = {}; readTable_('RATE_AREAS').rows.forEach(function(a) { rateMap[a.area_id] = a; });
  const names = officerNames_(), adjustments = readTable_('NOTICES').rows.filter(function(n) { return n.fy === currentFy_() && amountAdj_(n); }).map(function(n) {
    const a = rateMap[n.area_id] || {}, adj = amountAdj_(n);
    return { officer: (names[n.officer_id] || {}).name || n.officer_raw, tambon: n.tambon, amphoe: n.amphoe,
      file: adj.src, rate_snapshot: adj.rate, rate_current: Number(a.rate) || 0, calculated: Number(n.calc_amount) || 0,
      matches_area: resolveArea_(n.amphoe,n.tambon,buildAreaIndex_(readTable_('RATE_AREAS').rows)) === n.area_id, difference: adj.diff, direction: adj.dir };
  });
  const rounds = readTable_('PAYOUT_ROUNDS').rows.filter(function(r) {return r.status==='CONFIRMED';});
  console.log(JSON.stringify({verification:'closeout-0.7.2',unchanged:JSON.stringify(before)===JSON.stringify(after),before:before,after:after,
    report:report.totals,period:report.data_period,rounds:rounds.length,round_total:rounds.reduce(function(s,r){return s+cents2_(r.total);},0)/100,adjustments:adjustments}));
}
