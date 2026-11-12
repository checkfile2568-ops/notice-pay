/* ============================================================================
   ระบบค่าหมาย · app.js  (หน้าเว็บบน GitHub Pages — เรียก API Apps Script)
   ระยะ 1–2 : เข้าใช้งานด้วยบัญชีปริ้นฮับ · หน้าแรก · ค้นหาหมาย · นำเข้า 2 ขั้น
              · ประวัติการนำเข้า · ผู้ส่งหมายและอัตรา · ผู้ใช้และสิทธิ์
   ไม่เก็บ token ไว้ในเครื่อง — เปิด/รีเฟรชหน้าใหม่ต้องใส่ PIN ทุกครั้ง (เหมือนระบบวัสดุ)
   ========================================================================== */
(function () {
  'use strict';
  const C = window.NP_CONFIG || {};
  const $ = (s, el) => (el || document).querySelector(s);
  const S = { token: '', user: null, page: 'home', pick: null, pin: '', busy: false, fy: '' };

  /* ---------------------------------------------------------------- ตัวช่วย */
  const esc = (v) => String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const num = (n) => Number(n || 0).toLocaleString('th-TH');
  const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  function thDate(iso, withTime) {
    const s = String(iso || ''); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if (!m) return s;
    return (+m[3]) + ' ' + TH_M[+m[2] - 1] + ' ' + (+m[1] + 543) + (withTime && m[4] ? ' ' + m[4] + ':' + m[5] + ' น.' : '');
  }
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 3800);
  }
  const PAY_TH = { PAID: 'มีเงิน', BUDGET: 'ฟรี' };
  const STATUS_TH = { ISSUED: 'จ่ายหมายแล้ว รอผล', DELIVERED: 'ส่งแล้ว', REVIEW: 'รอตรวจสอบ' };
  const CLS_TH = { NEW: 'ใหม่', SAME: 'เดิมตรงกัน', CHANGED: 'เปลี่ยนแปลง', HELD: 'รออนุมัติแก้', AMBIGUOUS: 'กำกวม', ERROR: 'ผิดพลาด', OUTSIDE: 'ก่อนปีงบเริ่มระบบ' };
  const FLAGS_RED = ['เงินไม่เท่ากับอัตราของตำบล'];
  /** หมายเหตุของหมาย — ข้อที่ต้องเห็นชัดแสดงอักษรสีแดง */
  const flagHtml = (f) => String(f || '').split(';').filter(Boolean)
    .map((x) => '<span class="tiny ' + (FLAGS_RED.indexOf(x) >= 0 ? 'flag-r' : 'flag-a') + '">' + esc(x) + '</span>').join('<br>');

  /* ---------------------------------------------------------------- API */
  async function api(action, body) {
    if (!C.API_URL || /วางลิงก์/.test(C.API_URL)) throw Object.assign(new Error('ยังไม่ได้ตั้งค่า API_URL ใน config.js'), { code: 'CONFIG' });
    let res;
    try {
      res = await fetch(C.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action: action, token: S.token }, body || {})) });
    } catch (e) { throw Object.assign(new Error('เชื่อมต่อระบบไม่ได้ ตรวจสอบอินเทอร์เน็ต'), { code: 'NETWORK' }); }
    let j;
    try { j = await res.json(); } catch (e) { throw Object.assign(new Error('ระบบตอบกลับไม่ถูกต้อง'), { code: 'BAD_RESPONSE' }); }
    if (!j.ok) {
      const err = Object.assign(new Error(j.msg || 'เกิดข้อผิดพลาด'), { code: j.code, extra: j.extra });
      if (S.token && /SESSION_EXPIRED|SESSION_REVOKED|NO_ACCESS/.test(j.code)) { toast(err.message); backToLogin(); }
      throw err;
    }
    return j.data;
  }

  /* ================================================================ เข้าสู่ระบบ */
  function initLogin() {
    $('#ver').textContent = 'รุ่น ' + (C.VERSION || '');
    if (C.SEAL_URL) document.querySelectorAll('.seal').forEach((s) => { s.innerHTML = '<img src="' + esc(C.SEAL_URL) + '" alt="">'; });
    let t;
    $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 250); });
    $('#changeWho').addEventListener('click', () => showStep(1));
    const kp = $('#keypad');
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'B'].forEach((k) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'key' + (k === 'C' ? ' clr' : '');
      if (k === 'C') { b.textContent = 'ล้าง'; b.setAttribute('aria-label', 'ล้าง PIN'); }
      else if (k === 'B') { b.setAttribute('aria-label', 'ลบตัวสุดท้าย'); b.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#1D3A2C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="M17 9l-5 6"/><path d="M12 9l5 6"/></svg>'; }
      else { b.textContent = k; b.setAttribute('aria-label', 'เลข ' + k); }
      b.addEventListener('click', () => press(k));
      kp.appendChild(b);
    });
    document.addEventListener('keydown', (e) => {
      if ($('#step2').classList.contains('hidden') || $('#login').classList.contains('hidden')) return;
      if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('B'); else if (e.key === 'Escape') showStep(1);
    });
    $('#q').focus();
  }

  async function search() {
    const q = $('#q').value.trim();
    const box = $('#picks');
    if (!q) { box.innerHTML = ''; return; }
    box.innerHTML = '<p class="muted small" style="margin:0;text-align:center"><span class="spin"></span></p>';
    try {
      const d = await api('search_accounts', { q: q });
      if (q !== $('#q').value.trim()) return;
      if (!d.users.length) { box.innerHTML = '<p class="sunk small muted" style="margin:0;padding:14px;text-align:center">ไม่พบชื่อที่ค้นหา</p>'; return; }
      box.innerHTML = d.users.map((u, i) => {
        const at = u.name.indexOf(q);
        const nm = at >= 0 ? esc(u.name.slice(0, at)) + '<mark>' + esc(q) + '</mark>' + esc(u.name.slice(at + q.length)) : esc(u.name);
        return '<button type="button" role="listitem" class="pick" data-i="' + i + '"><span class="avatar av' + (i % 4) + '" aria-hidden="true">' + esc(u.name.charAt(0)) +
          '</span><span class="nm"><b>' + nm + '</b><span>' + esc(u.dept || '—') + '</span></span>' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2E6B4F" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>';
      }).join('') + '<div style="display:flex;justify-content:flex-end"><button type="button" class="btn btn-sm" id="reSearch">ค้นหาใหม่</button></div>';
      box.querySelectorAll('.pick').forEach((b) => b.addEventListener('click', () => { S.pick = d.users[+b.dataset.i]; S.pickAv = +b.dataset.i % 4; showStep(2); }));
      $('#reSearch').addEventListener('click', () => { $('#q').value = ''; box.innerHTML = ''; $('#q').focus(); });
    } catch (e) { box.innerHTML = '<p class="note r" style="margin:0">' + esc(e.message) + '</p>'; }
  }

  function showStep(n) {
    $('#step1').classList.toggle('hidden', n !== 1);
    $('#step2').classList.toggle('hidden', n !== 2);
    $('#welcome').classList.toggle('hidden', n === 2);
    $('#st1').classList.toggle('on', n === 1);
    $('#st2').classList.toggle('on', n === 2);
    $('#st1 b').textContent = n === 2 ? '✓' : '1';
    S.pin = ''; drawDots(); pinMsg('แตะตัวเลข ระบบตรวจทันทีเมื่อครบ 4 หลัก');
    if (n === 2) {
      $('#whoAv').textContent = S.pick.name.charAt(0); $('#whoAv').className = 'avatar av' + (S.pickAv || 0);
      $('#whoName').textContent = S.pick.name; $('#whoDept').textContent = S.pick.dept || '';
      $('#keypad button').focus();
    } else $('#q').focus();
  }
  function drawDots() {
    const ds = document.querySelectorAll('#dots .dot');
    ds.forEach((d, i) => d.classList.toggle('on', i < S.pin.length));
    $('#dots').setAttribute('aria-label', 'ใส่แล้ว ' + S.pin.length + ' จาก 4 หลัก');
  }
  function pinMsg(t, cls) { const m = $('#pinMsg'); m.textContent = t; m.className = 'pin-msg' + (cls ? ' ' + cls : ''); }
  function press(k) {
    if (S.busy) return;
    if (k === 'C') S.pin = '';
    else if (k === 'B') S.pin = S.pin.slice(0, -1);
    else if (S.pin.length < 4) S.pin += k;
    drawDots();
    if (S.pin.length === 4) doLogin();
  }
  async function doLogin() {
    S.busy = true; pinMsg('กำลังตรวจสอบกับบัญชีปริ้นฮับ…');
    try {
      const d = await api('login', { code: S.pick.code, pin: S.pin });
      S.token = d.token; S.user = d.user;
      pinMsg('เข้าสู่ระบบสำเร็จ', 'ok');
      setTimeout(enterApp, 250);
    } catch (e) {
      S.pin = ''; drawDots(); pinMsg(e.message, 'err');
      const dots = $('#dots'); dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
    } finally { S.busy = false; }
  }
  function backToLogin() {
    S.token = ''; S.user = null; S.pick = null;
    $('#app').classList.add('hidden'); $('#login').classList.remove('hidden');
    $('#q').value = ''; $('#picks').innerHTML = ''; showStep(1);
  }

  /* ================================================================ โครงแอป */
  const has = (...r) => S.user && S.user.roles.some((x) => r.indexOf(x) >= 0);
  function pages() {
    return [
      { id: 'home', th: 'หน้าแรก', show: true },
      { id: 'search', th: 'ค้นหาหมาย', show: true },
      { id: 'import', th: 'นำเข้าข้อมูล', show: has('NOTICE', 'ADMIN') },
      { id: 'history', th: 'ประวัติการนำเข้า', show: has('NOTICE', 'FINANCE', 'ADMIN') },
      { id: 'officers', th: 'ผู้ส่งหมายและอัตรา', show: true },
      { id: 'users', th: 'ผู้ใช้และสิทธิ์', show: has('ADMIN') },
      { id: '_s', sec: 'กำลังพัฒนา' },
      { id: 'soon-status', th: 'สถานะการเบิกจ่าย', soon: 'ระยะ 5', show: true },
      { id: 'soon-payout', th: 'วันจ่าย 60:40', soon: 'ระยะ 4', show: has('NOTICE', 'FINANCE', 'ADMIN') },
      { id: 'soon-report', th: 'รายงาน / ปิดปีงบ', soon: 'ระยะ 5', show: has('FINANCE', 'ADMIN') }
    ];
  }
  function enterApp() {
    $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
    $('#meName').textContent = S.user.name; $('#meRoles').textContent = S.user.roles_th.join(' · ');
    $('#meAv').textContent = S.user.name.charAt(0);
    $('#logout').onclick = async () => { try { await api('logout'); } catch (e) {} backToLogin(); };
    drawNav(); go('home');
  }
  function drawNav() {
    $('#nav').innerHTML = pages().filter((p) => p.sec || p.show).map((p) => p.sec
      ? '<div class="nav-sec">' + esc(p.sec) + '</div>'
      : '<button type="button" data-p="' + p.id + '"' + (p.soon ? ' disabled' : '') + (S.page === p.id ? ' class="on" aria-current="page"' : '') + '>' +
        esc(p.th) + (p.soon ? '<span class="soon">' + esc(p.soon) + '</span>' : '') + '</button>').join('');
    $('#nav').querySelectorAll('button[data-p]:not([disabled])').forEach((b) => b.addEventListener('click', () => go(b.dataset.p)));
  }
  const RENDER = {};
  function go(p) {
    S.page = p; drawNav();
    const m = $('#main');
    m.innerHTML = '<div class="clay panel"><span class="spin"></span> <span class="muted">กำลังโหลด…</span></div>';
    Promise.resolve(RENDER[p](m)).catch((e) => { m.innerHTML = '<div class="clay panel"><p class="note r" style="margin:0">' + esc(e.message) + '</p></div>'; });
    m.focus({ preventScroll: true }); window.scrollTo(0, 0);
  }
  function top(title, extra) { return '<div class="top clay"><h2>' + esc(title) + '</h2>' + (extra || '') + '</div>'; }

  /* ---------------------------------------------------------------- หน้าแรก */
  RENDER.home = async (m) => {
    const d = await api('dashboard', { fy: S.fy });
    S.fy = d.fy;
    const t = d.totals;
    const fySel = '<label class="small muted" for="fy">ปีงบประมาณ</label> <select id="fy" class="sel">' +
      d.fys.map((y) => '<option' + (y === d.fy ? ' selected' : '') + '>' + esc(y) + '</option>').join('') + '</select>';
    const kpi = (lbl, v, cls) => '<div class="kpi clay ' + (cls || '') + '"><span>' + esc(lbl) + '</span><b>' + num(v) + '</b></div>';
    const notes = [];
    if (d.pending_review) notes.push('<div class="note">มีแถวรอตรวจสอบจากการนำเข้า ' + num(d.pending_review) + ' แถว (ดูในประวัติการนำเข้า)</div>');
    if (d.pending_changes) notes.push('<div class="note">มีรายการแก้ไขหมายที่ล็อกแล้ว รออนุมัติ ' + num(d.pending_changes) + ' รายการ</div>');
    if (t.flagged) notes.push('<div class="note">หมาย ' + num(t.flagged) + ' ฉบับ ไม่พบตำบลในตารางอัตรา — ตรวจชื่อตำบล/อำเภอในไฟล์ต้นทาง</div>');
    m.innerHTML = top('หน้าแรก', fySel) +
      '<div class="grid-k">' + kpi('หมายทั้งหมด', t.total, 'mint') + kpi('หมายมีเงิน', t.paid) + kpi('หมายฟรี', t.free) +
      kpi('จ่ายหมายแล้ว รอผล', t.issued) + kpi('ส่งแล้ว', t.delivered) + '</div>' +
      (notes.length ? '<div style="display:flex;flex-direction:column;gap:10px">' + notes.join('') + '</div>' : '') +
      '<div class="clay panel"><h3>' + (d.scope_officer ? 'หมายของฉัน' : 'แยกรายผู้ส่งหมาย') + '</h3><div class="tbl-wrap"><table><thead><tr><th>ผู้ส่งหมาย</th>' +
      '<th class="n">มีเงิน รอผล</th><th class="n">มีเงิน ส่งแล้ว</th><th class="n">ฟรี รอผล</th><th class="n">ฟรี ส่งแล้ว</th><th class="n">รวม</th></tr></thead><tbody>' +
      d.officers.map((o) => '<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + esc(o.color) + ';margin-right:8px"></span>' + esc(o.name) + '</td>' +
        '<td class="n">' + num(o.paid_issued) + '</td><td class="n">' + num(o.paid_delivered) + '</td><td class="n">' + num(o.free_issued) + '</td><td class="n">' + num(o.free_delivered) +
        '</td><td class="n"><b>' + num(o.paid_issued + o.paid_delivered + o.free_issued + o.free_delivered) + '</b></td></tr>').join('') +
      '</tbody></table></div></div>' +
      '<p class="small muted" style="margin:0 6px">ข้อมูลล่าสุด ณ นำเข้าไฟล์จ่ายหมาย ' + esc(thDate(d.last_issue_import, true) || '—') +
      ' · ไฟล์ผลหมาย ' + esc(thDate(d.last_result_import, true) || '—') + ' · ยอดเงินและสถานะเบิกจ่ายจะแสดงเมื่อเปิดใช้ระยะ 3–5</p>';
    $('#fy').addEventListener('change', (e) => { S.fy = e.target.value; go('home'); });
  };

  /* ---------------------------------------------------------------- ค้นหาหมาย */
  RENDER.search = (m) => {
    m.innerHTML = top('ค้นหาหมาย') +
      '<form class="clay panel row" id="sf"><label class="sr" for="sq">เลขคดี เลขหมาย หรือชื่อผู้รับ</label>' +
      '<input id="sq" class="inp" style="flex:1;min-width:220px" placeholder="เลขดำ เลขแดง หรือชื่อผู้รับ เช่น ต1250/2569">' +
      '<button class="btn btn-g">ค้นหา</button></form><div id="sr"></div>';
    $('#sq').focus();
    $('#sf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const out = $('#sr'); out.innerHTML = '<div class="clay panel"><span class="spin"></span></div>';
      try {
        const d = await api('notice_search', { q: $('#sq').value });
        out.innerHTML = '<div class="clay panel"><h3>พบ ' + num(d.rows.length) + ' รายการ</h3>' + (d.rows.length ? '<div class="tbl-wrap"><table><thead><tr><th>เลขคดี</th><th>ชนิดหมาย</th><th>ประเภท</th><th>ผู้รับ / พื้นที่</th><th>ผู้ส่ง</th><th>จ่ายหมาย</th><th>ส่ง</th><th>สถานะ</th></tr></thead><tbody>' +
          d.rows.map((r) => '<tr><td><b>' + esc(r.case_no) + '</b>' + (r.case_ref ? '<br><span class="tiny muted">' + esc(r.case_ref) + '</span>' : '') + '</td><td>' + esc(r.notice_kind || r.notice_no) + '</td><td><span class="pill ' + (r.pay_type === 'BUDGET' ? 'b' : 'g') + '">' + esc(PAY_TH[r.pay_type] || r.pay_type) + '</span>' +
            (r.pay_type === 'PAID' && r.amount !== '' ? '<br><span class="tiny">' + num(r.amount) + ' บาท</span>' : '') + '</td>' +
            '<td>' + esc(r.recipient) + '<br><span class="tiny muted">' + esc(r.place) + '</span></td><td>' + esc(r.officer) + '</td><td>' + esc(thDate(r.issued_date)) + '</td><td>' + esc(thDate(r.delivered_date)) +
            (r.result ? '<br><span class="tiny muted">' + esc(r.result) + '</span>' : '') + '</td><td><span class="pill ' + (r.status === 'DELIVERED' ? 'g' : 'a') + '">' + esc(STATUS_TH[r.status] || r.status) + '</span>' +
            (r.flags ? '<br>' + flagHtml(r.flags) : '') + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="muted" style="margin:0">ไม่พบหมาย</p>') + '</div>';
      } catch (er) { out.innerHTML = '<div class="clay panel"><p class="note r" style="margin:0">' + esc(er.message) + '</p></div>'; }
    });
  };

  /* ---------------------------------------------------------------- นำเข้าข้อมูล */
  const IM = {};
  function resetImport() { Object.keys(IM).forEach((k) => { if (k !== 'meta') delete IM[k]; }); }
  const normH = (s) => String(s || '').replace(/[๐-๙]/g, (c) => String(c.charCodeAt(0) - 0x0E50)).replace(/\s+/g, '').toLowerCase();

  RENDER.import = async (m) => {
    if (!IM.meta) IM.meta = await api('import_templates');
    resetImport();
    m.innerHTML = top('นำเข้าข้อมูล') +
      '<div class="clay panel"><h3>1 · เลือกชนิดไฟล์</h3><div class="kinds">' +
      '<button type="button" class="kind clay-mint" data-k="ISSUE"><b>ไฟล์จ่ายหมาย</b><span class="small">นำเข้าวันที่จ่ายหมาย — แบบรวมทุกคน หรือแยกรายคน · หมายใหม่จะมีสถานะ "จ่ายหมายแล้ว รอผล"</span></button>' +
      '<button type="button" class="kind clay-mint" data-k="RESULT"><b>ไฟล์ผลหมาย</b><span class="small">นำเข้าวันอื่นได้ — หมายที่ส่งแล้วพร้อมวันที่ส่ง · ระบบจับคู่กับหมายเดิมแล้วเปลี่ยนเป็น "ส่งแล้ว"</span></button>' +
      '</div></div><div id="imFile"></div><div id="imMap"></div><div id="imPrev"></div>' +
      (IM.meta.start_fy ? '<p class="small" style="margin:0 6px 6px"><span class="period">เริ่มประมวลผลตั้งแต่ปีงบประมาณ ' + esc(IM.meta.start_fy) + ' (1 ต.ค. ' + esc(Number(IM.meta.start_fy) - 1) + ')</span> หมายที่จ่ายก่อนวันนี้ไม่นำเข้า</p>' : '') +
      '<p class="small muted" style="margin:0 6px">กฎการนำเข้าตามข้อกำหนดฉบับ 4.0 ข้อ 3: นำเข้าไฟล์เดิมซ้ำได้ ยอดไม่เพิ่ม · ไม่ลบข้อมูลที่ไม่อยู่ในไฟล์ล่าสุด · หมายที่เข้ารอบจ่าย/เบิกแล้วจะไม่ถูกเขียนทับ</p>';
    m.querySelectorAll('.kind').forEach((b) => b.addEventListener('click', () => {
      m.querySelectorAll('.kind').forEach((x) => x.classList.toggle('on', x === b));
      resetImport(); IM.kind = b.dataset.k; drawFile();
    }));
  };

  function drawFile() {
    $('#imMap').innerHTML = ''; $('#imPrev').innerHTML = '';
    $('#imFile').innerHTML = '<div class="clay panel"><h3>2 · เลือกไฟล์ ' + (IM.kind === 'ISSUE' ? 'จ่ายหมาย' : 'ผลหมาย') + '</h3>' +
      '<label class="drop sunk" id="drop"><input type="file" id="fin" accept=".xlsx,.xls,.csv" class="sr">' +
      '<b>แตะเพื่อเลือกไฟล์ หรือลากไฟล์มาวาง</b><span class="small muted">รองรับ .xlsx .xls .csv · ไฟล์สะสมตั้งแต่ต้นปีงบได้</span></label><div id="fInfo"></div></div>';
    const drop = $('#drop');
    $('#fin').addEventListener('change', (e) => e.target.files[0] && readFile(e.target.files[0]));
    ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => e.dataTransfer.files[0] && readFile(e.dataTransfer.files[0]));
  }

  async function readFile(f) {
    if (!window.XLSX) { toast('กำลังโหลดตัวอ่าน Excel กรุณาลองอีกครั้ง'); return; }
    $('#fInfo').innerHTML = '<p class="small"><span class="spin"></span> กำลังอ่านไฟล์…</p>';
    try {
      const buf = await f.arrayBuffer();
      const dig = await crypto.subtle.digest('SHA-256', buf);
      IM.file = { name: f.name, size: f.size, checksum: Array.from(new Uint8Array(dig)).map((b) => b.toString(16).padStart(2, '0')).join('') };
      IM.wb = XLSX.read(buf, { type: 'array', cellDates: true });
      IM.sheet = IM.wb.SheetNames[0];
      loadSheet();
    } catch (e) { $('#fInfo').innerHTML = '<p class="note r">อ่านไฟล์ไม่ได้: ' + esc(e.message) + '</p>'; }
  }

  function cellVal(v) {
    if (v instanceof Date) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
    if (v === null || v === undefined) return '';
    return typeof v === 'string' ? v.trim() : v;
  }
  function loadSheet() {
    const aoa = XLSX.utils.sheet_to_json(IM.wb.Sheets[IM.sheet], { header: 1, raw: true, defval: '' });
    const syn = IM.meta.fields.flatMap((x) => x.syn.map(normH));
    let best = 0, bestScore = -1;
    for (let r = 0; r < Math.min(15, aoa.length); r++) {
      const score = aoa[r].filter((c) => { const h = normH(c); return h && syn.some((s) => h === s || h.indexOf(s) >= 0); }).length;
      if (score > bestScore) { bestScore = score; best = r; }
    }
    IM.headerRow = best;
    const seen = {};
    IM.headers = (aoa[best] || []).map((h, i) => {
      let n = String(cellVal(h) || ('คอลัมน์ ' + (i + 1))); if (seen[n]) n += ' (' + (++seen[n]) + ')'; else seen[n] = 1; return n;
    });
    // ช่วงวันที่ของรายงาน (บัญชีจ่ายหมายของศาลไม่มีวันที่จ่ายรายแถว) เช่น "ตั้งแต่วันที่ 1 พฤศจิกายน 2569 ถึงวันที่ 12 พฤศจิกายน 2569"
    IM.period = null;
    aoa.slice(0, best).forEach((r) => {
      const t = r.map((c) => String(cellVal(c))).join(' ').replace(/\s+/g, ' ');
      const m = t.match(/ตั้งแต่วันที่\s*(.+?)\s*ถึงวันที่\s*(.+?)\s*$/);
      if (m) IM.period = { from: m[1], to: m[2], text: t.trim() };
    });
    // ตัดแถวท้ายรายงาน (รวม … บาท · ลงชื่อ · ตรวจสอบแล้วถูกต้อง): ถ้ามีคอลัมน์ "ที่/ลำดับ" ใช้เฉพาะแถวที่เป็นตัวเลข
    const seq = (aoa[best] || []).findIndex((h) => ['ที่', 'ลำดับ', 'ลำดับที่'].indexOf(String(h).trim()) >= 0);
    IM.rows = []; IM.rowNos = []; IM.skipped = 0;
    aoa.slice(best + 1).forEach((r, k) => {
      if (!r.some((c) => String(c).trim() !== '')) return;
      if (seq >= 0 ? !/^\d+$/.test(String(r[seq]).trim()) : r.filter((c) => String(c).trim() !== '').length < 3) { IM.skipped++; return; }
      const o = {}; IM.headers.forEach((h, i) => { o[h] = cellVal(r[i]); });
      IM.rows.push(o); IM.rowNos.push(best + k + 2);
    });
    autoMap();
    $('#fInfo').innerHTML = '<div class="row small" style="margin-top:12px"><span class="pill g">' + esc(IM.file.name) + '</span>' +
      '<label for="shSel">แผ่นงาน</label><select id="shSel" class="sel">' + IM.wb.SheetNames.map((s) => '<option' + (s === IM.sheet ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select>' +
      '<span>หัวตารางแถวที่ ' + (IM.headerRow + 1) + ' · ข้อมูล ' + num(IM.rows.length) + ' แถว' + (IM.skipped ? ' · ข้ามแถวท้ายรายงาน ' + num(IM.skipped) + ' แถว' : '') + '</span>' +
      (IM.period ? '<span class="period small">ช่วงรายงาน ' + esc(IM.period.from) + ' – ' + esc(IM.period.to) + '</span>' : '') + '</div>';
    $('#shSel').addEventListener('change', (e) => { IM.sheet = e.target.value; loadSheet(); });
    drawMap();
  }

  function autoMap() {
    const tpl = IM.meta.templates[IM.kind] || {};
    const used = {};
    IM.mapping = {};
    IM.meta.fields.forEach((fd) => {
      const fromTpl = tpl.mapping && tpl.mapping[fd.f];
      if (fromTpl && IM.headers.indexOf(fromTpl) >= 0 && !used[fromTpl]) { IM.mapping[fd.f] = fromTpl; used[fromTpl] = 1; }
    });
    [true, false].forEach((exact) => IM.meta.fields.forEach((fd) => {
      if (IM.mapping[fd.f]) return;
      const hit = IM.headers.find((h) => !used[h] && fd.syn.some((s) => exact ? normH(h) === normH(s) : normH(h).indexOf(normH(s)) >= 0 && normH(s).length > 2));
      if (hit) { IM.mapping[fd.f] = hit; used[hit] = 1; }
    }));
    IM.keys = (tpl.key_fields && tpl.key_fields.length ? tpl.key_fields : IM.meta.default_keys).slice();
    IM.opts = { file_officer_id: '', default_pay_type: (tpl.options && tpl.options.default_pay_type) || '',
                period_from: IM.period ? IM.period.from : '', period_to: IM.period ? IM.period.to : '' };
  }

  function drawMap() {
    $('#imPrev').innerHTML = '';
    const RES_F = ['case_no', 'notice_no', 'notice_kind', 'recipient', 'officer', 'issued_date', 'delivered_date', 'reported_date', 'result'];
    const fields = IM.meta.fields.filter((fd) => IM.kind === 'ISSUE' ? ['reported_date'].indexOf(fd.f) < 0 : RES_F.indexOf(fd.f) >= 0);
    const isRes = IM.kind === 'RESULT';
    const opt = (sel) => '<option value="">— ไม่มีในไฟล์ —</option>' + IM.headers.map((h) => '<option' + (h === sel ? ' selected' : '') + '>' + esc(h) + '</option>').join('');
    const sample = IM.rows.slice(0, 2);
    $('#imMap').innerHTML = '<div class="clay panel"><h3>3 · จับคู่คอลัมน์</h3>' +
      '<p class="small muted" style="margin:0 0 12px">ระบบเดาให้จากชื่อหัวคอลัมน์และครั้งก่อน ตรวจแล้วแก้ได้ · ระบบจำการจับคู่ไว้ใช้ครั้งต่อไป · ' +
        (isRes ? 'ไฟล์ผลหมายจับคู่กับหมายเดิมด้วย <b>เลขคดี + ผู้รับ + ผู้ส่ง</b> (ไฟล์ผลไม่มีที่อยู่)' : '✓ = ใช้เป็นคีย์ไม่ซ้ำ (ไฟล์ของศาลไม่มีเลขหมาย ใช้ เลขคดี + ผู้รับ + ผู้ส่ง + ชนิดหมาย + บ้านเลขที่ + หมู่)') +
        ' · <b>ไม่อ่านคอลัมน์โจทก์/จำเลย</b> · ราคา 0.00 = หมายฟรี (เงินงบประมาณ)</p>' +
      '<div class="tbl-wrap"><table class="map"><thead><tr><th>คีย์</th><th>ข้อมูลในระบบ</th><th>คอลัมน์ในไฟล์</th><th>ตัวอย่าง</th></tr></thead><tbody>' +
      fields.map((fd) => '<tr><td>' + (isRes ? (['case_no', 'recipient', 'officer'].indexOf(fd.f) >= 0 ? '✓' : '') : '<input type="checkbox" class="kchk" data-f="' + fd.f + '"' + (IM.keys.indexOf(fd.f) >= 0 ? ' checked' : '') + ' aria-label="ใช้ ' + esc(fd.th) + ' เป็นคีย์">') + '</td>' +
        '<td><b>' + esc(fd.th) + '</b></td><td><select class="sel msel" data-f="' + fd.f + '" aria-label="คอลัมน์สำหรับ ' + esc(fd.th) + '">' + opt(IM.mapping[fd.f]) + '</select></td>' +
        '<td class="small muted mval" data-f="' + fd.f + '">' + sample.map((r) => esc(IM.mapping[fd.f] ? r[IM.mapping[fd.f]] : '')).join(' · ') + '</td></tr>').join('') +
      '</tbody></table></div>' +
      (IM.kind === 'ISSUE' ? '<div class="row" style="margin-top:14px"><label for="fOff" class="small"><b>ไฟล์แยกรายคน:</b> ผู้ส่งทั้งไฟล์</label><select id="fOff" class="sel"><option value="">— ใช้คอลัมน์ผู้ส่งในไฟล์ —</option>' +
        IM.meta.officers.map((o) => '<option value="' + esc(o.officer_id) + '"' + (IM.opts.file_officer_id === o.officer_id ? ' selected' : '') + '>' + esc(o.name) + '</option>').join('') + '</select>' +
        '<label for="fPay" class="small"><b>ประเภทหมายทั้งไฟล์</b></label><select id="fPay" class="sel"><option value="">— ใช้คอลัมน์ในไฟล์ —</option><option value="PAID"' + (IM.opts.default_pay_type === 'PAID' ? ' selected' : '') +
        '>มีเงินทั้งไฟล์</option><option value="BUDGET"' + (IM.opts.default_pay_type === 'BUDGET' ? ' selected' : '') + '>ฟรีทั้งไฟล์</option></select></div>' : '') +
      '<div class="row" style="margin-top:16px"><button type="button" class="btn btn-g" id="doPrev">ตรวจสอบก่อนนำเข้า</button><span class="small muted">ยังไม่บันทึกอะไรจนกว่าจะกดยืนยัน</span></div></div>';
    $('#imMap').querySelectorAll('.msel').forEach((s) => s.addEventListener('change', () => {
      IM.mapping[s.dataset.f] = s.value; IM.preview = null; $('#imPrev').innerHTML = '';
      $('#imMap .mval[data-f="' + s.dataset.f + '"]').innerHTML = IM.rows.slice(0, 2).map((r) => esc(s.value ? r[s.value] : '')).join(' · ');
    }));
    $('#imMap').querySelectorAll('.kchk').forEach((c) => c.addEventListener('change', () => {
      IM.keys = Array.from($('#imMap').querySelectorAll('.kchk:checked')).map((x) => x.dataset.f); IM.preview = null; $('#imPrev').innerHTML = '';
    }));
    if ($('#fOff')) $('#fOff').addEventListener('change', (e) => { IM.opts.file_officer_id = e.target.value; IM.preview = null; $('#imPrev').innerHTML = ''; });
    if ($('#fPay')) $('#fPay').addEventListener('change', (e) => { IM.opts.default_pay_type = e.target.value; IM.preview = null; $('#imPrev').innerHTML = ''; });
    $('#doPrev').addEventListener('click', doPreview);
  }

  function importBody() {
    const map = {}; Object.keys(IM.mapping).forEach((k) => { if (IM.mapping[k]) map[k] = IM.mapping[k]; });
    // ส่งเฉพาะคอลัมน์ที่จับคู่ (ลดขนาดคำขอ)
    const cols = Object.values(map);
    const rows = IM.rows.map((r) => { const o = {}; cols.forEach((c) => { o[c] = r[c]; }); return o; });
    return { kind: IM.kind, mapping: map, key_fields: IM.keys, options: IM.opts, rows: rows, row_nos: IM.rowNos,
             file: { name: IM.file.name, size: IM.file.size, checksum: IM.file.checksum, sheet: IM.sheet } };
  }

  async function doPreview() {
    const b = $('#doPrev'); b.disabled = true;
    $('#imPrev').innerHTML = '<div class="clay panel"><span class="spin"></span> กำลังตรวจ ' + num(IM.rows.length) + ' แถว…</div>';
    try {
      IM.preview = await api('import_preview', importBody());
      IM.cls = ['NEW', 'CHANGED', 'HELD', 'AMBIGUOUS', 'ERROR', 'SAME', 'OUTSIDE'].find((c) => IM.preview.counts[c]) || 'NEW';
      drawPreview();
    } catch (e) { $('#imPrev').innerHTML = '<div class="clay panel"><p class="note r" style="margin:0">' + esc(e.message) + '</p></div>'; }
    finally { b.disabled = false; }
  }

  function drawPreview() {
    const p = IM.preview, c = p.counts;
    const list = (p.samples[IM.cls] || []);
    $('#imPrev').innerHTML = '<div class="clay panel"><h3>4 · ผลการตรวจ (' + esc(p.kind_th) + ' ' + num(p.rows_total) + ' แถว)</h3>' +
      (p.duplicate_file ? '<p class="note" style="margin:0 0 12px">ไฟล์นี้เคยนำเข้าแล้วเมื่อ ' + esc(thDate(p.duplicate_file.at, true)) + ' — นำเข้าซ้ำได้ ยอดไม่เพิ่ม</p>' : '') +
      '<div class="chips">' + ['NEW', 'SAME', 'CHANGED', 'HELD', 'AMBIGUOUS', 'ERROR'].concat(p.counts.OUTSIDE ? ['OUTSIDE'] : []).map((k) =>
        '<button type="button" class="chip c-' + k + (IM.cls === k ? ' on' : '') + '" data-c="' + k + '"><span>' + CLS_TH[k] + '</span><b>' + num(c[k]) + '</b></button>').join('') + '</div>' +
      (p.totals ? '<p class="note g" style="margin:12px 0 0">หมายมีเงิน ' + num(p.totals.PAID.n) + ' รายการ รวม ' + num(p.totals.PAID.amount) + ' บาท · หมายฟรี (เงินงบประมาณ) ' + num(p.totals.BUDGET.n) + ' รายการ' +
        (p.period ? ' · ช่วงรายงาน ' + esc(thDate(p.period.from)) + ' – ' + esc(thDate(p.period.to)) : '') + '<br><span class="tiny">เทียบกับยอด "รวม … บาท" ท้ายบัญชีจ่ายหมาย (ไม่รวมแถวกำกวม/ผิดพลาด)</span></p>' : '') +
      (p.counts.OUTSIDE ? '<p class="note" style="margin:12px 0 0">' + num(p.counts.OUTSIDE) + ' แถว จ่ายหมายก่อนวันเริ่มประมวลผล ' + esc(thDate(p.start_date)) + ' (ปีงบ ' + esc(p.start_fy) + ') — ไม่นำเข้า ไม่เข้ารอตรวจ</p>' : '') +
      (p.price_ne_rate ? '<p class="note r" style="margin:12px 0 0"><b>' + num(p.price_ne_rate) + ' รายการ เงินไม่เท่ากับอัตราของตำบล</b> — นำเข้าได้ ระบบใช้ "ราคา" ตามไฟล์ และแสดงหมายเหตุสีแดงไว้ทุกจุด</p>' : '') +
      '<div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>แถว</th><th>เลขคดี</th><th>ชนิดหมาย</th><th>ผู้รับ</th><th style="min-width:130px">ผู้ส่ง</th><th style="min-width:110px">ประเภท / เงิน</th><th>พื้นที่</th><th>จ่าย / ส่ง</th><th>หมายเหตุ</th></tr></thead><tbody>' +
      (list.length ? list.map((r) => '<tr><td>' + r.row_no + '</td><td>' + esc(r.case_no) + (r.case_ref ? '<br><span class="tiny muted">' + esc(r.case_ref) + '</span>' : '') + '</td><td class="small">' + esc(r.notice_kind) + '</td><td class="small">' + esc(r.recipient) + '</td><td class="small">' + esc(r.officer) + '</td><td>' + esc(PAY_TH[r.pay_type] || '') +
        (r.pay_type === 'PAID' && r.amount !== '' ? '<br><span class="tiny">' + num(r.amount) + ' บาท' + (r.rate !== '' && Number(r.rate) !== Number(r.amount) ? ' (อัตราตำบล ' + num(r.rate) + ')' : '') + '</span>' : '') +
        '</td><td class="small">' + esc(r.place) + (r.addr_type && r.addr_type !== 'มีหมู่' ? '<br><span class="tiny muted">' + esc(r.addr_type) + '</span>' : '') + '</td><td class="small">' + esc(thDate(r.issued_date) || '—') + (r.delivered_date ? ' / ' + esc(thDate(r.delivered_date)) : '') +
        '</td><td class="small">' + (r.reason ? esc(r.reason) + (r.flags ? '<br>' : '') : '') + flagHtml(r.flags) + '</td></tr>').join('')
        : '<tr><td colspan="9" class="muted">ไม่มีรายการ</td></tr>') +
      '</tbody></table></div>' + (list.length >= 30 ? '<p class="tiny muted">แสดง 30 แถวแรกของกลุ่มนี้</p>' : '') +
      '<div class="row" style="margin-top:16px"><button type="button" class="btn btn-g" id="doCommit"' + (c.NEW + c.CHANGED + c.HELD + c.AMBIGUOUS + c.ERROR ? '' : ' disabled') + '>ยืนยันนำเข้า</button>' +
      '<span class="small muted">ใหม่ ' + num(c.NEW) + ' · ปรับปรุง ' + num(c.CHANGED) + ' · รออนุมัติแก้ ' + num(c.HELD) + ' · กำกวม/ผิดพลาดเก็บไว้ให้ตรวจ ' + num(c.AMBIGUOUS + c.ERROR) +
        (c.OUTSIDE ? ' · ก่อนปีงบที่เริ่ม (ไม่นำเข้า) ' + num(c.OUTSIDE) : '') + '</span></div></div>';
    $('#imPrev').querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => { IM.cls = b.dataset.c; drawPreview(); }));
    $('#doCommit').addEventListener('click', doCommit);
  }

  async function doCommit() {
    const b = $('#doCommit'); b.disabled = true; b.innerHTML = '<span class="spin"></span> กำลังบันทึก…';
    try {
      const r = await api('import_commit', importBody());
      IM.meta = await api('import_templates');
      $('#imPrev').innerHTML = '<div class="clay panel"><h3>นำเข้าเรียบร้อย</h3><p class="note g" style="margin:0 0 12px">เลขชุด ' + esc(r.batch_id) +
        ' · เพิ่มใหม่ ' + num(r.inserted) + ' · ปรับปรุง ' + num(r.updated) + ' · รออนุมัติแก้ ' + num(r.held_changes) + ' · แถวรอตรวจสอบ ' + num(r.review_rows) + '</p>' +
        '<div class="row"><button type="button" class="btn btn-g" id="again">นำเข้าไฟล์ถัดไป</button><button type="button" class="btn" id="toHome">ไปหน้าแรก</button></div></div>';
      $('#imMap').innerHTML = ''; $('#imFile').innerHTML = '';
      $('#again').addEventListener('click', () => go('import'));
      $('#toHome').addEventListener('click', () => go('home'));
    } catch (e) { b.disabled = false; b.textContent = 'ยืนยันนำเข้า'; toast(e.message); }
  }

  /* ---------------------------------------------------------------- ประวัติการนำเข้า */
  RENDER.history = async (m) => {
    const d = await api('import_history');
    m.innerHTML = top('ประวัติการนำเข้า') + '<div class="clay panel"><div class="tbl-wrap"><table><thead><tr><th>เวลา</th><th>ชนิด</th><th>ไฟล์</th><th class="n">แถว</th><th class="n">ใหม่</th><th class="n">เดิม</th><th class="n">เปลี่ยน</th><th class="n">รออนุมัติ</th><th class="n">กำกวม</th><th class="n">ผิดพลาด</th><th>ผู้นำเข้า</th><th></th></tr></thead><tbody>' +
      (d.batches.length ? d.batches.map((b) => '<tr><td>' + esc(thDate(b.imported_at, true)) + '</td><td>' + esc(b.kind_th) + '</td><td>' + esc(b.file_name) + '</td><td class="n">' + num(b.rows_total) + '</td><td class="n">' + num(b.n_new) +
        '</td><td class="n">' + num(b.n_same) + '</td><td class="n">' + num(b.n_changed) + '</td><td class="n">' + num(b.n_held) + '</td><td class="n">' + num(b.n_ambiguous) + '</td><td class="n">' + num(b.n_error) + '</td><td>' + esc(b.imported_by) + '</td><td>' +
        (has('NOTICE', 'ADMIN') && (b.n_ambiguous + b.n_error) ? '<button type="button" class="btn btn-sm rv" data-b="' + esc(b.batch_id) + '">ดูแถวรอตรวจ</button>' : '') + '</td></tr>').join('')
        : '<tr><td colspan="12" class="muted">ยังไม่มีการนำเข้า</td></tr>') + '</tbody></table></div></div><div id="rvBox"></div>';
    m.querySelectorAll('.rv').forEach((b) => b.addEventListener('click', async () => {
      const box = $('#rvBox'); box.innerHTML = '<div class="clay panel"><span class="spin"></span></div>';
      try {
        const r = await api('import_review', { batch_id: b.dataset.b });
        box.innerHTML = '<div class="clay panel"><h3>แถวรอตรวจสอบ · ' + esc(b.dataset.b) + '</h3><p class="small muted" style="margin:0 0 10px">แก้ที่ไฟล์ต้นทาง หรือแก้ชื่อผู้ส่ง/ชื่อเรียกอื่นในหน้า "ผู้ส่งหมายและอัตรา" แล้วนำเข้าไฟล์อีกครั้ง</p><div class="tbl-wrap"><table><thead><tr><th>แถว</th><th>กลุ่ม</th><th>เหตุผล</th><th>ข้อมูลในไฟล์</th></tr></thead><tbody>' +
          r.rows.map((x) => '<tr><td>' + x.row_no + '</td><td><span class="pill ' + (x.cls === 'ERROR' ? 'r' : 'a') + '">' + esc(CLS_TH[x.cls]) + '</span></td><td>' + esc(x.reason) + '</td><td class="tiny">' +
            esc(Object.keys(x.raw).map((k) => k + ': ' + x.raw[k]).join(' · ')) + '</td></tr>').join('') + '</tbody></table></div></div>';
        box.scrollIntoView({ behavior: 'smooth' });
      } catch (e) { box.innerHTML = '<div class="clay panel"><p class="note r" style="margin:0">' + esc(e.message) + '</p></div>'; }
    }));
  };

  /* ---------------------------------------------------------------- ผู้ส่งหมายและอัตรา */
  RENDER.officers = async (m) => {
    const [o, r] = await Promise.all([api('officers_list'), api('rates_list')]);
    const admin = has('ADMIN');
    const groups = {};
    r.areas.forEach((a) => { (groups[a.amphoe_name] = groups[a.amphoe_name] || []).push(a); });
    m.innerHTML = top('ผู้ส่งหมายและอัตรา') +
      '<div class="clay panel"><h3>ผู้ส่งหมาย ' + o.officers.length + ' คน</h3>' + (admin ? '<p class="small muted" style="margin:0 0 10px">"ชื่อเรียกอื่น" ใช้จับคู่ชื่อในไฟล์ Excel ที่สะกดต่างกัน คั่นด้วยจุลภาค</p>' : '') +
      '<div class="tbl-wrap"><table><thead><tr><th>รหัส</th><th>ชื่อ</th><th>นามสกุล</th><th>ชื่อเรียกอื่น</th><th>บัญชีปริ้นฮับ</th><th class="n">ตำบล</th><th>อำเภอ</th>' + (admin ? '<th></th>' : '') + '</tr></thead><tbody>' +
      o.officers.map((x) => '<tr data-id="' + esc(x.officer_id) + '"><td>' + esc(x.officer_id) + '</td><td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + esc(x.color) + ';margin-right:6px"></span>' + esc(x.first_name) + '</td>' +
        (admin ? '<td><input class="inp f-ln" style="width:130px" value="' + esc(x.last_name) + '" aria-label="นามสกุล ' + esc(x.first_name) + '"></td><td><input class="inp f-al" style="width:180px" value="' + esc(x.name_aliases) + '" aria-label="ชื่อเรียกอื่น"></td><td><input class="inp f-ph" style="width:90px" value="' + esc(x.printhub_code) + '" aria-label="รหัสปริ้นฮับ"></td>'
          : '<td>' + esc(x.last_name || '—') + '</td><td>' + esc(x.name_aliases) + '</td><td>' + esc(x.printhub_code || '—') + '</td>') +
        '<td class="n">' + x.tambon_count + '</td><td class="small">' + esc(x.amphoes) + '</td>' + (admin ? '<td><button type="button" class="btn btn-sm sv">บันทึก</button></td>' : '') + '</tr>').join('') +
      '</tbody></table></div></div>' +
      '<div class="clay panel"><h3>อัตราค่าหมายรายตำบล</h3><p class="small muted" style="margin:0 0 10px">' + esc((r.areas[0] || {}).source || '') + ' · เริ่มใช้ ' + esc(thDate((r.areas[0] || {}).effective_from)) +
      ' · หมายฟรี อ.เมืองลพบุรี ' + num((r.budget[0] || {}).rate) + ' บาท คงที่ อำเภออื่นใช้อัตราตามตำบล</p>' +
      Object.keys(groups).map((g) => '<details class="sunk" style="padding:10px 14px;margin-bottom:10px"><summary style="cursor:pointer;font-weight:700">' + esc(g) + ' · ' + groups[g].length + ' ตำบล · ' + num(Math.min(...groups[g].map((a) => a.rate))) + '–' + num(Math.max(...groups[g].map((a) => a.rate))) + ' บาท</summary>' +
        '<div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th>รหัส</th><th>ตำบล</th><th>ผู้ส่ง</th><th class="n">บาท/หมาย</th></tr></thead><tbody>' +
        groups[g].map((a) => '<tr><td>' + esc(a.area_id) + '</td><td>' + esc(a.tambon_name) + '</td><td>' + esc(a.officer) + '</td><td class="n">' + num(a.rate) + '</td></tr>').join('') + '</tbody></table></div></details>').join('') + '</div>';
    m.querySelectorAll('.sv').forEach((b) => b.addEventListener('click', async () => {
      const tr = b.closest('tr'); b.disabled = true;
      try {
        await api('officer_save', { officer_id: tr.dataset.id, last_name: $('.f-ln', tr).value, name_aliases: $('.f-al', tr).value, printhub_code: $('.f-ph', tr).value });
        toast('บันทึกแล้ว');
      } catch (e) { toast(e.message); } finally { b.disabled = false; }
    }));
  };

  /* ---------------------------------------------------------------- ผู้ใช้และสิทธิ์ */
  RENDER.users = async (m) => {
    const [d, o] = await Promise.all([api('users_list'), api('officers_list')]);
    m.innerHTML = top('ผู้ใช้และสิทธิ์', '<label class="sr" for="uf">ค้นชื่อ</label><input id="uf" class="inp" placeholder="ค้นชื่อ / ส่วนงาน">') +
      '<div class="clay panel"><p class="small muted" style="margin:0 0 10px">รายชื่อมาจากบัญชีปริ้นฮับ (สร้างบัญชี/ตั้ง PIN ที่ปริ้นฮับ) · ที่นี่กำหนดเฉพาะสิทธิ์ในระบบค่าหมาย · บทบาทผู้ส่งหมายต้องผูกชื่อผู้ส่ง</p>' +
      '<div class="tbl-wrap"><table><thead><tr><th>บัญชี</th><th>PIN</th>' + d.roles.map((r) => '<th>' + esc(r.th) + '</th>').join('') + '<th>ผูกผู้ส่ง</th><th></th></tr></thead><tbody>' +
      d.users.map((u) => '<tr data-c="' + esc(u.code) + '" data-s="' + esc((u.name + ' ' + u.dept + ' ' + u.code).toLowerCase()) + '"><td><b>' + esc(u.name) + '</b><br><span class="tiny muted">' + esc(u.code) + ' · ' + esc(u.dept || '—') + '</span>' +
        (u.boot_admin ? '<br><span class="pill g">ผู้ดูแลตั้งต้น</span>' : '') + '</td><td>' +
        (!u.ph_active ? '<span class="pill r">ปิดใช้งาน</span>' : !u.has_pin ? '<span class="pill a">ยังไม่ตั้ง</span>' : u.must_change ? '<span class="pill a">ต้องเปลี่ยน</span>' : '<span class="pill g">พร้อม</span>') + '</td>' +
        d.roles.map((r) => '<td><input type="checkbox" class="rc" value="' + r.code + '"' + (u.roles.indexOf(r.code) >= 0 ? ' checked' : '') + ' aria-label="' + esc(u.name + ' ' + r.th) + '"></td>').join('') +
        '<td><select class="sel of" aria-label="ผูกผู้ส่งของ ' + esc(u.name) + '"><option value="">—</option>' + o.officers.map((x) => '<option value="' + esc(x.officer_id) + '"' + (x.officer_id === u.officer_id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></td>' +
        '<td><button type="button" class="btn btn-sm us">บันทึก</button></td></tr>').join('') + '</tbody></table></div></div>';
    $('#uf').addEventListener('input', (e) => { const q = e.target.value.trim().toLowerCase(); m.querySelectorAll('tbody tr[data-s]').forEach((tr) => { tr.style.display = !q || tr.dataset.s.indexOf(q) >= 0 ? '' : 'none'; }); });
    m.querySelectorAll('.us').forEach((b) => b.addEventListener('click', async () => {
      const tr = b.closest('tr'); b.disabled = true;
      try {
        await api('user_save', { code: tr.dataset.c, roles: Array.from(tr.querySelectorAll('.rc:checked')).map((x) => x.value), officer_id: $('.of', tr).value });
        toast('บันทึกสิทธิ์แล้ว — มีผลภายใน 5 นาที หรือเมื่อเข้าระบบใหม่');
      } catch (e) { toast(e.message); } finally { b.disabled = false; }
    }));
  };

  document.addEventListener('DOMContentLoaded', initLogin);
})();
