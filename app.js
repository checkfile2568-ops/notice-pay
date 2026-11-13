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
  /* ---------- ลูกเล่น: ตัวเลขวิ่ง · สีสถานะ · กราฟเส้นเล็ก ---------- */
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** <b data-count> นับจาก 0 ถึงค่าจริงใน 0.6 วินาที (ค่าเงินมีทศนิยมได้ 2 ตำแหน่ง) */
  function countUp(root) {
    if (reduceMotion()) return;
    (root || document).querySelectorAll('[data-count]').forEach((el) => {
      const end = Number(el.dataset.count) || 0, money = el.dataset.money === '1', suffix = el.dataset.suffix || '';
      if (!end) return;
      const fmt = (v) => (money ? v.toLocaleString('th-TH', { maximumFractionDigits: v === end ? 2 : 0 }) : Math.round(v).toLocaleString('th-TH')) + suffix;
      const t0 = performance.now();
      const step = (t) => { const p = Math.min(1, (t - t0) / 600); el.textContent = fmt(p < 1 ? end * (1 - Math.pow(1 - p, 3)) : end); if (p < 1) requestAnimationFrame(step); };
      el.textContent = fmt(0); requestAnimationFrame(step);
    });
  }
  /** สีสถานะเดียวกันทุกหน้าจอ: เทา รอผล · ส้ม พร้อมเบิก/รอวันจ่าย · ฟ้า เบิกแล้วรอจ่าย · เขียว จ่ายแล้ว · แดง รอตรวจ */
  const ST = [
    { k: 'wait', th: 'รอผล / ยังไม่ส่ง', c: '#B4B2A9' }, { k: 'ready', th: 'พร้อมเบิก / รอวันจ่าย', c: '#EF9F27' },
    { k: 'claim', th: 'เบิกแล้ว รอจ่าย', c: '#378ADD' }, { k: 'paid', th: 'จ่ายแล้ว', c: '#639922' }, { k: 'check', th: 'รอตรวจ', c: '#E24B4A' }];
  const ST_BY = Object.fromEntries(ST.map((x) => [x.k, x]));
  function stBar(m) {
    const tot = ST.reduce((a, x) => a + (Number(m[x.k]) || 0), 0);
    if (!tot) return '<div class="stbar" title="ยังไม่มียอดเงิน"></div>';
    const tip = ST.filter((x) => m[x.k]).map((x) => x.th + ' ' + Number(m[x.k]).toLocaleString('th-TH') + ' ฿').join('\n');
    return '<div class="stbar" title="' + esc(tip) + '" role="img" aria-label="' + esc(tip.replace(/\n/g, ' · ')) + '">' +
      ST.filter((x) => m[x.k]).map((x) => '<i style="width:' + (m[x.k] / tot * 100).toFixed(2) + '%;background:' + x.c + '"></i>').join('') + '</div>';
  }
  function spark(w) {
    const a = (w || []).map(Number), mx = Math.max(1, ...a);
    const pts = a.map((v, i) => (2 + i * 13) + ',' + (19 - v / mx * 16).toFixed(1)).join(' ');
    return '<svg class="spark" viewBox="0 0 70 22" width="70" height="22" role="img" aria-label="ส่งหมายรายสัปดาห์ (6 สัปดาห์): ' + a.join(', ') + '">' +
      '<polyline fill="none" stroke="#2E6B4F" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" points="' + pts + '"/>' +
      (a.length ? '<circle cx="' + (2 + (a.length - 1) * 13) + '" cy="' + (19 - a[a.length - 1] / mx * 16).toFixed(1) + '" r="2.4" fill="#2E6B4F"/>' : '') + '</svg>';
  }
  /** การ์ดค่อย ๆ ปรากฏเมื่อเลื่อนมาถึง (ครั้งเดียว · ใช้ GPU · ปิดเองถ้าเครื่องตั้งค่าลดภาพเคลื่อนไหว) */
  let revealObs = null;
  /**
   * จัดการตัดบรรทัดภาษาไทย: ไม่ให้ตัวเลขแยกจากหน่วย/คำนำหน้า ("116,700 ฿", "หมาย 2 ฉบับ", "ผู้รับตัวอย่าง 0001", "1 พ.ย. 2569")
   * ใช้ช่องว่างไม่ตัดบรรทัด (U+00A0) เฉพาะรอบตัวเลข — คำไทยทั่วไปยังตัดตามพจนานุกรมของเบราว์เซอร์
   */
  const NBSP_RULES = [
    [/(\d[\d,.]*)[ \t]+(?=[฿%]|บาท|ฉบับ|หน่วย|แถว|รายการ|คน|ครั้ง|วัน|สัปดาห์|เดือน|ปี|ม\.|น\.|หมาย)/g, '$1 '],
    [/([ก-๙.)])[ \t]+(?=\d)/g, '$1 '],
    [/(\d{1,2})[ \t]+(?=(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.))/g, '$1 '],
    [/(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)[ \t]+(?=\d)/g, '$1 '],
    [/(ต\.|อ\.|จ\.)[ \t]+(?=[ก-๙])/g, '$1 ']
  ];
  function glueThai(root) {
    if (!root) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => {
      const p = n.parentNode && n.parentNode.nodeName;
      return /^(SCRIPT|STYLE|TEXTAREA|INPUT|OPTION|KBD|CODE)$/.test(p) || !/\d|ต\.|อ\./.test(n.nodeValue) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    } });
    const list = []; while (w.nextNode()) list.push(w.currentNode);
    list.forEach((n) => { let v = n.nodeValue; NBSP_RULES.forEach(([re, to]) => { v = v.replace(re, to); }); if (v !== n.nodeValue) n.nodeValue = v; });
  }
  function reveal(root) {
    if (reduceMotion() || !('IntersectionObserver' in window)) return;
    if (!revealObs) revealObs = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in'); revealObs.unobserve(e.target);
      if (e.target.dataset.onview === 'bars') drawBars(e.target);
    }), { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
    let i = 0;
    root.querySelectorAll('.kpi, .clay.panel, .note').forEach((el) => {
      if (el.classList.contains('rv')) return;
      el.classList.add('rv'); el.style.transitionDelay = (el.classList.contains('kpi') ? Math.min(i++, 6) * 45 : 0) + 'ms';
      revealObs.observe(el);
    });
  }

  /* ---------- กราฟยอดเงินตามสถานะ: แถบสถานะเต็มกว้าง (ค่าเริ่มต้น) · กราฟแยกสถานะ (ไทล์) — กดสีเพื่อกรองตาราง ---------- */
  const pctOf = (v, tot) => { if (!v || !tot) return '0%'; const p = v / tot * 100; return p < 1 ? '<1%' : (Math.round(p * 10) / 10).toLocaleString('th-TH') + '%'; };
  function moneyBarHtml(money) {
    const tot = ST.reduce((a, x) => a + (Number(money[x.k]) || 0), 0);
    if (!tot) return '<p class="small muted" style="margin:0">ยังไม่มียอดเงิน (นำเข้าไฟล์จ่ายหมายแล้วจะแสดงที่นี่)</p>';
    const segs = ST.filter((x) => money[x.k] > 0);
    return '<div class="mbar" role="group" aria-label="แถบยอดเงินตามสถานะ">' + segs.map((x) =>
      '<button type="button" class="mseg" data-k="' + x.k + '" data-w="' + Math.max(1.2, money[x.k] / tot * 100).toFixed(2) + '" style="--c:' + x.c + '" aria-label="' + esc(x.th + ' ' + baht(money[x.k]) + ' บาท') + '" title="' + esc(x.th + ' ' + baht(money[x.k]) + ' ฿') + '"></button>').join('') + '</div>' +
      '<div class="mleg">' + ST.map((x) => '<button type="button" class="dn-lg' + (money[x.k] ? '' : ' zero') + '" data-k="' + x.k + '"><i style="background:' + x.c + '"></i><span>' + esc(x.th) + '</span><em>' + pctOf(money[x.k], tot) + '</em><b>' + baht(money[x.k]) + ' ฿</b></button>').join('') + '</div>';
  }
  function moneyTilesHtml(money) {
    const tot = ST.reduce((a, x) => a + (Number(money[x.k]) || 0), 0);
    const order = ['ready', 'wait', 'check', 'claim', 'paid'];
    return '<div class="stt">' + order.map((k) => { const x = ST_BY[k], v = Number(money[k]) || 0;
      return '<button type="button" class="stt-t dn-lg' + (k === 'ready' ? ' big' : '') + (v ? '' : ' zero') + '" data-k="' + k + '" style="--c:' + x.c + '">' +
        '<span class="stt-h"><i style="background:' + x.c + '"></i>' + esc(x.th) + '</span><b>' + baht(v) + '&nbsp;฿</b>' +
        '<span class="stt-bar"><i data-w="' + (tot ? Math.max(v ? 1.5 : 0, v / tot * 100) : 0).toFixed(2) + '"></i></span><span class="tiny muted">' + pctOf(v, tot) + ' ของยอดรวม</span></button>'; }).join('') + '</div>';
  }
  /** แถบค่อย ๆ ยืดเมื่อเลื่อนมาถึง */
  function drawBars(box) {
    box.querySelectorAll('[data-w]').forEach((el, i) => {
      const w = el.dataset.w + '%';
      if (reduceMotion()) { el.style.width = w; return; }
      el.style.transitionDelay = (i * 60) + 'ms';
      requestAnimationFrame(() => requestAnimationFrame(() => { el.style.width = w; }));
    });
  }

  const stChip = (k) => { const x = ST_BY[k] || ST_BY.wait; return '<span class="stchip" style="--c:' + x.c + '">' + esc(x.th) + '</span>'; };

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
  /** สัญลักษณ์ "เคยยอดไม่ตรง" — ยอดที่ยืนยันแล้วไม่แสดงสีแดง แต่คงเครื่องหมายไว้ถาวร */
  const okMark = (ok) => '<span class="tiny flag-ok" title="ยืนยันโดย ' + esc(ok.by) + ' ' + esc(thDate(ok.at, true)) + '">◆ เคยยอดไม่ตรง · ยืนยันแล้ว</span>';
  /** ราคาไม่เท่าอัตราตำบล → คิดตามอัตราตำบล: ▲ เกิน (ส่วนเกินไม่นำมาคิด) · ▼ ต่ำกว่า (อักษรสีแดง) */
  const adjMark = (a, long) => !a ? '' : (a.dir === 'UP'
    ? '<span class="tiny flag-up" title="ราคาไฟล์ ' + num(a.src) + ' · คิดตามอัตราตำบล ' + num(a.rate) + '">▲ เกินอัตราตำบล ' + num(a.diff) + '&nbsp;฿' + (long ? ' (ไฟล์ ' + num(a.src) + ' · คิด ' + num(a.rate) + ') ส่วนเกินไม่นำมาคิด' : '') + '</span>'
    : '<span class="tiny flag-r" title="ราคาไฟล์ ' + num(a.src) + ' · คิดตามอัตราตำบล ' + num(a.rate) + '">▼ ต่ำกว่าอัตราตำบล ' + num(a.diff) + '&nbsp;฿' + (long ? ' (ไฟล์ ' + num(a.src) + ' · คิด ' + num(a.rate) + ')' : '') + '</span>');
  const flagsOf = (r) => {
    const rest = String(r.flags || '').split(';').filter((x) => x && !(r.adj && x === FLAGS_RED[0])).join(';');
    return [adjMark(r.adj, true), flagHtml(rest)].filter(Boolean).join('<br>');
  };

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
  /** บัญชีดูสถิติรวม (ไอดีเดียวของเจ้าหน้าที่ส่งหมาย) — ดูยอดทุกคน ไม่เห็นชื่อผู้รับ/รายละเอียดคดี */
  const viewerOnly = () => S.user && S.user.roles.length > 0 && S.user.roles.every((x) => x === 'VIEWER');
  function pages() {
    return [
      { id: 'home', th: 'หน้าแรก', show: true },
      { id: 'search', th: 'ค้นหาหมาย', show: !viewerOnly() },
      { id: 'import', th: 'นำเข้าข้อมูล', show: has('NOTICE', 'FINANCE', 'ADMIN') },
      { id: 'history', th: 'ประวัติการนำเข้า', show: has('NOTICE', 'FINANCE', 'ADMIN') },
      { id: 'calc', th: 'คำนวณค่าหมาย', show: true },
      { id: 'officers', th: 'ผู้ส่งหมายและอัตรา', show: true },
      { id: 'users', th: 'ผู้ใช้และสิทธิ์', show: has('ADMIN') },
      { id: 'payout', th: 'รอบเบิก / วันจ่าย 60:40', show: true },
      { id: '_s', sec: 'กำลังพัฒนา' },
      { id: 'soon-status', th: 'สถานะการเบิกจ่าย', soon: 'ระยะ 5', show: true },
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
    $('#nav').innerHTML = (viewerOnly() ? '' : '<button type="button" class="qs-btn" id="qsOpen">ค้นเลขคดีดูสถานะ <kbd>Ctrl K</kbd></button>') + pages().filter((p) => p.sec || p.show).map((p) => p.sec
      ? '<div class="nav-sec">' + esc(p.sec) + '</div>'
      : '<button type="button" data-p="' + p.id + '"' + (p.soon ? ' disabled' : '') + (S.page === p.id ? ' class="on" aria-current="page"' : '') + '>' +
        esc(p.th) + (p.soon ? '<span class="soon">' + esc(p.soon) + '</span>' : '') + '</button>').join('');
    $('#nav').querySelectorAll('button[data-p]:not([disabled])').forEach((b) => b.addEventListener('click', () => { S.payoutSub = 'list'; go(b.dataset.p); }));
    if ($('#qsOpen')) $('#qsOpen').addEventListener('click', openQuickSearch);
  }
  const RENDER = {};
  function go(p) {
    S.page = p; drawNav();
    const m = $('#main');
    m.innerHTML = '<div class="clay panel"><span class="spin"></span> <span class="muted">กำลังโหลด…</span></div>';
    Promise.resolve(RENDER[p](m)).then(() => { glueThai(m); reveal(m); }).catch((e) => { m.innerHTML = '<div class="clay panel"><p class="note r" style="margin:0">' + esc(e.message) + '</p></div>'; });
    m.focus({ preventScroll: true }); window.scrollTo(0, 0);
  }
  function top(title, extra) { return '<div class="top clay"><h2>' + esc(title) + '</h2>' + (extra || '') + '</div>'; }

  /* ---------- ใบสรุปพิมพ์ได้ (รูปแบบเอกสารราชการ · ตราศาล · TH Sarabun) ---------- */
  async function printSummary(d) {
    if (!document.getElementById('fSarabun')) {
      const l = document.createElement('link'); l.id = 'fSarabun'; l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap'; document.head.appendChild(l);
    }
    const t = d.totals, now = new Date();
    const dLong = now.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
    const tm = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    const b = (v) => baht(v);
    const rows = d.officers.map((o, i) => '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(o.name) + '</td><td class="n">' + num(o.paid_n) + '</td><td class="n">' + b(o.paid_amount) +
      '</td><td class="n">' + num(o.free_n) + '</td><td class="n">' + num(o.free_units) + '</td><td class="n">' + b(o.free_amount) + '</td><td class="n">' + num(o.free_wait) +
      '</td><td class="n"><b>' + b(o.paid_amount + o.free_amount) + '</b></td></tr>').join('');
    let pa = document.getElementById('printArea');
    if (!pa) { pa = document.createElement('div'); pa.id = 'printArea'; document.body.appendChild(pa); }
    pa.innerHTML = '<div class="pr-head"><img src="court-seal.webp" alt=""><div class="pr-court">ศาลจังหวัดลพบุรี</div>' +
      '<div class="pr-title">บัญชีสรุปยอดค่าหมาย ปีงบประมาณ พ.ศ. ' + esc(d.fy) + '</div>' +
      '<div class="pr-sub">ข้อมูล ณ วันที่ ' + esc(dLong) + ' เวลา ' + esc(tm) + ' น. · คำนวณล่าสุด ' + esc(thDate(d.last_run, true) || '—') + '</div></div>' +
      '<table class="pr-tbl"><thead><tr><th rowspan="2">ที่</th><th rowspan="2">ชื่อ – สกุล</th><th colspan="2">หมายมีเงิน</th><th colspan="4">หมายฟรี (เงินงบประมาณ)</th><th rowspan="2">รวม (บาท)</th></tr>' +
      '<tr><th>ฉบับ</th><th>บาท</th><th>ฉบับ</th><th>หน่วยเบิก</th><th>บาท</th><th>รอวันที่ส่ง</th></tr></thead><tbody>' + rows +
      '<tr class="pr-sum"><td></td><td><b>รวมทั้งสิ้น</b></td><td class="n"><b>' + num(t.paid_n) + '</b></td><td class="n"><b>' + b(t.paid_amount) + '</b></td><td class="n"><b>' + num(t.free_n) +
      '</b></td><td class="n"><b>' + num(t.free_units) + '</b></td><td class="n"><b>' + b(t.free_amount) + '</b></td><td class="n"><b>' + num(t.free_wait) + '</b></td><td class="n"><b>' + b(t.paid_amount + t.free_amount) + '</b></td></tr></tbody></table>' +
      '<div class="pr-note"><b>หมายเหตุ</b> ๑. หมายมีเงินคิดตามราคาที่วางในบัญชีจ่ายหมาย กรณีราคาไม่เท่าอัตราตำบลคิดตามอัตราตำบล' + ((t.adj_up || t.adj_dn) ? ' (' + [t.adj_up ? '▲ เกินอัตรา ' + num(t.adj_up) + ' ฉบับ ส่วนเกิน ' + num(t.adj_up_baht) + ' บาท ไม่นำมาคิด' : '', t.adj_dn ? '▼ ต่ำกว่าอัตรา ' + num(t.adj_dn) + ' ฉบับ ปรับขึ้น ' + num(t.adj_dn_baht) + ' บาท' : ''].filter(Boolean).join(' · ') + ')' : '') + ' ๒. หมายฟรีคิดตามระเบียบ ก.บ.ศ. ว่าด้วยค่าตอบแทนฯ พ.ศ. ๒๕๖๒ ข้อ ๗ อำเภอเมืองลพบุรี ๓๐๐ บาท อำเภออื่นตามอัตราตำบล ' +
      '๓. ไม่รวมหมายที่ยังไม่มีวันที่ส่ง หมายที่รอยืนยัน และหมายก่อนเริ่มปีงบประมาณ ๔. ยอดนี้ยังไม่แบ่งส่วน ๖๐ : ๔๐ และแยกจากเอกสารเบิกจ่ายทางราชการ</div>' +
      '<div class="pr-sign"><div>ลงชื่อ ......................................................... ผู้จัดทำ<br>(' + esc(S.user ? S.user.name : '') + ')<br>ตำแหน่ง .........................................................</div>' +
      '<div>ลงชื่อ ......................................................... ผู้ตรวจสอบ<br>(.........................................................)<br>ตำแหน่ง .........................................................</div></div>';
    try { await Promise.race([document.fonts.load('16pt Sarabun'), new Promise((r) => setTimeout(r, 1500))]); } catch (e) { /* พิมพ์ด้วยฟอนต์สำรอง */ }
    const img = pa.querySelector('img');
    if (img && !img.complete) await new Promise((r) => { img.onload = img.onerror = r; setTimeout(r, 1500); });
    window.print();
  }

  /* ---------- ค้นเลขคดีด่วน (Ctrl+K หรือ /) ---------- */
  let qsT = 0;
  function openQuickSearch() {
    if (!S.user || viewerOnly()) return;
    let ov = document.getElementById('qs');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'qs'; ov.className = 'qs-ov';
      ov.innerHTML = '<div class="qs clay" role="dialog" aria-modal="true" aria-label="ค้นเลขคดีดูสถานะ">' +
        '<div class="qs-in"><label class="sr" for="qsq">พิมพ์เลขคดี</label><input id="qsq" class="inp" autocomplete="off" placeholder="พิมพ์เลขคดี เช่น ต1250/2569">' +
        '<button type="button" class="btn btn-s" id="qsx" aria-label="ปิด">Esc</button></div><div id="qsr" class="qs-r"><p class="tiny muted" style="margin:6px 4px">พิมพ์อย่างน้อย 2 ตัวอักษร</p></div></div>';
      document.body.appendChild(ov);
      ov.addEventListener('click', (e) => { if (e.target === ov) closeQuickSearch(); });
      $('#qsx').addEventListener('click', closeQuickSearch);
      $('#qsq').addEventListener('input', (e) => { clearTimeout(qsT); const q = e.target.value.trim(); qsT = setTimeout(() => quickSearch(q), 300); });
    }
    ov.classList.remove('hidden'); $('#qsq').value = ''; $('#qsr').innerHTML = '<p class="tiny muted" style="margin:6px 4px">พิมพ์อย่างน้อย 2 ตัวอักษร</p>';
    setTimeout(() => $('#qsq').focus(), 30);
  }
  function closeQuickSearch() { const ov = document.getElementById('qs'); if (ov) ov.classList.add('hidden'); }
  async function quickSearch(q) {
    const box = $('#qsr'); if (!box) return;
    if (q.length < 2) { box.innerHTML = '<p class="tiny muted" style="margin:6px 4px">พิมพ์อย่างน้อย 2 ตัวอักษร</p>'; return; }
    box.innerHTML = '<p class="tiny muted" style="margin:6px 4px"><span class="spin"></span> กำลังค้นหา…</p>';
    try {
      const d = await api('notice_search', { q: q });
      if ($('#qsq').value.trim() !== q) return;
      if (!d.rows.length) { box.innerHTML = '<p class="small muted" style="margin:6px 4px">ไม่พบหมาย</p>'; return; }
      box.innerHTML = d.rows.slice(0, 20).map((r) => '<div class="qs-item">' +
        '<div class="qs-top"><b>' + esc(r.case_no) + '</b>' + stChip(r.money_status) +
        adjMark(r.adj) + '</div>' +
        '<div class="small">' + esc(r.notice_kind) + ' · ' + esc(PAY_TH[r.pay_type] || '') + ' · ' + esc(r.officer) + '</div>' +
        '<div class="tiny muted">จ่าย ' + esc(thDate(r.issued_date) || '—') + ' · ส่ง ' + esc(thDate(r.delivered_date) || 'ยังไม่ส่ง') +
        (r.calc_amount !== '' && r.calc_amount !== undefined ? ' · ' + baht(r.calc_amount) + ' ฿' : '') + (r.calc_rule ? ' · ' + esc(r.calc_rule) : '') + '</div></div>').join('') +
        (d.rows.length > 20 ? '<p class="tiny muted" style="margin:6px 4px">แสดง 20 จาก ' + num(d.rows.length) + ' รายการ — ใช้หน้า "ค้นหาหมาย" เพื่อดูทั้งหมด</p>' : '');
    } catch (e) { box.innerHTML = '<p class="small flag-r" style="margin:6px 4px">' + esc(e.message) + '</p>'; }
  }
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openQuickSearch(); }
    else if (e.key === '/' && !typing) { e.preventDefault(); openQuickSearch(); }
    else if (e.key === 'Escape') closeQuickSearch();
  });
  /* ---------------------------------------------------------------- หน้าแรก */
  RENDER.home = async (m) => {
    const d = await api('dashboard', { fy: S.fy });
    S.fy = d.fy;
    const t = d.totals;
    const fySel = '<label class="small muted" for="fy">ปีงบประมาณ</label> <select id="fy" class="sel">' +
      d.fys.map((y) => '<option' + (y === d.fy ? ' selected' : '') + '>' + esc(y) + '</option>').join('') + '</select>';
    const kpi = (lbl, v, cls) => '<div class="kpi clay ' + (cls || '') + '"><span>' + esc(lbl) + '</span><b data-count="' + Number(v || 0) + '">' + num(v) + '</b></div>';
    const notes = [];
    if (d.pending_review) notes.push('<div class="note">มีแถวรอตรวจสอบจากการนำเข้า ' + num(d.pending_review) + ' แถว (ดูในประวัติการนำเข้า)</div>');
    if (d.pending_changes) notes.push('<div class="note">มีรายการแก้ไขหมายที่ล็อกแล้ว รออนุมัติ ' + num(d.pending_changes) + ' รายการ</div>');
    if (t.no_area) notes.push('<div class="note">หมาย ' + num(t.no_area) + ' ฉบับ ไม่พบตำบลในตารางอัตรา — ตรวจชื่อตำบล/อำเภอในไฟล์ต้นทาง</div>');
    if (t.adj_up || t.adj_dn) notes.push('<div class="note">หมายมีเงิน ' + num((t.adj_up || 0) + (t.adj_dn || 0)) + ' ฉบับ ราคาไม่เท่าอัตราตำบล — คิดตามอัตราตำบลแล้ว' + (t.adj_up ? ' · <span class="flag-up">▲ เกิน ' + num(t.adj_up) + '</span>' : '') + (t.adj_dn ? ' · <span class="flag-r">▼ ต่ำกว่า ' + num(t.adj_dn) + '</span>' : '') + ' (ดูที่หน้า "คำนวณค่าหมาย")</div>');
    if (t.date_wait) notes.push('<div class="note r">หมาย ' + num(t.date_wait) + ' ฉบับ อาจจ่ายเดือน ก.ย. รอยืนยันวันที่จ่าย — ดูที่หน้า "คำนวณค่าหมาย"</div>');
    if (t.no_addr) notes.push('<div class="note">หมายฟรี ' + num(t.no_addr) + ' ฉบับ ไม่มีที่อยู่ นับเต็มอัตราแยกฉบับ — ควรตรวจกับต้นฉบับ</div>');
    const tot = t.total || 0, money = t.money || {};
    const mTot = ST.reduce((a2, x) => a2 + (Number(money[x.k]) || 0), 0);
    const IC = { all: '<path d="M4 6h16M4 12h16M4 18h10"/>', paid: '<rect x="3" y="6" width="18" height="12" rx="3"/><circle cx="12" cy="12" r="2.5"/>',
      free: '<path d="M4 20V10l8-6 8 6v10"/><path d="M9 20v-6h6v6"/>', wait: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', done: '<path d="M4 12l5 5L20 6"/>' };
    const tile = (area, cls, ic, lbl, v, sub) => '<div class="kpi clay kt ' + cls + '" style="grid-area:' + area + '"><span class="kt-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + IC[ic] + '</svg></span>' +
      '<span>' + esc(lbl) + '</span><b data-count="' + Number(v || 0) + '">' + num(v) + '</b><small>' + sub + '</small></div>';
    const share = (v) => tot ? 'ฉบับ · ' + pctOf(v, tot) + ' ของทั้งหมด' : 'ฉบับ';
    let view = 'bar'; try { view = localStorage.getItem('np_money_view') === 'tiles' ? 'tiles' : 'bar'; } catch (e) { /* ใช้ค่าเริ่มต้น */ }
    const canImport = has('NOTICE', 'FINANCE', 'ADMIN');
    const shortcut = '<div class="clay panel kt-nt" style="grid-area:nt"><h3>' + (canImport ? 'ทางลัด' : 'ข้อมูลล่าสุด') + '</h3>' +
      (canImport ? '<div class="row" style="gap:8px;margin-bottom:10px"><button type="button" class="btn btn-g btn-sm" data-go="import">นำเข้าไฟล์</button><button type="button" class="btn btn-sm" data-go="calc">คำนวณ · พิมพ์ใบสรุป</button></div>' : '') +
      '<p class="tiny muted" style="margin:0">ไฟล์จ่ายหมาย ' + esc(thDate(d.last_issue_import, true) || '—') + '<br>ไฟล์ผลหมาย ' + esc(thDate(d.last_result_import, true) || '—') + '</p></div>';
    m.innerHTML = top('หน้าแรก', fySel) +
      '<div class="bento"><div class="bn">' +
      '<section class="clay panel hero rv-b" style="grid-area:hero" data-onview="bars" aria-labelledby="heroH">' +
        '<div class="hero-h"><h3 id="heroH">ยอดเงินตามสถานะ</h3><button type="button" class="btn btn-sm" id="mvBtn" aria-pressed="' + (view === 'tiles') + '">' + (view === 'tiles' ? 'แถบสถานะ' : 'กราฟแยกสถานะ') + '</button></div>' +
        '<div class="hero-t"><b data-count="' + mTot + '" data-money="1" data-suffix="&nbsp;฿">' + baht(mTot) + '&nbsp;฿</b><span>รวมทั้งหมด ก่อนแบ่ง 60:40</span></div>' +
        '<div id="mvBox">' + (view === 'tiles' ? moneyTilesHtml(money) : moneyBarHtml(money)) + '</div>' +
        '<p class="tiny muted" style="margin:10px 2px 0">กดที่สีเพื่อกรองตารางผู้ส่งหมาย · สีเขียว = เข้ารอบเบิก/วันจ่ายแล้ว · สีฟ้า (เบิกแล้ว รอจ่าย) เริ่มใช้ในระยะ 5</p></section>' +
      tile('k1', 'k-all', 'all', 'หมายทั้งหมด', t.total, 'ฉบับ · ปีงบ ' + esc(d.fy)) +
      tile('k2', 'k-paid', 'paid', 'หมายมีเงิน', t.paid, share(t.paid)) +
      tile('k3', 'k-free', 'free', 'หมายฟรี', t.free, share(t.free)) +
      tile('k4', 'k-wait', 'wait', 'จ่ายหมายแล้ว รอผล', t.issued, share(t.issued)) +
      tile('k5', 'k-done', 'done', 'ส่งแล้ว', t.delivered, share(t.delivered)) +
      shortcut +
      '<div style="grid-area:al;display:flex;flex-direction:column;gap:10px">' + (notes.length ? notes.join('') : '<div class="note g">ไม่มีรายการค้างตรวจ</div>') + '</div>' +
      '<div class="clay panel" style="grid-area:off;min-width:0"><div class="row" style="justify-content:space-between;align-items:center;margin:0 0 6px"><h3 style="margin:0">' + (d.scope_officer ? 'หมายของฉัน' : 'แยกรายผู้ส่งหมาย') + '</h3><span id="dnFilter"></span></div><div class="tbl-wrap"><table id="offTbl"><thead><tr><th>ผู้ส่งหมาย</th>' +
      '<th class="n">มีเงิน รอผล</th><th class="n">มีเงิน ส่งแล้ว</th><th class="n">ฟรี รอผล</th><th class="n">ฟรี ส่งแล้ว</th><th class="n">รวม</th><th style="min-width:150px">ยอดเงินตามสถานะ</th><th>6 สัปดาห์</th></tr></thead><tbody>' +
      offRows(d.officers, null) + '</tbody></table></div>' +
      '<div class="stlegend">' + ST.map((x) => '<span><i style="background:' + x.c + '"></i>' + esc(x.th) + '</span>').join('') +
      '<span class="muted">· กราฟเส้น = จำนวนหมายที่ส่งแล้วรายสัปดาห์</span></div></div>' +
      '</div></div>';
    $('#fy').addEventListener('change', (e) => { S.fy = e.target.value; go('home'); });
    m.querySelectorAll('[data-go]').forEach((b2) => b2.addEventListener('click', () => go(b2.dataset.go)));
    countUp(m);
    // กรองตารางตามสีที่เลือก
    let sel = null;
    const mark = () => {
      m.querySelectorAll('#mvBox [data-k]').forEach((c) => { c.classList.toggle('on', c.dataset.k === sel); c.classList.toggle('dim', !!sel && c.dataset.k !== sel); c.setAttribute('aria-pressed', String(c.dataset.k === sel)); });
    };
    const apply = (k) => {
      sel = sel === k ? null : k;
      mark();
      const x = sel && ST_BY[sel];
      $('#offTbl tbody').innerHTML = offRows(d.officers, sel);
      $('#dnFilter').innerHTML = x ? '<button type="button" class="stchip" style="--c:' + x.c + ';cursor:pointer" id="dnClr">กรอง: ' + esc(x.th) + ' ✕</button>' : '';
      if ($('#dnClr')) $('#dnClr').addEventListener('click', () => apply(sel));
    };
    const bind = () => m.querySelectorAll('#mvBox [data-k]').forEach((b2) => b2.addEventListener('click', () => apply(b2.dataset.k)));
    bind();
    $('#mvBtn').addEventListener('click', () => {
      view = view === 'tiles' ? 'bar' : 'tiles';
      try { localStorage.setItem('np_money_view', view); } catch (e) { /* ไม่เป็นไร */ }
      $('#mvBox').innerHTML = view === 'tiles' ? moneyTilesHtml(money) : moneyBarHtml(money);
      $('#mvBtn').textContent = view === 'tiles' ? 'แถบสถานะ' : 'กราฟแยกสถานะ';
      $('#mvBtn').setAttribute('aria-pressed', String(view === 'tiles'));
      bind(); mark(); drawBars($('#mvBox'));
    });
    if (reduceMotion() || !('IntersectionObserver' in window)) drawBars(m.querySelector('.hero'));
  };
  /** แถวตารางผู้ส่งหมาย (กรองตามสถานะยอดเงินได้) */
  function offRows(list, sel) {
    let L = list.slice();
    if (sel) L = L.filter((o) => (o.money || {})[sel] > 0).sort((a, b) => b.money[sel] - a.money[sel]);
    if (!L.length) return '<tr><td colspan="8" class="muted small">ยังไม่มีผู้ส่งที่มียอดในสถานะนี้</td></tr>';
    const lbl = sel ? ST_BY[sel].th : 'พร้อมเบิก', key = sel || 'ready';
    return L.map((o) => '<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + esc(o.color) + ';margin-right:8px"></span>' + esc(o.name) + '</td>' +
      '<td class="n">' + num(o.paid_issued) + '</td><td class="n">' + num(o.paid_delivered) + '</td><td class="n">' + num(o.free_issued) + '</td><td class="n">' + num(o.free_delivered) +
      '</td><td class="n"><b>' + num(o.paid_issued + o.paid_delivered + o.free_issued + o.free_delivered) + '</b></td>' +
      '<td>' + stBar(o.money || {}) + '<span class="tiny muted">' + esc(lbl) + ' ' + baht((o.money || {})[key]) + ' ฿</span></td><td>' + spark(o.weeks) + '</td></tr>').join('');
  }

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
        out.innerHTML = '<div class="clay panel"><h3>พบ ' + num(d.rows.length) + ' รายการ</h3>' + (d.rows.length ? '<div class="tbl-wrap"><table><thead><tr><th>เลขคดี</th><th>ชนิดหมาย</th><th>ประเภท</th><th>ผู้รับ / พื้นที่</th><th>ผู้ส่ง</th><th>จ่ายหมาย</th><th>ส่ง</th><th class="n">ค่าหมาย</th><th>สถานะ</th></tr></thead><tbody>' +
          d.rows.map((r) => '<tr><td><b>' + esc(r.case_no) + '</b>' + (r.case_ref ? '<br><span class="tiny muted">' + esc(r.case_ref) + '</span>' : '') + '</td><td>' + esc(r.notice_kind || r.notice_no) + '</td><td><span class="pill ' + (r.pay_type === 'BUDGET' ? 'b' : 'g') + '">' + esc(PAY_TH[r.pay_type] || r.pay_type) + '</span>' +
            (r.pay_type === 'PAID' && r.amount !== '' ? '<br><span class="tiny">' + num(r.amount) + ' บาท</span>' : '') + '</td>' +
            '<td>' + esc(r.recipient) + '<br><span class="tiny muted">' + esc(r.place) + '</span></td><td>' + esc(r.officer) + '</td><td>' + esc(thDate(r.issued_date)) + '</td><td>' + esc(thDate(r.delivered_date)) +
            (r.result ? '<br><span class="tiny muted">' + esc(r.result) + '</span>' : '') + '</td>' +
            '<td class="n">' + (r.calc_amount !== '' && r.calc_amount !== undefined ? '<b>' + num(r.calc_amount) + '</b>' : '—') + (r.budget_unit_id ? '<br><span class="tiny muted">รวมใน ' + esc(r.budget_unit_id) + '</span>' : '') +
            (r.calc_rule && r.pay_type === 'BUDGET' ? '<br><span class="tiny muted">' + esc(r.calc_rule) + '</span>' : '') + '</td><td><span class="pill ' + (r.status === 'DELIVERED' ? 'g' : 'a') + '">' + esc(STATUS_TH[r.status] || r.status) + '</span>' +
            (r.flags ? '<br>' + flagsOf(r) : '') + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="muted" style="margin:0">ไม่พบหมาย</p>') + '</div>';
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
      '<button type="button" class="kind clay-mint" data-k="ISSUE"><b>ไฟล์จ่ายหมาย</b><span class="small">นำเข้าวันที่จ่ายหมาย — แบบรวมทุกคน หรือแยกรายคน · หมายใหม่จะมีสถานะ "จ่ายหมายแล้ว รอผล"</span>' +
        '<span class="howto">นำเข้าไฟล์เมนู <b>บัญชีหมาย</b> › ประเภท <b>50. บัญชีจ่ายหมาย พนักงานศาลนี้ส่ง (แบบรวม)</b> › เลือกวันที่ ถึงวันที่</span></button>' +
      '<button type="button" class="kind clay-mint" data-k="RESULT"><b>ไฟล์ผลหมาย</b><span class="small">นำเข้าวันอื่นได้ — หมายที่ส่งแล้วพร้อมวันที่ส่ง · ระบบจับคู่กับหมายเดิมแล้วเปลี่ยนเป็น "ส่งแล้ว"</span>' +
        '<span class="howto">นำเข้าไฟล์เมนู <b>บัญชีหมาย</b> › ประเภท <b>42. บัญชีผลการส่งคำคู่ความ ส่งโดยเจ้าพนักงาน</b> › เลือกวันที่ ถึงวันที่</span></button>' +
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
      (p.crosses_start ? '<p class="note r" style="margin:12px 0 0"><b>ช่วงวันที่ของไฟล์คร่อมวันเริ่มปีงบ ' + esc(thDate(p.start_date)) + '</b> — ไฟล์ 50 ไม่มีวันที่จ่ายรายแถว ระบบรับไว้ทุกแถว ' +
        num(p.date_unsure) + ' รายการใหม่ทำเครื่องหมาย "รอยืนยันวันที่จ่าย" ยังไม่คิดเงิน<br><span class="tiny">เมื่อนำเข้าไฟล์ 42 (มีวันที่จ่ายรายแถว) ระบบจะคัดให้เอง: หมายฟรีที่จ่ายก่อนวันเริ่มปีงบ = ไม่นับ · หมายมีเงิน = นับตามวันที่ส่ง</span></p>' : '') +
      (p.price_ne_rate ? '<p class="note" style="margin:12px 0 0"><b>' + num(p.price_ne_rate) + ' รายการ ราคาไม่เท่าอัตราตำบล</b> — นำเข้าได้ ระบบคิดเงินตามอัตราตำบล' +
        (p.price_adj ? (p.price_adj.up ? ' · <span class="flag-up">▲ เกิน ' + num(p.price_adj.up) + ' รายการ ' + num(p.price_adj.up_baht) + ' บาท (ไม่นำมาคิด)</span>' : '') + (p.price_adj.dn ? ' · <span class="flag-r">▼ ต่ำกว่า ' + num(p.price_adj.dn) + ' รายการ ' + num(p.price_adj.dn_baht) + ' บาท (ปรับขึ้นตามอัตรา)</span>' : '') +
          '<br><span class="tiny">ยอดหมายมีเงินที่คิดได้ ' + num(p.price_adj.calc) + ' บาท (ยอดตามไฟล์ ' + num(p.totals.PAID.amount) + ' บาท)</span>' : '') + '</p>' : '') +
      '<div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>แถว</th><th>เลขคดี</th><th>ชนิดหมาย</th><th>ผู้รับ</th><th style="min-width:130px">ผู้ส่ง</th><th style="min-width:110px">ประเภท / เงิน</th><th>พื้นที่</th><th>จ่าย / ส่ง</th><th>หมายเหตุ</th></tr></thead><tbody>' +
      (list.length ? list.map((r) => '<tr><td>' + r.row_no + '</td><td>' + esc(r.case_no) + (r.case_ref ? '<br><span class="tiny muted">' + esc(r.case_ref) + '</span>' : '') + '</td><td class="small">' + esc(r.notice_kind) + '</td><td class="small">' + esc(r.recipient) + '</td><td class="small">' + esc(r.officer) + '</td><td>' + esc(PAY_TH[r.pay_type] || '') +
        (r.pay_type === 'PAID' && r.amount !== '' ? '<br><span class="tiny">' + num(r.amount) + ' บาท' + (r.adj ? '<br>' + adjMark(r.adj) : (r.rate !== '' && Number(r.rate) !== Number(r.amount) ? ' (อัตราตำบล ' + num(r.rate) + ')' : '')) + '</span>' : '') +
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
        (r.calc ? (r.calc.error ? '<p class="note r" style="margin:0 0 12px">คำนวณค่าหมายไม่สำเร็จ: ' + esc(r.calc.error) + '</p>'
          : '<p class="note g" style="margin:0 0 12px">คำนวณค่าหมายใหม่แล้ว · หน่วยเบิกหมายฟรี ' + num(r.calc.units) + ' หน่วย' + (r.calc.warnings ? ' · ข้อควรตรวจ ' + num(r.calc.warnings) + ' รายการ' : '') + '</p>') : '') +
        '<div class="row"><button type="button" class="btn btn-g" id="again">นำเข้าไฟล์ถัดไป</button><button type="button" class="btn" id="toCalc">ดูยอดค่าหมาย</button><button type="button" class="btn" id="toHome">ไปหน้าแรก</button></div></div>';
      $('#imMap').innerHTML = ''; $('#imFile').innerHTML = '';
      $('#again').addEventListener('click', () => go('import'));
      $('#toHome').addEventListener('click', () => go('home'));
      $('#toCalc').addEventListener('click', () => go('calc'));
    } catch (e) { b.disabled = false; b.textContent = 'ยืนยันนำเข้า'; toast(e.message); }
  }

  /* ---------------------------------------------------------------- ประวัติการนำเข้า */
  RENDER.history = async (m) => {
    const d = await api('import_history');
    m.innerHTML = top('ประวัติการนำเข้า') + '<div class="clay panel"><div class="tbl-wrap"><table><thead><tr><th>เวลา</th><th>ชนิด</th><th>ไฟล์</th><th class="n">แถว</th><th class="n">ใหม่</th><th class="n">เดิม</th><th class="n">เปลี่ยน</th><th class="n">รออนุมัติ</th><th class="n">กำกวม</th><th class="n">ผิดพลาด</th><th>ผู้นำเข้า</th><th></th></tr></thead><tbody>' +
      (d.batches.length ? d.batches.map((b) => '<tr><td>' + esc(thDate(b.imported_at, true)) + '</td><td>' + esc(b.kind_th) + '</td><td>' + esc(b.file_name) + '</td><td class="n">' + num(b.rows_total) + '</td><td class="n">' + num(b.n_new) +
        '</td><td class="n">' + num(b.n_same) + '</td><td class="n">' + num(b.n_changed) + '</td><td class="n">' + num(b.n_held) + '</td><td class="n">' + num(b.n_ambiguous) + '</td><td class="n">' + num(b.n_error) + '</td><td>' + esc(b.imported_by) + '</td><td>' +
        (has('NOTICE', 'FINANCE', 'ADMIN') && (b.n_ambiguous + b.n_error) ? '<button type="button" class="btn btn-sm rv" data-b="' + esc(b.batch_id) + '">ดูแถวรอตรวจ</button>' : '') + '</td></tr>').join('')
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
  /* ---------------------------------------------------------------- คำนวณค่าหมาย (ระยะ 3) */
  const baht = (v) => Number(v || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  RENDER.calc = async (m) => {
    const d = await api('calc_summary', { fy: S.fy });
    S.fy = d.fy;
    const t = d.totals;
    const kpi = (lbl, v, sub, cls, raw, money) => '<div class="kpi clay ' + (cls || '') + '"><span>' + esc(lbl) + '</span><b' +
      (raw !== undefined ? ' data-count="' + Number(raw || 0) + '"' + (money ? ' data-money="1" data-suffix="&nbsp;฿"' : '') : '') + '>' + v + '</b>' + (sub ? '<span class="tiny muted">' + sub + '</span>' : '') + '</div>';
    m.innerHTML = top('คำนวณค่าหมาย · ปีงบประมาณ ' + esc(d.fy),
        '<button type="button" class="btn" id="printSum">พิมพ์ใบสรุป</button>' + (d.can_run ? ' <button type="button" class="btn btn-g" id="runCalc">คำนวณใหม่</button>' : '')) +
      '<p class="small muted" style="margin:0 6px">คำนวณล่าสุด ' + esc(thDate(d.last_run, true) || '—') + ' · ระบบคำนวณให้อัตโนมัติทุกครั้งที่นำเข้าไฟล์ · หมายฟรี: กฎหลายคดีต่างบ้าน หมู่เดียวกัน = ' + (d.mode === 'ONE' ? '1 หมาย' : 'หมายละกึ่งหนึ่ง') + ' (ระเบียบ ก.บ.ศ. 2562 ข้อ 7)</p>' +
      '<div class="grid-k">' +
        kpi('หมายมีเงิน', baht(t.paid_amount) + ' ฿', num(t.paid_n) + ' ฉบับ · ยังไม่ส่ง ' + num(t.paid_wait), 'mint', t.paid_amount, true) +
        kpi('หมายฟรี (คิดแล้ว)', baht(t.free_amount) + ' ฿', num(t.free_units) + ' หน่วยเบิก', 'mint', t.free_amount, true) +
        kpi('หมายฟรี รอวันที่ส่ง', num(t.free_wait), 'ยังไม่คิดเงิน', '', t.free_wait) +
        kpi('รวมค่าหมาย', baht(t.paid_amount + t.free_amount) + ' ฿', 'ก่อนแบ่ง 60:40', '', t.paid_amount + t.free_amount, true) +
        kpi('ข้อควรตรวจ', num(d.warnings.length + t.review + (t.date_wait || 0)), [(t.adj_up || t.adj_dn) ? '<span class="nb">คิดตามอัตราตำบล</span> ' + (t.adj_up ? '<span class="nb flag-up">▲ ' + num(t.adj_up) + '</span> ' : '') + (t.adj_dn ? '<span class="nb flag-r">▼ ' + num(t.adj_dn) + '</span>' : '') : '', t.date_wait ? '<span class="nb">วันที่จ่ายไม่แน่ชัด ' + num(t.date_wait) + '</span>' : ''].filter(Boolean).join(' · ')) +
      '</div>' +
      (t.date_wait ? '<p class="note r" style="margin:0 6px 12px"><b>' + num(t.date_wait) + ' หมาย อาจจ่ายเดือน ก.ย. · รอยืนยันวันที่จ่าย</b> (ไฟล์ 50 คร่อม 1 ต.ค. และยังไม่พบในไฟล์ 42) — ยังไม่รวมในยอดด้านบน · ดูและยืนยันได้ที่ "รายการรอยืนยัน" ด้านล่าง</p>' : '') +
      '<div class="clay panel"><h3>' + (d.scope_officer ? 'ค่าหมายของฉัน' : 'แยกรายผู้ส่งหมาย') + '</h3><div class="tbl-wrap"><table><thead><tr><th>ผู้ส่งหมาย</th>' +
      '<th class="n">มีเงิน (ฉบับ)</th><th class="n">มีเงิน (บาท)</th><th class="n">ฟรี (ฉบับ)</th><th class="n">หน่วยเบิก</th><th class="n">ฟรี (บาท)</th><th class="n">ฟรี รอวันส่ง</th><th class="n">รวม (บาท)</th><th></th></tr></thead><tbody>' +
      d.officers.map((o) => '<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + esc(o.color) + ';margin-right:8px"></span>' + esc(o.name) +
        (o.adj_up ? '<br><span class="tiny flag-up">▲ เกินอัตรา ' + num(o.adj_up) + ' ฉบับ ' + num(o.adj_up_baht) + '&nbsp;฿</span>' : '') +
        (o.adj_dn ? '<br><span class="tiny flag-r">▼ ต่ำกว่าอัตรา ' + num(o.adj_dn) + ' ฉบับ ' + num(o.adj_dn_baht) + '&nbsp;฿</span>' : '') + '</td>' +
        '<td class="n">' + num(o.paid_n) + '</td><td class="n">' + baht(o.paid_amount) + '</td><td class="n">' + num(o.free_n) + '</td><td class="n">' + num(o.free_units) +
        '</td><td class="n">' + baht(o.free_amount) + '</td><td class="n">' + num(o.free_wait) + '</td><td class="n"><b>' + baht(o.paid_amount + o.free_amount) + '</b></td>' +
        '<td><button type="button" class="btn btn-s ou" data-o="' + esc(o.officer_id) + '" data-n="' + esc(o.name) + '"' + (o.free_n ? '' : ' disabled') + '>หมายฟรี</button></td></tr>').join('') +
      '<tr class="sum"><td><b>รวม</b></td><td class="n"><b>' + num(t.paid_n) + '</b></td><td class="n"><b>' + baht(t.paid_amount) + '</b></td><td class="n"><b>' + num(t.free_n) + '</b></td><td class="n"><b>' + num(t.free_units) +
        '</b></td><td class="n"><b>' + baht(t.free_amount) + '</b></td><td class="n"><b>' + num(t.free_wait) + '</b></td><td class="n"><b>' + baht(t.paid_amount + t.free_amount) + '</b></td><td></td></tr>' +
      '</tbody></table></div><p class="tiny muted" style="margin:10px 0 0">หมายมีเงิน = ราคาตามบัญชีจ่ายหมาย ถ้าไม่เท่าอัตราตำบลคิดตามอัตราตำบล (▲ ส่วนเกินไม่นำมาคิด · ▼ ปรับขึ้นเป็นอัตรา) · หมายฟรี = อ.เมืองลพบุรี 300 บาท อำเภออื่นตามอัตราตำบล รวมหมายตาม "คราวเดียวกัน" (ผู้ส่ง + วันที่ส่ง + ตำบล + หมู่/หน่วยงาน/ถนน) · ยอดนี้ยังไม่แบ่ง 60:40 (ดูเมนูรอบเบิก / วันจ่าย 60:40)</p></div>' +
      (d.warnings.length ? '<div class="clay panel"><h3>ข้อควรตรวจ</h3><div class="tbl-wrap"><table><thead><tr><th>วันที่ส่ง</th><th>ผู้ส่ง</th><th>รายละเอียด</th><th class="n">ฉบับ</th><th>หน่วยเบิก</th></tr></thead><tbody>' +
        d.warnings.map((w) => '<tr><td>' + esc(thDate(w.date)) + '</td><td class="small">' + esc(w.officer) + '</td><td class="small">' + esc(w.text) + (w.place_key && !/^X:/.test(w.place_key) ? ' · ' + esc(w.place_key) : '') +
          '</td><td class="n">' + num(w.count) + '</td><td class="tiny">' + esc(w.unit_id) + '</td></tr>').join('') + '</tbody></table></div></div>' : '') +
      '<div id="chkBox"></div><div id="unitBox"></div>';
    drawChecks();
    countUp(m);
    $('#printSum').addEventListener('click', () => printSummary(d));
    if ($('#runCalc')) $('#runCalc').addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spin"></span> กำลังคำนวณ…';
      try { const r = await api('calc_run'); toast('คำนวณเสร็จ · หน่วยเบิก ' + num(r.units) + ' หน่วย'); go('calc'); }
      catch (er) { b.disabled = false; b.textContent = 'คำนวณใหม่'; toast(er.message); }
    });
    m.querySelectorAll('.ou').forEach((b) => b.addEventListener('click', () => drawUnits(b.dataset.o, b.dataset.n)));
    if (d.scope_officer && d.officers[0] && d.officers[0].free_n) drawUnits(d.officers[0].officer_id, d.officers[0].name);
  };
  /* รายการรอยืนยัน: ยอดเงินไม่ตรงอัตราตำบล · วันที่จ่ายไม่แน่ชัด (ไฟล์ 50 คร่อม 1 ต.ค.) */
  async function drawChecks() {
    const box = $('#chkBox'); if (!box || viewerOnly()) return;
    let d;
    try { d = await api('notice_checks', { fy: S.fy }); } catch (e) { box.innerHTML = ''; return; }
    if (!d.amount.length && !d.date.length) { box.innerHTML = ''; return; }
    const caseCell = (x) => '<b>' + esc(x.case_no) + '</b>' + (x.case_ref ? '<br><span class="tiny muted">' + esc(x.case_ref) + '</span>' : '') + '<br><span class="tiny muted">' + esc(x.kind) + '</span>';
    const waitN = d.date.filter((x) => !x.date_ok).length;
    const upL = d.amount.filter((x) => x.adj && x.adj.dir === 'UP'), dnL = d.amount.filter((x) => x.adj && x.adj.dir === 'DOWN');
    const sumD = (L) => L.reduce((a, x) => a + Number(x.adj.diff), 0);
    let h = '';
    if (d.amount.length) h += '<div class="clay panel"><h3>ราคาไม่เท่าอัตราตำบล · คิดตามอัตราตำบลแล้ว ' + num(d.amount.length) + ' ฉบับ</h3>' +
      '<p class="small" style="margin:0 0 10px">' + (upL.length ? '<span class="flag-up">▲ เกินอัตรา ' + num(upL.length) + ' ฉบับ รวม ' + num(sumD(upL)) + ' บาท — ส่วนเกินไม่นำมาคิดและแบ่ง 60:40</span>' : '') +
        (upL.length && dnL.length ? ' · ' : '') + (dnL.length ? '<span class="flag-r">▼ ต่ำกว่าอัตรา ' + num(dnL.length) + ' ฉบับ รวม ' + num(sumD(dnL)) + ' บาท — ปรับขึ้นเป็นอัตราตำบล</span>' : '') + '</p>' +
      '<p class="tiny muted" style="margin:0 0 10px">ระบบคิดเงินตามอัตราตำบลให้อัตโนมัติ ไม่ต้องกดยืนยัน · ราคาตามไฟล์เก็บไว้ตามเดิมเพื่อตรวจย้อนหลัง</p>' +
      '<div class="tbl-wrap"><table><thead><tr><th>เลขคดี</th><th>ผู้ส่ง</th><th>ผู้รับ / พื้นที่</th><th class="n">ราคาไฟล์</th><th class="n">อัตราตำบล (คิดเงิน)</th><th>ส่วนต่าง</th></tr></thead><tbody>' +
      d.amount.map((x) => '<tr><td>' + caseCell(x) + '</td><td class="small">' + esc(x.officer) + '</td><td class="small">' + esc(x.recipient) + '<br><span class="tiny muted">' + esc(x.place) + '</span></td>' +
        '<td class="n">' + num(x.amount) + '</td><td class="n"><b>' + num(x.rate) + '</b></td>' +
        '<td class="small">' + (x.adj ? adjMark(x.adj) + (x.adj.dir === 'UP' ? '<br><span class="tiny muted">ส่วนเกินไม่นำมาคิด</span>' : '<br><span class="tiny muted">ปรับขึ้นเป็นอัตราตำบล</span>') : '<span class="tiny muted">—</span>') +
        (x.ok ? '<br><span class="tiny muted" title="ประวัติก่อนเปลี่ยนกฎ">เคยยืนยันยอดไฟล์ ' + num(x.ok.value) + ' · ' + esc(x.ok.by) + ' · ' + esc(thDate(x.ok.at, true)) + '</span>' : '') + '</td></tr>').join('') +
      '</tbody></table></div></div>';
    if (d.date.length) h += '<div class="clay panel"><h3>วันที่จ่ายไม่แน่ชัด · รอยืนยัน ' + num(waitN) + ' · ยืนยันแล้ว ' + num(d.date.length - waitN) + '</h3>' +
      '<p class="tiny muted" style="margin:0 0 10px">หมายจากไฟล์ 50 ที่ช่วงวันที่คร่อม 1 ต.ค. และไม่พบวันที่จ่ายในไฟล์ 42 — ส่วนใหญ่คือหมายที่จ่ายเดือน ก.ย. · จ่ายเดือน ก.ย.: หมายฟรีไม่นับ หมายมีเงินนับเมื่อไฟล์ 42 ให้วันที่ส่งตั้งแต่ 1 ต.ค. · ถ้าภายหลังไฟล์ 42 มีวันที่จ่ายของหมายนั้น ระบบใช้วันที่จริงแทนการยืนยัน</p>' +
      (waitN && d.can_date ? '<p style="margin:0 0 10px"><button type="button" class="btn btn-s" id="cbAll">ยืนยันทั้งหมดที่เหลือ: จ่ายเดือน ก.ย. (' + num(waitN) + ')</button></p>' : '') +
      '<div class="tbl-wrap"><table><thead><tr><th>เลขคดี</th><th>ประเภท</th><th>ผู้ส่ง</th><th>ผู้รับ / พื้นที่</th><th>สถานะ</th><th></th></tr></thead><tbody>' +
      d.date.map((x) => '<tr><td>' + caseCell(x) + '</td><td><span class="pill ' + (x.pay_type === 'BUDGET' ? 'b' : 'g') + '">' + esc(PAY_TH[x.pay_type] || '') + '</span>' +
        (x.pay_type === 'PAID' && x.amount !== '' ? '<br><span class="tiny">' + num(x.amount) + ' บาท</span>' : '') + '</td><td class="small">' + esc(x.officer) + '</td>' +
        '<td class="small">' + esc(x.recipient) + '<br><span class="tiny muted">' + esc(x.place) + '</span></td>' +
        '<td class="small">' + (!x.date_ok ? '<span class="flag-r">อาจจ่ายเดือน ก.ย. · รอยืนยัน</span>'
          : '<span class="pill ' + (x.date_ok === 'BEFORE' ? 'a' : 'g') + '">' + (x.date_ok === 'BEFORE' ? 'จ่ายเดือน ก.ย. · ไม่นับ' : 'จ่ายตั้งแต่ 1 ต.ค.') + '</span><br><span class="tiny muted">' + esc(x.date_ok_by) + ' · ' + esc(thDate(x.date_ok_at, true)) + '</span>') + '</td>' +
        '<td><div class="chk-acts">' + (!x.date_ok && d.can_date ? '<button type="button" class="btn btn-s cb" data-u="' + esc(x.notice_uid) + '" data-v="BEFORE">จ่ายเดือน ก.ย.</button><button type="button" class="btn btn-s cb" data-u="' + esc(x.notice_uid) + '" data-v="AFTER">จ่ายตั้งแต่ 1 ต.ค.</button>' : '') +
        (x.date_ok && d.can_undo ? '<button type="button" class="btn btn-s cb" data-u="' + esc(x.notice_uid) + '" data-v="CLEAR">ล้าง</button>' : '') + '</div></td></tr>').join('') +
      '</tbody></table></div></div>';
    box.innerHTML = h;
    const busy = (b) => { b.disabled = true; b.innerHTML = '<span class="spin"></span>'; };
    box.querySelectorAll('.ca').forEach((b) => b.addEventListener('click', async () => {
      busy(b);
      try { await api('notice_confirm_amount', { notice_uids: [b.dataset.u] }); toast('ยืนยันยอดตรงแล้ว'); go('calc'); } catch (e) { toast(e.message); drawChecks(); }
    }));
    box.querySelectorAll('.cu').forEach((b) => b.addEventListener('click', async () => {
      const reason = window.prompt('เหตุผลที่ยกเลิกการยืนยันยอด'); if (!reason) return;
      busy(b);
      try { await api('notice_confirm_amount', { notice_uids: [b.dataset.u], undo: true, reason: reason }); toast('ยกเลิกการยืนยันแล้ว'); go('calc'); } catch (e) { toast(e.message); drawChecks(); }
    }));
    box.querySelectorAll('.cb').forEach((b) => b.addEventListener('click', async () => {
      busy(b);
      try { await api('notice_confirm_date', { notice_uids: [b.dataset.u], value: b.dataset.v }); toast('บันทึกแล้ว · คำนวณใหม่แล้ว'); go('calc'); } catch (e) { toast(e.message); drawChecks(); }
    }));
    if ($('#cbAll')) $('#cbAll').addEventListener('click', async (e) => {
      const ids = d.date.filter((x) => !x.date_ok).map((x) => x.notice_uid);
      if (!window.confirm('ยืนยันว่า ' + ids.length + ' หมายนี้จ่ายเดือน ก.ย. (ก่อนเริ่มปีงบ)?\nหมายฟรีจะไม่นับ · หมายมีเงินนับเมื่อมีวันที่ส่งตั้งแต่ 1 ต.ค.')) return;
      busy(e.currentTarget);
      try { const r = await api('notice_confirm_date', { notice_uids: ids, value: 'BEFORE' }); toast('ยืนยันแล้ว ' + num(r.updated) + ' หมาย'); go('calc'); } catch (er) { toast(er.message); drawChecks(); }
    });
  }
  async function drawUnits(oid, name) {
    const box = $('#unitBox');
    box.innerHTML = '<div class="clay panel"><span class="spin"></span> กำลังโหลดหน่วยเบิก…</div>';
    try {
      const d = await api('calc_units', { fy: S.fy, officer_id: oid });
      box.innerHTML = '<div class="clay panel"><h3>หน่วยเบิกหมายฟรี · ' + esc(name) + ' (' + num(d.units.length) + ' หน่วย)</h3>' +
        '<div class="tbl-wrap"><table><thead><tr><th>วันที่ส่ง</th><th>พื้นที่</th><th>หลักการคิด</th><th>หมายที่รวม (เลขคดี · ยอดรายฉบับ)</th><th class="n">อัตรา</th><th class="n">ยอดหน่วย</th></tr></thead><tbody>' +
        (d.units.length ? d.units.map((u) => '<tr><td>' + esc(thDate(u.delivered_date)) + '<br><span class="tiny muted">' + esc(u.unit_id) + '</span></td>' +
          '<td class="small">' + esc(u.place) + '<br><span class="tiny muted">' + esc(u.place_key) + (u.addr_type && u.addr_type !== 'มีหมู่' ? ' · ' + esc(u.addr_type) : '') + '</span></td>' +
          '<td class="small">' + esc(u.rule) + '<br><span class="tiny muted">' + num(u.notice_count) + ' ฉบับ · ' + num(u.sub_units) + ' หน่วยย่อย</span></td>' +
          '<td class="small">' + u.notices.map((x) => esc(x.case_no) + ' <span class="muted">' + esc(x.kind) + '</span> · ' + baht(x.amount)).join('<br>') + '</td>' +
          '<td class="n">' + baht(u.rate_base) + '</td><td class="n"><b>' + baht(u.amount) + '</b></td></tr>').join('')
          : '<tr><td colspan="6" class="muted">ยังไม่มีหน่วยเบิก (หมายฟรียังไม่มีวันที่ส่ง)</td></tr>') +
        '</tbody></table></div>' +
        (d.pending.length ? '<h3 style="margin-top:18px">หมายฟรีที่ยังไม่คิดเงิน (' + num(d.pending.length) + ')</h3><div class="tbl-wrap"><table><thead><tr><th>เลขคดี</th><th>ชนิดหมาย</th><th>วันที่จ่าย</th><th>สถานะ</th></tr></thead><tbody>' +
          d.pending.map((p) => '<tr><td>' + esc(p.case_no) + '</td><td class="small">' + esc(p.kind) + '</td><td>' + esc(thDate(p.issued_date) || '—') + '</td><td class="small">' + esc(p.rule) + (p.note ? ' · ' + esc(p.note) : '') + '</td></tr>').join('') +
          '</tbody></table></div>' : '') + '</div>';
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { box.innerHTML = '<div class="clay panel"><p class="note r" style="margin:0">' + esc(e.message) + '</p></div>'; }
  }

  /* ---------------------------------------------------------------- รอบเบิก / วันจ่าย 60:40 (ระยะ 4) */
  /** แบ่ง 60:40 — ตรรกะเดียวกับ payoutSplit_ ฝั่งเซิร์ฟเวอร์ (หน่วยสตางค์) */
  function splitPreview(lines, seats, policy, carryInC) {
    const N = Math.floor(Number(seats) || 0);
    const out = lines.map((l) => { const t = l.paid_c + l.budget_c, c60 = Math.round(t * 0.6); return Object.assign({}, l, { total_c: t, c60: c60, c40: t - c60 }); });
    const s = (k) => out.reduce((a, x) => a + x[k], 0);
    const pool40 = s('c40'), poolC = pool40 + Math.round(carryInC || 0);
    const p = String(policy || 'DOWN_SATANG_CARRY');
    let ps = 0, extra = 0;
    if (N >= 1) {
      if (p === 'UP_SATANG') ps = Math.ceil(poolC / N); else if (p === 'DOWN_BAHT_CARRY') ps = Math.floor(poolC / N / 100) * 100;
      else if (p === 'UP_BAHT') ps = Math.ceil(poolC / N / 100) * 100; else if (p === 'NEAREST_BAHT') ps = Math.round(poolC / N / 100) * 100;
      else ps = Math.floor(poolC / N);
      if (ps < 0) ps = 0;
    }
    let paidOut = ps * N, carryOut = N >= 1 ? poolC - paidOut : 0;
    if (p === 'EXACT' && N >= 1) { extra = carryOut; carryOut = 0; paidOut = poolC; }
    return { lines: out, paid_c: s('paid_c'), budget_c: s('budget_c'), total_c: s('total_c'), c60: s('c60'), pool40_c: pool40,
             carry_in_c: Math.round(carryInC || 0), pool_c: poolC, per_seat_c: ps, extra_one_c: extra, carry_out_c: carryOut, seats: N };
  }
  const baht2 = (v) => Number(v || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cb = (c) => baht2(c / 100);
  const typeChip = (t) => t === 'PAID' ? '<span class="pchip pm">มีเงิน</span>' : '<span class="pchip pf">ฟรี</span>';
  function splitTable(sp, names, opts) {
    opts = opts || {};
    const nm = (id) => esc((names[id] || {}).name || id);
    return '<div class="tbl-wrap"><table class="ptbl"><thead><tr><th>ผู้ส่งหมาย</th><th class="n">หมายมีเงิน</th><th class="n">หมายฟรี</th><th class="n">รวม</th><th class="n">ผู้ส่ง 60%</th><th class="n">กองกลาง 40%</th></tr></thead><tbody>' +
      (sp.lines.length ? sp.lines.map((l) => '<tr><td class="pnm"><span class="odot" style="background:' + esc((names[l.officer_id] || {}).color || '#999') + '"></span>' + nm(l.officer_id) + '</td>' +
        '<td class="n">' + cb(l.paid_c) + (l.n_paid ? '<span class="pcnt">' + num(l.n_paid) + ' หมาย</span>' : '') + '</td><td class="n">' + cb(l.budget_c) + (l.n_budget ? '<span class="pcnt">' + num(l.n_budget) + ' หน่วย</span>' : '') +
        '</td><td class="n"><b>' + cb(l.total_c) + '</b></td><td class="n">' + cb(l.c60) + '</td><td class="n">' + cb(l.c40) + '</td></tr>').join('')
        : '<tr><td colspan="6" class="muted small">ยังไม่ได้เลือกรายการ</td></tr>') +
      '</tbody><tfoot><tr><td><b>รวม</b></td><td class="n"><b>' + cb(sp.paid_c) + '</b></td><td class="n"><b>' + cb(sp.budget_c) + '</b></td><td class="n"><b>' + cb(sp.total_c) +
      '</b></td><td class="n"><b>' + cb(sp.c60) + '</b></td><td class="n"><b>' + cb(sp.pool40_c) + '</b></td></tr></tfoot></table></div>' +
      '<div class="pool">' +
        '<div><span>กองกลาง 40%</span><b>' + cb(sp.pool40_c) + '</b></div>' +
        '<div><span>เศษยกมาจากรอบก่อน</span><b>' + cb(sp.carry_in_c) + '</b></div>' +
        '<div><span>รวมกองกลาง</span><b>' + cb(sp.pool_c) + '</b></div>' +
        '<div class="ps"><span>คนนั่งงาน ' + num(sp.seats) + ' คน ได้คนละ</span><b>' + cb(sp.per_seat_c) + '&nbsp;฿</b></div>' +
        (sp.extra_one_c ? '<div><span>เศษให้ 1 คน</span><b>' + cb(sp.extra_one_c) + '</b></div>' : '') +
        '<div><span>เศษยกไปรอบหน้า</span><b' + (sp.carry_out_c < 0 ? ' class="flag-r"' : '') + '>' + cb(sp.carry_out_c) + '</b></div>' +
      '</div>' + (opts.policyTh ? '<p class="tiny muted" style="margin:8px 2px 0">วิธีปัดเศษ: ' + esc(opts.policyTh) + ' · บัญชี 60:40 เป็นบัญชีคำนวณภายใน แยกจากเอกสารเบิกจ่ายทางราชการ</p>' : '');
  }

  RENDER.payout = async (m, sub) => {
    sub = sub || S.payoutSub || 'list';
    S.payoutSub = 'list';
    if (sub === 'new') return payoutNew(m);
    if (/^round:/.test(sub)) return payoutRound(m, sub.slice(6));
    const d = await api('payout_list');
    const names = d.officers;
    const bl = d.backlog;
    const T = bl.reduce((a, b) => ({ pn: a.pn + b.paid_n, p: a.p + b.paid, bn: a.bn + b.budget_n, b: a.b + b.budget, h: a.h + b.held_n }), { pn: 0, p: 0, bn: 0, b: 0, h: 0 });
    const bk = d.blocked || {};
    m.innerHTML = top('รอบเบิก / วันจ่าย 60:40', d.can_create ? '<button type="button" class="btn btn-g" id="pNew">+ สร้างรอบเบิกใหม่</button>' : '') +
      '<div class="clay panel"><div class="row" style="justify-content:space-between;align-items:baseline"><h3 style="margin:0">กล่อง "ยังไม่ได้เบิก"</h3>' +
      '<span class="small muted">ส่งแล้ว คำนวณแล้ว ยังไม่เข้ารอบใด · รวม <b>' + baht2(T.p + T.b) + ' ฿</b></span></div>' +
      '<div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th>ผู้ส่งหมาย</th><th class="n">หมายมีเงิน (ฉบับ)</th><th class="n">บาท</th><th class="n">หมายฟรี (ฉบับ)</th><th class="n">บาท</th><th class="n">เคยเลื่อน</th><th class="n">ค้างนานสุด</th></tr></thead><tbody>' +
      (bl.length ? bl.map((b) => '<tr><td><span class="odot" style="background:' + esc((names[b.officer_id] || {}).color || '#999') + '"></span>' + esc((names[b.officer_id] || {}).name || b.officer_id) + '</td><td class="n">' + num(b.paid_n) + '</td><td class="n">' + baht2(b.paid) +
        '</td><td class="n">' + num(b.budget_n) + '</td><td class="n">' + baht2(b.budget) + '</td><td class="n">' + (b.held_n ? '<span class="pchip ph">' + num(b.held_n) + '</span>' : '—') + '</td><td class="n">' + num(b.oldest_days) + ' วัน</td></tr>').join('')
        : '<tr><td colspan="7" class="muted small">ไม่มีรายการค้างเบิก</td></tr>') +
      '</tbody><tfoot><tr><td><b>รวม</b></td><td class="n"><b>' + num(T.pn) + '</b></td><td class="n"><b>' + baht2(T.p) + '</b></td><td class="n"><b>' + num(T.bn) + '</b></td><td class="n"><b>' + baht2(T.b) + '</b></td><td class="n"><b>' + num(T.h) + '</b></td><td></td></tr></tfoot></table></div>' +
      '<p class="tiny muted" style="margin:8px 2px 0">ยังไม่เข้าเกณฑ์เบิก: รอผลการส่ง ' + num(bk.wait || 0) + ' · ยอดไม่ตรงอัตรารอยืนยัน ' + num(bk.red || 0) + ' · รอตรวจ ' + num(bk.review || 0) + ' ฉบับ</p></div>' +
      '<div class="clay panel"><h3>รอบเบิกที่ผ่านมา</h3>' + (d.rounds.length ? '<div class="tbl-wrap"><table><thead><tr><th>วันที่จ่าย</th><th>ประเภท</th><th class="n">รายการ</th><th class="n">เลื่อน</th><th class="n">ยอดรวม</th><th class="n">คนนั่ง</th><th class="n">ได้คนละ</th><th class="n">เศษยกไป</th><th>สถานะ</th><th></th></tr></thead><tbody>' +
        d.rounds.map((r) => '<tr' + (r.status === 'CANCELLED' ? ' class="muted"' : '') + '><td>' + esc(thDate(r.pay_date)) + '</td><td>' + (r.include_paid ? typeChip('PAID') : '') + ' ' + (r.include_budget ? typeChip('BUDGET') : '') +
          '</td><td class="n">' + num(r.n_items) + '</td><td class="n">' + num(r.n_excluded) + '</td><td class="n"><b>' + baht2(r.total) + '</b></td><td class="n">' + num(r.seats) + '</td><td class="n">' + baht2(r.per_seat) + '</td><td class="n">' + baht2(r.carry_out) +
          '</td><td>' + (r.status === 'CONFIRMED' ? '<span class="pchip pok">ยืนยันแล้ว</span>' : '<span class="pchip pcx">ยกเลิก</span>') + '</td><td><button type="button" class="btn btn-sm" data-r="' + esc(r.round_id) + '">ดู / พิมพ์</button></td></tr>').join('') +
        '</tbody></table></div>' : '<p class="small muted" style="margin:0">ยังไม่มีรอบเบิก' + (d.can_create ? ' — กด "สร้างรอบเบิกใหม่" เพื่อเริ่ม' : '') + '</p>') + '</div>';
    if ($('#pNew')) $('#pNew').addEventListener('click', () => { S.payoutSub = 'new'; go('payout'); });
    m.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => { S.payoutSub = 'round:' + b.dataset.r; go('payout'); }));
  };

  async function payoutNew(m) {
    const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
    m.innerHTML = top('สร้างรอบเบิกใหม่', '<button type="button" class="btn btn-sm" id="pBack">← กลับ</button>') +
      '<form class="clay panel" id="pForm"><div class="pform">' +
      '<label>วันที่จ่าย (วันที่ได้รับเงิน)<input type="date" class="inp" id="pDate" value="' + today + '" required></label>' +
      '<label>วันตัดยอด (หมายที่ส่งไม่เกินวันนี้)<input type="date" class="inp" id="pCut" value="' + today + '" required></label>' +
      '<fieldset><legend>ประเภทที่เบิกในรอบนี้</legend><label class="ck"><input type="checkbox" id="pPaid" checked> หมายมีเงิน</label><label class="ck"><input type="checkbox" id="pBud" checked> หมายฟรี</label></fieldset>' +
      '<button class="btn btn-g" id="pLoad">ดึงรายการพร้อมเบิก</button></div>' +
      '<p class="tiny muted" style="margin:10px 2px 0">ระบบดึงหมายที่ส่งแล้ว คำนวณแล้ว ยังไม่เคยเข้ารอบ และไม่ติดรอตรวจ · ติ๊กไว้ทั้งหมด — เอาติ๊กออกรายการที่ <b>ยังไม่เสนอเบิกจ่าย</b> แล้วรายการนั้นจะค้างไว้เบิกรอบหน้า</p></form>' +
      '<div id="pBody"></div>';
    $('#pBack').addEventListener('click', () => { S.payoutSub = 'list'; go('payout'); });
    $('#pForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = $('#pBody'); body.innerHTML = '<div class="clay panel"><span class="spin"></span> <span class="muted">กำลังดึงรายการ…</span></div>';
      try {
        const d = await api('payout_candidates', { pay_date: $('#pDate').value, cutoff: $('#pCut').value, include_paid: $('#pPaid').checked, include_budget: $('#pBud').checked });
        drawPicker(body, d);
      } catch (x) { body.innerHTML = '<div class="clay panel"><p class="note r" style="margin:0">' + esc(x.message) + '</p></div>'; }
    });
  }

  function drawPicker(box, d) {
    const names = d.officers, off = new Set();          // off = key ที่เอาออก (ยังไม่เสนอเบิกจ่าย)
    const byOff = {};
    d.items.forEach((it) => { (byOff[it.officer_id] = byOff[it.officer_id] || []).push(it); });
    const offIds = Object.keys(byOff).sort();
    if (!d.items.length) { box.innerHTML = '<div class="clay panel"><p class="small muted" style="margin:0">ไม่มีรายการพร้อมเบิกตามเงื่อนไขนี้ (ยังไม่ส่ง ' + num(d.blocked.wait) + ' · ส่งหลังวันตัด ' + num(d.blocked.late) + ' · รอยืนยัน/รอตรวจ ' + num(d.blocked.red + d.blocked.review) + ')</p></div>'; return; }
    const row = (it) => '<label class="pit" data-k="' + esc(it.key) + '"><input type="checkbox" checked data-k="' + esc(it.key) + '">' + typeChip(it.type) +
      '<span class="pcase">' + esc(it.case_list) + (it.n > 1 ? ' <span class="tiny muted">(' + num(it.n) + ' ฉบับ รวมเป็น 1 หมาย)</span>' : '') + '</span>' +
      '<span class="tiny muted pdt">ส่ง ' + esc(thDate(it.delivered_date)) + (it.age_days ? ' · ค้าง ' + num(it.age_days) + ' วัน' : '') + '</span>' +
      (it.held ? '<span class="pchip ph" title="รอบ ' + esc(it.held.round_id) + '">เคยเลื่อน ' + esc(thDate(it.held.pay_date)) + '</span>' : '') +
      (it.adj ? adjMark(it.adj) : '') + '<span class="pnot">ยังไม่เสนอเบิกจ่าย</span><b class="pamt">' + cb(it.amount_c) + '</b></label>';
    box.innerHTML = '<div class="pgrid"><div class="plist">' + offIds.map((id) =>
      '<section class="clay panel poff" data-o="' + esc(id) + '"><div class="poff-h"><label class="ck"><input type="checkbox" checked data-all="' + esc(id) + '"> <span class="odot" style="background:' + esc((names[id] || {}).color || '#999') + '"></span><b>' + esc((names[id] || {}).name || id) + '</b></label>' +
      '<span class="small muted" data-sum="' + esc(id) + '"></span></div>' + byOff[id].map(row).join('') + '</section>').join('') + '</div>' +
      '<aside class="clay panel psum"><h3>สรุปรอบ ' + esc(thDate(d.pay_date)) + '</h3><div id="pSplit"></div>' +
      '<label class="pseat">จำนวนคนนั่งงาน (N)<input type="number" class="inp" id="pSeats" min="1" max="1000" value="' + esc(d.seats) + '"></label>' +
      '<label class="pseat">หมายเหตุ (ถ้ามี)<input class="inp" id="pNote" maxlength="300" placeholder="เช่น เลื่อนจ่ายจากวันศุกร์"></label>' +
      '<button type="button" class="btn btn-g" id="pOk" style="width:100%">ยืนยันรอบเบิก</button>' +
      '<p class="tiny muted" style="margin:8px 2px 0">ยืนยันแล้วหมายในรอบจะถูกล็อก เบิกซ้ำไม่ได้ · ยกเลิกได้เฉพาะรอบล่าสุดโดยผู้ดูแลระบบ</p></aside></div>';
    const recalc = () => {
      const inc = d.items.filter((it) => !off.has(it.key));
      const by = {};
      inc.forEach((it) => { const l = by[it.officer_id] = by[it.officer_id] || { officer_id: it.officer_id, paid_c: 0, budget_c: 0, n_paid: 0, n_budget: 0 };
        if (it.type === 'PAID') { l.paid_c += it.amount_c; l.n_paid += it.n; } else { l.budget_c += it.amount_c; l.n_budget += it.n; } });
      const sp = splitPreview(Object.keys(by).sort().map((k) => by[k]), $('#pSeats').value, d.policy, Math.round(d.carry_in * 100));
      $('#pSplit').innerHTML = splitTable(sp, names, { policyTh: d.policy_th });
      offIds.forEach((id) => {
        const all = byOff[id], sel = all.filter((it) => !off.has(it.key));
        box.querySelector('[data-sum="' + id + '"]').textContent = 'เบิก ' + sel.length + '/' + all.length + ' รายการ · ' + cb(sel.reduce((a, x) => a + x.amount_c, 0)) + ' ฿';
        const ca = box.querySelector('[data-all="' + id + '"]'); ca.checked = sel.length === all.length; ca.indeterminate = sel.length > 0 && sel.length < all.length;
      });
      $('#pOk').disabled = !inc.length || !(Number($('#pSeats').value) >= 1);
      $('#pOk').textContent = 'ยืนยันรอบเบิก · ' + cb(sp.total_c) + ' ฿';
    };
    box.querySelectorAll('.pit input').forEach((c) => c.addEventListener('change', () => {
      if (c.checked) off.delete(c.dataset.k); else off.add(c.dataset.k);
      c.closest('.pit').classList.toggle('out', !c.checked); recalc();
    }));
    box.querySelectorAll('[data-all]').forEach((c) => c.addEventListener('change', () => {
      byOff[c.dataset.all].forEach((it) => { if (c.checked) off.delete(it.key); else off.add(it.key); });
      box.querySelectorAll('[data-o="' + c.dataset.all + '"] .pit input').forEach((x) => { x.checked = c.checked; x.closest('.pit').classList.toggle('out', !c.checked); });
      recalc();
    }));
    $('#pSeats').addEventListener('input', recalc);
    $('#pOk').addEventListener('click', async () => {
      const inc = d.items.length - off.size;
      if (!window.confirm('ยืนยันรอบเบิกวันที่ ' + thDate(d.pay_date) + '\nเบิก ' + inc + ' รายการ · ยังไม่เสนอเบิกจ่าย ' + off.size + ' รายการ\nคนนั่งงาน ' + $('#pSeats').value + ' คน')) return;
      const b = $('#pOk'); b.disabled = true; b.innerHTML = '<span class="spin"></span> กำลังบันทึก…';
      try {
        const r = await api('payout_confirm', { pay_date: d.pay_date, cutoff: d.cutoff, include_paid: d.include_paid, include_budget: d.include_budget,
          seats: Number($('#pSeats').value), excluded: Array.from(off), expect_count: d.items.length, note: $('#pNote').value });
        toast('ยืนยันรอบเบิกแล้ว'); S.payoutSub = 'round:' + r.round.round_id; go('payout');
      } catch (x) { toast(x.message); b.disabled = false; recalc(); }
    });
    recalc();
  }

  async function payoutRound(m, rid) {
    const d = await api('payout_get', { round_id: rid });
    const r = d.round, names = d.officers;
    const sp = { lines: d.lines.map((l) => ({ officer_id: l.officer_id, paid_c: Math.round(l.paid * 100), budget_c: Math.round(l.budget * 100), total_c: Math.round(l.total * 100), c60: Math.round(l.c60 * 100), c40: Math.round(l.c40 * 100), n_paid: l.n_paid, n_budget: l.n_budget })),
      paid_c: r.total_paid * 100, budget_c: r.total_budget * 100, total_c: r.total * 100, c60: r.courier60 * 100, pool40_c: r.pool40 * 100, carry_in_c: r.carry_in * 100, pool_c: r.pool_total * 100,
      per_seat_c: Math.round(r.per_seat * 100), extra_one_c: Math.round(r.extra_one * 100), carry_out_c: Math.round(r.carry_out * 100), seats: r.seats };
    const inc = d.items.filter((x) => x.included), exc = d.items.filter((x) => !x.included);
    const itemRows = (L) => L.map((it) => '<tr><td>' + esc((names[it.officer_id] || {}).name || it.officer_id) + '</td><td>' + typeChip(it.type) + '</td><td>' + esc(it.case_list) + (it.n > 1 ? ' <span class="tiny muted">(' + num(it.n) + ' ฉบับ)</span>' : '') +
      (it.reason && it.reason !== 'ยังไม่เสนอเบิกจ่าย' ? '<br><span class="tiny ' + (/^▼|· ▼/.test(it.reason) ? 'flag-r' : 'flag-up') + '">' + esc(String(it.reason).replace(/^ยังไม่เสนอเบิกจ่าย · /, '')) + '</span>' : '') +
      '</td><td>' + esc(thDate(it.delivered_date)) + '</td><td class="n">' + baht2(it.amount) + '</td></tr>').join('');
    m.innerHTML = top('รอบเบิกวันที่ ' + thDate(r.pay_date), '<div class="row" style="gap:8px"><button type="button" class="btn btn-sm" id="pBack">← รายการรอบ</button><button type="button" class="btn btn-g btn-sm" id="pPrint">พิมพ์ใบแบ่งยอด 60:40</button>' +
      (d.can_cancel ? '<button type="button" class="btn btn-sm" id="pCancel">ยกเลิกรอบ</button>' : '') + '</div>') +
      (r.status === 'CANCELLED' ? '<div class="note r">รอบนี้ถูกยกเลิกโดย ' + esc(r.cancelled_by) + ' เมื่อ ' + esc(thDate(r.cancelled_at, true)) + ' · เหตุผล: ' + esc(r.cancel_reason) + '</div>' : '') +
      '<div class="bn4"><div class="kpi clay kt k-all"><span>ยอดรวมรอบนี้</span><b>' + baht2(r.total) + '&nbsp;฿</b><small>มีเงิน ' + baht2(r.total_paid) + ' · ฟรี ' + baht2(r.total_budget) + '</small></div>' +
      '<div class="kpi clay kt k-paid"><span>ผู้ส่งหมาย 60%</span><b>' + baht2(r.courier60) + '&nbsp;฿</b><small>' + num(d.lines.length) + ' คน</small></div>' +
      '<div class="kpi clay kt k-free"><span>กองกลาง 40% (+เศษยกมา)</span><b>' + baht2(r.pool_total) + '&nbsp;฿</b><small>เศษยกมา ' + baht2(r.carry_in) + '</small></div>' +
      '<div class="kpi clay kt k-done"><span>คนนั่งงาน ' + num(r.seats) + ' คน ได้คนละ</span><b>' + baht2(r.per_seat) + '&nbsp;฿</b><small>เศษยกไป ' + baht2(r.carry_out) + '</small></div></div>' +
      '<div class="clay panel"><h3>ใบแบ่งยอด 60:40 รายผู้ส่ง</h3>' + splitTable(sp, names, { policyTh: r.policy_th }) +
      '<p class="tiny muted" style="margin:6px 2px 0">วันตัดยอด ' + esc(thDate(r.cutoff_date)) + ' · บันทึกโดย ' + esc(r.created_by) + ' เมื่อ ' + esc(thDate(r.created_at, true)) + (r.note ? ' · หมายเหตุ: ' + esc(r.note) : '') + '</p></div>' +
      (d.items.length ? '<div class="clay panel"><h3>รายการที่เบิกในรอบนี้ (' + num(inc.length) + ')</h3><div class="tbl-wrap"><table><thead><tr><th>ผู้ส่งหมาย</th><th>ประเภท</th><th>เลขคดี</th><th>วันที่ส่ง</th><th class="n">บาท</th></tr></thead><tbody>' + itemRows(inc) + '</tbody></table></div></div>' +
        (exc.length ? '<div class="clay panel"><h3>ยังไม่เสนอเบิกจ่าย (' + num(exc.length) + ') — ยกไปรอบหน้า</h3><div class="tbl-wrap"><table><thead><tr><th>ผู้ส่งหมาย</th><th>ประเภท</th><th>เลขคดี</th><th>วันที่ส่ง</th><th class="n">บาท</th></tr></thead><tbody>' + itemRows(exc) + '</tbody></table></div></div>' : '') : '');
    $('#pBack').addEventListener('click', () => { S.payoutSub = 'list'; go('payout'); });
    $('#pPrint').addEventListener('click', () => printPayout(d));
    if ($('#pCancel')) $('#pCancel').addEventListener('click', async () => {
      const reason = window.prompt('เหตุผลที่ยกเลิกรอบนี้ (หมายในรอบจะกลับเป็นพร้อมเบิก)'); if (!reason) return;
      try { await api('payout_cancel', { round_id: rid, reason: reason }); toast('ยกเลิกรอบแล้ว'); S.payoutSub = 'round:' + rid; go('payout'); } catch (x) { toast(x.message); }
    });
  }

  /** หมายเหตุใบแบ่งยอด: หมายมีเงินที่คิดตามอัตราตำบล (▲ ส่วนเกิน / ▼ ปรับขึ้น) */
  function adjPrint(items) {
    const L = (items || []).filter((x) => x.included && /[▲▼]/.test(String(x.reason || '')));
    if (!L.length) return '';
    return '(หมายมีเงินราคาไม่เท่าอัตราตำบล คิดตามอัตราตำบล: ' + L.map((x) => esc(x.case_list) + ' ' + esc(String(x.reason).replace(/ — .*$/, '').replace(/^ยังไม่เสนอเบิกจ่าย · /, ''))).join(' ; ') + ') ';
  }
  async function printPayout(d) {
    if (!document.getElementById('fSarabun')) {
      const l = document.createElement('link'); l.id = 'fSarabun'; l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap'; document.head.appendChild(l);
    }
    const r = d.round, names = d.officers;
    const dLong = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
    const rows = d.lines.map((l, i) => '<tr><td class="c">' + (i + 1) + '</td><td>' + esc((names[l.officer_id] || {}).name || l.officer_id) + '</td><td class="n">' + baht2(l.paid) + '</td><td class="n">' + baht2(l.budget) +
      '</td><td class="n"><b>' + baht2(l.total) + '</b></td><td class="n">' + baht2(l.c60) + '</td><td class="n">' + baht2(l.c40) + '</td><td class="c">☐</td></tr>').join('');
    let pa = document.getElementById('printArea');
    if (!pa) { pa = document.createElement('div'); pa.id = 'printArea'; document.body.appendChild(pa); }
    pa.innerHTML = '<div class="pr-head"><img src="court-seal.webp" alt=""><div class="pr-court">ศาลจังหวัดลพบุรี</div>' +
      '<div class="pr-title">ใบแบ่งยอดค่าหมาย ๖๐ : ๔๐ วันที่จ่าย ' + esc(dLong(r.pay_date)) + '</div>' +
      '<div class="pr-sub">รอบ ' + esc(r.round_id) + ' · ตัดยอดหมายที่ส่งถึงวันที่ ' + esc(dLong(r.cutoff_date)) + (r.status === 'CANCELLED' ? ' · <b>ยกเลิกแล้ว</b>' : '') + '</div></div>' +
      '<table class="pr-tbl"><thead><tr><th>ที่</th><th>ชื่อ – สกุล</th><th>หมายมีเงิน (บาท)</th><th>หมายฟรี (บาท)</th><th>รวมที่ได้รับ</th><th>ผู้ส่ง ๖๐%</th><th>นำกลับ ๔๐%</th><th>นำกลับแล้ว</th></tr></thead><tbody>' + rows +
      '<tr class="pr-sum"><td></td><td><b>รวมทั้งสิ้น</b></td><td class="n"><b>' + baht2(r.total_paid) + '</b></td><td class="n"><b>' + baht2(r.total_budget) + '</b></td><td class="n"><b>' + baht2(r.total) + '</b></td><td class="n"><b>' + baht2(r.courier60) + '</b></td><td class="n"><b>' + baht2(r.pool40) + '</b></td><td></td></tr></tbody></table>' +
      '<table class="pr-tbl" style="width:60%;margin-top:10px"><tbody><tr><td>กองกลาง ๔๐%</td><td class="n">' + baht2(r.pool40) + '</td></tr><tr><td>เศษยกมาจากรอบก่อน</td><td class="n">' + baht2(r.carry_in) + '</td></tr>' +
      '<tr><td><b>รวมกองกลาง</b></td><td class="n"><b>' + baht2(r.pool_total) + '</b></td></tr><tr><td>จำนวนเจ้าหน้าที่นั่งงาน</td><td class="n">' + num(r.seats) + ' คน</td></tr>' +
      '<tr><td><b>ได้คนละ</b></td><td class="n"><b>' + baht2(r.per_seat) + '</b></td></tr>' + (r.extra_one ? '<tr><td>เศษให้ 1 คน</td><td class="n">' + baht2(r.extra_one) + '</td></tr>' : '') +
      '<tr><td>เศษยกไปรอบหน้า</td><td class="n">' + baht2(r.carry_out) + '</td></tr></tbody></table>' +
      '<div class="pr-note"><b>หมายเหตุ</b> ๑. วิธีปัดเศษ: ' + esc(r.policy_th) + ' ๒. หมายฟรีคิดตามระเบียบ ก.บ.ศ. พ.ศ. ๒๕๖๒ ข้อ ๗ (หมายที่รวมเป็น ๑ หมายเบิกครั้งเดียว) ' +
      '๓. รายการที่ยังไม่เสนอเบิกจ่าย ' + num(r.n_excluded) + ' รายการ ยกไปรอบหน้า ' + adjPrint(d.items) + '๔. บัญชีแบ่งยอด ๖๐ : ๔๐ เป็นบัญชีคำนวณภายใน แยกจากเอกสารเบิกจ่ายทางราชการ</div>' +
      '<div class="pr-sign"><div>ลงชื่อ ......................................................... ผู้จัดทำ<br>(' + esc(S.user ? S.user.name : '') + ')<br>ตำแหน่ง .........................................................</div>' +
      '<div>ลงชื่อ ......................................................... ผู้ตรวจสอบ<br>(.........................................................)<br>ตำแหน่ง .........................................................</div></div>';
    try { await Promise.race([document.fonts.load('16pt Sarabun'), new Promise((res) => setTimeout(res, 1500))]); } catch (e) { /* ฟอนต์สำรอง */ }
    const img = pa.querySelector('img');
    if (img && !img.complete) await new Promise((res) => { img.onload = img.onerror = res; setTimeout(res, 1500); });
    window.print();
  }

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

  // ข้อความที่เติมทีหลัง (ผลค้น รายการรอยืนยัน หน่วยเบิก ตัวเลขวิ่ง) ก็จัดตัดบรรทัดด้วย
  document.addEventListener('DOMContentLoaded', () => {
    if (!('MutationObserver' in window)) return;
    let q = new Set(), t = 0;
    new MutationObserver((ms) => {
      ms.forEach((m) => m.addedNodes.forEach((n) => { q.add(n.nodeType === 3 ? n.parentNode : n); }));
      if (!t) t = requestAnimationFrame(() => { t = 0; const xs = q; q = new Set(); xs.forEach((n) => { if (n && n.isConnected) glueThai(n); }); });
    }).observe(document.body, { childList: true, subtree: true });
  });
  document.addEventListener('DOMContentLoaded', initLogin);
  // เร่งความเร็ว (1): ปลุกเซิร์ฟเวอร์ Apps Script ตั้งแต่หน้าเข้าระบบ ระหว่างผู้ใช้พิมพ์ชื่อ/PIN
  document.addEventListener('DOMContentLoaded', () => { api('ping').catch(() => { /* ไม่เป็นไร */ }); });
  // เร่งความเร็ว (2): เก็บไฟล์หน้าเว็บไว้ในเครื่อง (ไม่เก็บข้อมูลคดี/การเงิน)
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* ใช้งานต่อได้ตามปกติ */ }); });
  }
})();
