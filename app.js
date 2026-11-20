/* ============================================================================
   ระบบค่าหมาย · app.js  (หน้าเว็บบน GitHub Pages — เรียก API Apps Script)
   ระยะ 1–2 : เข้าใช้งานด้วยบัญชีปริ้นฮับ · หน้าแรก · ค้นหาหมาย · นำเข้า 2 ขั้น
              · ประวัติการนำเข้า · ผู้ส่งหมายและอัตรา · ผู้ใช้และสิทธิ์
   ไม่เก็บ token ไว้ในเครื่อง — เปิด/รีเฟรชหน้าใหม่ต้องใส่ PIN ทุกครั้ง (เหมือนระบบวัสดุ)
   ========================================================================== */
(function () {
  'use strict';
  const C = window.NP_CONFIG || {};
  const UI_VERSION = '0.7.35';
  let navEpoch = 0;
  const requestKeys = new Map();
  const $ = (s, el) => (el || document).querySelector(s);
  const S = { token: '', user: null, page: 'home', pick: null, pin: '', busy: false, fy: '' };

  /* ---------------------------------------------------------------- ตัวช่วย */
  const partyText = (v) => /^R1-[A-F0-9]{64}(?:,R1-[A-F0-9]{64})*$/.test(String(v || '')) ? 'ไม่จัดเก็บชื่อคู่ความ' : v;
  const esc = (v) => String(v === null || v === undefined ? '' : partyText(v))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const num = (n) => Number(n || 0).toLocaleString('th-TH');
  /* ตารางจัดลำดับได้: หัวคอลัมน์ th[data-sort] มีปุ่มเล็ก ▲ (มาก→น้อย) ▼ (น้อย→มาก) · แถวรวม (tr.sum) อยู่ท้ายเสมอ */
  function sortable(tbl) {
    if (!tbl) return;
    tbl.querySelectorAll('thead th[data-sort]').forEach((th) => {
      if (th.querySelector('.srt')) return;
      const lab = th.textContent.trim();
      th.insertAdjacentHTML('beforeend', '<span class="srt"><button type="button" data-d="desc" aria-label="เรียง' + esc(lab) + ' จากมากไปน้อย" aria-pressed="false">▲</button>' +
        '<button type="button" data-d="asc" aria-label="เรียง' + esc(lab) + ' จากน้อยไปมาก" aria-pressed="false">▼</button></span>');
      th.querySelectorAll('.srt button').forEach((b) => b.addEventListener('click', () => {
        const col = String(th.cellIndex), d = b.dataset.d;
        tbl.dataset.sc = col; tbl.dataset.sd = d;
        resort(tbl);
      }));
    });
    resort(tbl);
  }
  function resort(tbl) {
    const tb = tbl && tbl.tBodies[0]; if (!tb) return;
    const rows = Array.from(tb.rows);
    rows.forEach((r, i) => { if (r.dataset.o === undefined) r.dataset.o = String(i); });
    const sum = rows.filter((r) => r.classList.contains('sum')), body = rows.filter((r) => !r.classList.contains('sum'));
    const col = tbl.dataset.sc, d = tbl.dataset.sd;
    const val = (r) => { const c = r.cells[+col]; if (!c) return 0; const v = c.dataset.v !== undefined ? c.dataset.v : c.textContent; return Number(String(v).replace(/[^0-9.\-]/g, '')) || 0; };
    body.sort(col === undefined ? (a, b) => a.dataset.o - b.dataset.o : (a, b) => (d === 'asc' ? 1 : -1) * (val(a) - val(b)) || a.dataset.o - b.dataset.o);
    body.concat(sum).forEach((r) => tb.appendChild(r));
    tbl.querySelectorAll('thead th[data-sort] .srt button').forEach((b) => {
      const on = String(b.closest('th').cellIndex) === col && b.dataset.d === d;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
  }
  const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  function thDate(iso, withTime) {
    const s = String(iso || ''); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if (!m) return s;
    return (+m[3]) + ' ' + TH_M[+m[2] - 1] + ' ' + (+m[1] + 543) + (withTime && m[4] ? ' ' + m[4] + ':' + m[5] + ' น.' : '');
  }
  const TH_ML = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const thLong = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? (+m[3]) + ' ' + TH_ML[+m[2] - 1] + ' ' + (+m[1] + 543) : ''; };
  let toastT;
  /* ---------- ลูกเล่น: ตัวเลขวิ่ง · สีสถานะ · กราฟเส้นเล็ก ---------- */
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** <b data-count> นับจาก 0 ถึงค่าจริงใน 0.6 วินาที (ค่าเงินมีทศนิยมได้ 2 ตำแหน่ง) */
  function countUp(root) {
    if (reduceMotion()) return;
    (root || document).querySelectorAll('[data-count]').forEach((el) => animCount(el, Number(el.dataset.count)));
  }
  /** นับเลขหนึ่งช่องจาก 0 → ค่าจริง (เรียกซ้ำระหว่างวิ่งได้ ไม่ซ้อน · จบที่ค่าจริงเสมอ) */
  function animCount(el, end, ms) {
    end = Number(end) || 0;
    const money = el.dataset.money === '1', suffix = el.dataset.suffix || '';
    if (!end) return;
    const fmt = (v) => (money ? v.toLocaleString('th-TH', { minimumFractionDigits: v === end && end % 1 ? 2 : 0, maximumFractionDigits: v === end ? 2 : 0 }) : Math.round(v).toLocaleString('th-TH')) + suffix;
    const id = (el._cnt || 0) + 1; el._cnt = id;
    const t0 = performance.now(), dur = ms || 600;
    const step = (t) => { if (el._cnt !== id) return; const p = Math.min(1, (t - t0) / dur); el.textContent = p < 1 ? fmt(end * (1 - Math.pow(1 - p, 3))) : (el.dataset.final || fmt(end)); if (p < 1) requestAnimationFrame(step); };
    el.textContent = fmt(0); requestAnimationFrame(step);
  }
  /** 0.7.19 เลื่อนเมาส์ผ่าน/กด: การ์ดตัวเลข และแถวผู้ส่งหมาย → ตัวเลขวิ่งจาก 0 · แถบสถานะค่อย ๆ เลื่อนจากขวาไปซ้าย */
  function replayFx(box) {
    if (!box || reduceMotion()) return;
    const now = Date.now(); if (box._fxAt && now - box._fxAt < 700) return; box._fxAt = now;
    // 0.7.26 เส้นกราฟค่อย ๆ ลากทีละจุด (svg.lnfx) · ตัวเลขที่มี data-dl เริ่มนับเมื่อเส้นถึงจุดนั้น
    box.querySelectorAll('svg.lnfx').forEach((sv) => { sv.classList.remove('anim'); void sv.getBoundingClientRect(); sv.classList.add('anim'); });
    box.querySelectorAll('[data-count],[data-rc]').forEach((el) => { const run = () => animCount(el, el.dataset.count !== undefined ? el.dataset.count : el.dataset.rc); const dl = Number(el.dataset.dl || 0); if (dl) { clearTimeout(el._dlT); el._dlT = setTimeout(run, dl); } else run(); });
    box.querySelectorAll('.stbar-in').forEach((b) => { b.classList.remove('sweep'); void b.offsetWidth; b.classList.add('sweep'); });
  }
  const FX_SEL = '.kpi, #offTbl tbody tr, .ost-box, #ostTbl tbody tr, #ostTbl tfoot tr';
  document.addEventListener('mouseover', (e) => { const t = e.target.closest && e.target.closest(FX_SEL); if (t && !(e.relatedTarget && t.contains(e.relatedTarget))) replayFx(t); });
  document.addEventListener('click', (e) => { const t = e.target.closest && e.target.closest(FX_SEL); if (t) replayFx(t); });
  /** สีสถานะเดียวกันทุกหน้าจอ: เทาอ่อน รอผล · เทา ยอดประมาณการก่อนการเบิก (0.7.25) · ฟ้า เบิกแล้วรอจ่าย · เขียว จ่ายแล้ว · แดง รอตรวจ */
  const ST = [
    { k: 'wait', th: 'ยังไม่มีข้อมูลผลส่ง', c: '#DAD7CE' }, { k: 'ready', th: 'ยอดประมาณการก่อนการเบิก', c: '#8F938C' },
    { k: 'claim', th: 'มีสถานะการเบิกเดิม', c: '#378ADD' }, { k: 'paid', th: 'บันทึกรอบเบิกแล้ว', c: '#639922' }, { k: 'check', th: 'รอตรวจสอบข้อมูล', c: '#E24B4A' }];
  const ST_BY = Object.fromEntries(ST.map((x) => [x.k, x]));
  function stBar(m) {
    const tot = ST.reduce((a, x) => a + (Number(m[x.k]) || 0), 0);
    if (!tot) return '<div class="stbar" title="ยังไม่มียอดเงิน"></div>';
    const tip = ST.filter((x) => m[x.k]).map((x) => x.th + ' ' + Number(m[x.k]).toLocaleString('th-TH') + ' ฿').join('\n');
    return '<div class="stbar" title="' + esc(tip) + '" role="img" aria-label="' + esc(tip.replace(/\n/g, ' · ')) + '"><span class="stbar-in">' +
      ST.filter((x) => m[x.k]).map((x) => '<i style="width:' + (m[x.k] / tot * 100).toFixed(2) + '%;background:' + x.c + '"></i>').join('') + '</span></div>';
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
      // Data tables must stay visible even when a mobile browser delays observer callbacks.
      if (el.querySelector('table')) {
        el.classList.remove('rv'); el.classList.add('data-panel'); el.style.transitionDelay = '';
        revealObs.unobserve(el); return;
      }
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

  /**
   * 0.6.5 กล่องยืนยันกลางจอ (แทน confirm/prompt ของเบราว์เซอร์ ซึ่งแสดงชื่อเว็บไซต์/บัญชีเจ้าของ และขึ้นด้านบนจอ)
   * askBox(ข้อความ) → true/false · askBox(ข้อความ, { input: 'คำแนะนำ' }) → ข้อความที่กรอก หรือ null
   */
  function askBox(msg, opt) {
    opt = opt || {};
    return new Promise((resolve) => {
      const last = document.activeElement;
      const ov = document.createElement('div'); ov.className = 'ask-ov';
      ov.innerHTML = '<div class="ask clay" role="dialog" aria-modal="true" aria-labelledby="askMsg"><p id="askMsg" class="ask-msg"></p>' +
        (opt.input !== undefined ? '<input class="inp ask-in" aria-label="ระบุเหตุผล">' : '') +
        '<div class="ask-btns"><button type="button" class="btn ask-no">ยกเลิก</button><button type="button" class="btn btn-g ask-ok">ตกลง</button></div></div>';
      ov.querySelector('.ask-msg').textContent = String(msg);
      document.body.appendChild(ov);
      const inp = ov.querySelector('.ask-in'), ok = ov.querySelector('.ask-ok');
      if (inp) { inp.placeholder = String(opt.input || ''); if (opt.value) inp.value = String(opt.value); }
      const done = (v) => { ov.remove(); document.removeEventListener('keydown', key, true); if (last && last.focus) last.focus(); resolve(v); };
      const yes = () => {
        if (!inp) return done(true);
        const v = inp.value.trim(); if (!v) { inp.focus(); inp.classList.add('ask-need'); return; }
        done(v);
      };
      const key = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); done(inp ? null : false); }
        else if (e.key === 'Enter' && (inp ? document.activeElement === inp : true)) { e.preventDefault(); yes(); }
        else if (e.key === 'Tab') {                                   // วนโฟกัสอยู่ในกล่อง
          const f = Array.from(ov.querySelectorAll('input,button')); const i = f.indexOf(document.activeElement);
          e.preventDefault(); f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
        }
      };
      document.addEventListener('keydown', key, true);
      ok.addEventListener('click', yes);
      ov.querySelector('.ask-no').addEventListener('click', () => done(inp ? null : false));
      ov.addEventListener('click', (e) => { if (e.target === ov) done(inp ? null : false); });
      (inp || ok).focus();
    });
  }
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 3800);
  }
  const PAY_TH = { PAID: 'เงินนอกงบประมาณ', BUDGET: 'เงินงบประมาณ' };
  const STATUS_TH = { ISSUED: 'จ่ายหมายแล้ว รอผล', DELIVERED: 'ส่งแล้ว', REVIEW: 'รอตรวจสอบ' };
  const CLS_TH = { NEW: 'ใหม่', SAME: 'เดิมตรงกัน', CHANGED: 'เปลี่ยนแปลง', HELD: 'รออนุมัติแก้', AMBIGUOUS: 'กำกวม', ERROR: 'ผิดพลาด', OUTSIDE: 'ก่อนปีงบเริ่มระบบ' };
  const FLAGS_RED = ['เงินไม่เท่ากับอัตราของตำบล'];
  /** หมายเหตุของหมาย — ข้อที่ต้องเห็นชัดแสดงอักษรสีแดง */
  const flagHtml = (f) => String(f || '').split(';').filter(Boolean)
    .map((x) => '<span class="tiny ' + (FLAGS_RED.indexOf(x) >= 0 ? 'flag-r' : 'flag-a') + '">' + esc(x) + '</span>').join('<br>');
  /** 0.7.16 คู่มือนำเข้าไฟล์ (ซ่อนไว้ กดเปิด/ปิด) — ข้อความอย่างเดียว ไม่แตะข้อมูล */
  const importGuideHtml = () => '<details class="clay panel im-guide" id="imGuide"><summary>📘 คู่มือนำเข้าไฟล์ <span class="small muted">· ไฟล์ใด คืออะไร เลือกช่วงวันที่ และลำดับการทำ (กดเพื่อเปิด/ปิด)</span></summary>' +
    '<div class="im-guide-body">' +
    '<h4>ลำดับการนำเข้า 1 → 4</h4><p class="small muted">ช่วงวันที่ซ้อนกับครั้งก่อนได้ · นำเข้าไฟล์เดิมซ้ำ ยอดไม่เพิ่ม · นำเข้าสลับลำดับก็ได้ ระบบจับคู่ให้ภายหลัง</p>' +
    '<ol class="im-steps">' +
    '<li><b>ไฟล์ 50 · บัญชีจ่ายหมาย พนักงานศาลนี้ส่ง (แบบรวม)</b><br>คืออะไร: หมายที่จ่ายให้ผู้ส่ง — สร้างรายการหมายในระบบ<br>ส่งออกจาก: ระบบงานหมาย › บัญชีหมาย › ประเภท 50<br>ช่วงวันที่: <b>ตั้งแต่วันที่นำเข้าครั้งก่อน ถึงวันนี้</b></li>' +
    '<li><b>ไฟล์ 42 · บัญชีผลการส่งคำคู่ความ ส่งโดยเจ้าพนักงาน</b><br>คืออะไร: ผลการส่งและวันที่ส่ง — หมายที่มีผลแล้วจึงพร้อมเบิก<br>ส่งออกจาก: ระบบงานหมาย › บัญชีหมาย › ประเภท 42<br>ช่วงวันที่: <b>ตั้งแต่วันที่นำเข้าครั้งก่อน ถึงวันนี้</b> (กรองตามวันที่รายงาน)</li>' +
    '<li><b>ไฟล์ 18 · บัญชีจ่ายหมาย พนักงานศาลนี้ส่ง หมายฟรี</b><br>คืออะไร: ราคาหมายฟรีที่ศาลคิดรายเรื่อง (รวมหมายตามข้อ 7 แล้ว · 300 / 150 / 0 ต่างกันไปตามหมาย) — ใช้เป็นยอดเบิกในรอบหมายฟรี<br>ส่งออกจาก: ระบบงานหมาย › บัญชีหมาย › ประเภท 18<br>ช่วงวันที่: <b>ไม่ต้องเลือก</b> (ข้อมูล ณ วันที่ส่งออก) · <b>ส่งออกและนำเข้าใหม่ทุกครั้งก่อนตั้งรอบหมายฟรี</b></li>' +
    '<li><b>ไฟล์ 30 · บัญชีการจ่ายเงินให้เจ้าพนักงานศาล (แบบหลายใบเสร็จ)</b><br>คืออะไร: หมายมีเงินที่จ่ายเงินจริง แยกตามวันที่จ่าย — ใช้ตั้งรอบหมายเงิน<br>ส่งออกจาก: ระบบงานหมาย › บัญชีเบิกจ่ายหมาย › ประเภท 30<br>ช่วงวันที่: <b>เฉพาะวันที่จ่ายของรอบนั้น</b> (เช่น วันศุกร์ที่จ่าย)</li>' +
    '</ol>' +
    '<h4>วิธีกด (ทุกไฟล์เหมือนกัน)</h4><ol class="im-steps">' +
    '<li>หัวข้อ <b>1 · เลือกชนิดไฟล์</b> → กดการ์ดของไฟล์นั้น</li>' +
    '<li>หัวข้อ <b>2 · เลือกไฟล์</b> → เลือกไฟล์ .xls ที่ส่งออกมา</li>' +
    '<li>กด <b>ตรวจสอบก่อนนำเข้า</b> → ดูจำนวน ใหม่ / เดิมตรงกัน / เปลี่ยนแปลง / รอตรวจ และยอดเงินให้ตรงกับท้ายรายงาน (ยังไม่บันทึก)</li>' +
    '<li>กด <b>ยืนยันนำเข้า</b> → ขึ้น "นำเข้าเรียบร้อย" ระบบตรวจจับคู่บัญชีจ่ายให้อัตโนมัติ</li>' +
    '<li>กด <b>นำเข้าไฟล์ถัดไป</b> → ทำไฟล์ลำดับต่อไป</li></ol>' +
    '<h4>ก่อนตั้งรอบแต่ละครั้ง</h4><div class="tbl-wrap"><table class="small"><thead><tr><th>รอบ</th><th>ต้องนำเข้า</th><th>ควรนำเข้าด้วย</th></tr></thead><tbody>' +
    '<tr><td><b>หมายเงิน</b> (ปกติวันศุกร์)</td><td>30 ของวันที่จ่าย</td><td>50 · 42 ช่วงล่าสุด (ให้บัญชีจ่ายผูกกับหมายครบ)</td></tr>' +
    '<tr><td><b>หมายฟรี</b> (เดือนละ 1–2 ครั้ง)</td><td>18 ชุดใหม่ · 42 ช่วงล่าสุด</td><td>50 ถ้ามีหมายจ่ายใหม่</td></tr></tbody></table></div>' +
    '<p class="small muted">ไม่นำเข้า 50/42 ก่อน: รอบหมายเงินยังตั้งได้ตามไฟล์ 30 แต่จะมี "รอยืนยันการจับคู่" จนกว่าจะนำเข้า · รอบหมายฟรี หมายที่ยังไม่มีผลการส่งจะยังไม่พร้อมเบิก (รอรอบหน้า)</p>' +
    '<div class="row" style="justify-content:flex-end"><button type="button" class="btn btn-sm" id="imGuideClose">ปิดคู่มือ ▲</button></div>' +
    '</div></details>';
  /** 0.7.14 บัญชีจ่ายที่แบ่ง 60:40 นอกระบบแล้ว (ไม่ตั้งรอบ ไม่นับรอจับคู่) */
  const outsideDatesHtml = (o, canUndo) => (o && o.dates && o.dates.length) ? '<div class="tiny muted" style="margin-top:6px">แบ่ง 60:40 นอกระบบแล้ว (ไม่ตั้งรอบ): ' +
    o.dates.map((x) => '<b>' + esc(thDate(x.pay_date)) + '</b> · ' + num(x.rows) + ' เรื่อง · ' + baht2(x.amount) + '&nbsp;฿ <span title="' + esc(x.by + ' ' + thDate(x.at, true)) + '">(' + esc(x.reason) + ')</span>' +
      (canUndo ? ' <button type="button" class="btn btn-xs" data-outundo="' + esc(x.pay_date) + '">ยกเลิก</button>' : '')).join(' · ') + '</div>' : '';
  /** 0.7.14 สถานะรอบ 2 ขั้น: ยืนยันรอบ (ล็อกยอดแบ่ง) กับ บันทึกจ่ายจริง (มีหลักฐานการเงิน) */
  const roundStatusHtml = (r) => {
    if (r.status !== 'CONFIRMED') return '<span class="pchip pcx">ยกเลิก</span>';
    return '<span class="pchip pok">ยืนยันรอบแล้ว</span><div class="tiny" style="margin-top:3px;white-space:nowrap">' +
      (r.payment_status === 'PAID' ? '<span style="color:var(--g-ink);font-weight:700">✓ จ่ายจริง ' + esc(thDate(r.payment_date)) + '</span>' : (r.from_form25 ? '<span class="flag-up">มีรายการจ่ายจริงตามแบบ 25 · ยังไม่บันทึกหลักฐานส่วนแบ่ง 60:40</span>' : '<span class="flag-up">ยังไม่บันทึกจ่าย</span>')) + '</div>';
  };
  /** 0.7.14 สรุปเหนือตารางรอบ: กี่รอบบันทึกจ่ายแล้ว กี่รอบยังไม่บันทึก พร้อมยอดรวมและส่วนเจ้าหน้าที่ส่งหมาย 60% */
  const roundPaySummaryHtml = (rounds) => {
    const ok = (rounds || []).filter((r) => r.status === 'CONFIRMED');
    if (!ok.length) return '';
    const paid = ok.filter((r) => r.payment_status === 'PAID'), wait = ok.filter((r) => r.payment_status !== 'PAID');
    const sum = (a) => a.reduce((s, r) => s + Math.round(Number(r.total || 0) * 100), 0) / 100;
    const six = (a) => a.reduce((s, r) => s + Math.round(Number(r.total || 0) * 60), 0) / 100;
    return '<div class="row" style="gap:8px;flex-wrap:wrap;margin:0 0 10px">' +
      '<span class="pchip pok">ยืนยันรอบแล้ว ' + num(ok.length) + ' รอบ · ' + baht2(sum(ok)) + ' ฿</span>' +
      '<span class="pchip pok">บันทึกจ่ายจริงแล้ว ' + num(paid.length) + ' รอบ · ' + baht2(sum(paid)) + ' ฿</span>' +
      (wait.length ? '<span class="pchip ph">ยังไม่บันทึกจ่าย ' + num(wait.length) + ' รอบ · ' + baht2(sum(wait)) + ' ฿ (ส่วนเจ้าหน้าที่ส่งหมาย 60% ' + baht2(six(wait)) + ' ฿)</span>' : '') +
      '</div>' + (wait.length ? '<p class="tiny muted" style="margin:-4px 2px 10px">“ยืนยันรอบแล้ว” = ล็อกยอดแบ่ง 60:40 แล้ว เบิกซ้ำไม่ได้ · “บันทึกจ่าย” = การเงินใส่หลักฐานจ่ายเงินจริง (เปิด “ดู / พิมพ์” › บันทึกหลักฐานจ่ายจริง)</p>' : '');
  };
  /** สัญลักษณ์ "เคยยอดไม่ตรง" — ยอดที่ยืนยันแล้วไม่แสดงสีแดง แต่คงเครื่องหมายไว้ถาวร */
  const okMark = (ok) => '<span class="tiny flag-ok" title="ยืนยันโดย ' + esc(ok.by) + ' ' + esc(thDate(ok.at, true)) + '">◆ เคยยอดไม่ตรง · ยืนยันแล้ว</span>';
  /** ราคาไม่เท่าอัตราตำบล → คิดตามอัตราตำบล: ▲ เกิน (ยอดคำนวณตามอัตรา · ยอดจ่ายตรวจจากบัญชี) · ▼ ต่ำกว่า (อักษรสีแดง) */
  const adjMark = (a, long) => !a ? '' : (a.dir === 'UP'
    ? '<span class="tiny flag-up" title="ราคาไฟล์ ' + num(a.src) + ' · คิดตามอัตราตำบล ' + num(a.rate) + '">▲ เกินอัตราตำบล ' + num(a.diff) + '&nbsp;฿' + (long ? ' (ไฟล์ ' + num(a.src) + ' · คิด ' + num(a.rate) + ') ยอดคำนวณตามอัตรา · ยอดจ่ายตรวจจากบัญชี' : '') + '</span>'
    : '<span class="tiny flag-r" title="ราคาไฟล์ ' + num(a.src) + ' · คิดตามอัตราตำบล ' + num(a.rate) + '">▼ ต่ำกว่าอัตราตำบล ' + num(a.diff) + '&nbsp;฿' + (long ? ' (ไฟล์ ' + num(a.src) + ' · คิด ' + num(a.rate) + ')' : '') + '</span>');
  const flagsOf = (r) => {
    const rest = String(r.flags || '').split(';').filter((x) => x && !(r.adj && x === FLAGS_RED[0])).join(';');
    return [adjMark(r.adj, true), flagHtml(rest)].filter(Boolean).join('<br>');
  };

  /* ---------------------------------------------------------------- API */
  const BUSY_RETRIES = 8, BUSY_WAIT_MS = Number(C.BUSY_WAIT_MS) || 15000;
  async function api(action, body) {
    if (!C.API_URL || /วางลิงก์/.test(C.API_URL)) throw Object.assign(new Error('ยังไม่ได้ตั้งค่า API_URL ใน config.js'), { code: 'CONFIG' });
    const epoch = navEpoch;
    const payload = Object.assign({}, body || {});
    const writing = ['import_commit','payout_confirm','payout_cancel','payout_noclaim','review_resolve','round_payment','round_payment_bulk','ledger_reconcile','ledger_outside','change_decide','change_decide_bulk','adjust_void','payout_draft','claim_confirm'].includes(action) || (action === 'ledger_import' && payload.commit);
    const retryKey = writing ? action + ':' + JSON.stringify(payload) : '';
    if (writing && !payload.request_id) { if (!requestKeys.has(retryKey)) requestKeys.set(retryKey, crypto.randomUUID()); payload.request_id = requestKeys.get(retryKey); }
    // 0.7.22: งานบันทึกใหญ่ (เช่น นำเข้า) ใช้เวลาได้ถึงหลายนาที — รอได้นานกว่า และถ้าเซิร์ฟเวอร์ยังทำคำขอเดิมอยู่ (BUSY)
    // ให้รอแล้วส่งคำขอเดิม (request_id เดิม) ซ้ำอัตโนมัติ เซิร์ฟเวอร์จะคืนผลเดิมโดยไม่บันทึกซ้ำ
    let j;
    for (let attempt = 0; ; attempt++) {
      let res; const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), writing ? 330000 : 90000);
      try {
        res = await fetch(C.API_URL, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(Object.assign({ action: action, token: S.token, client_version:UI_VERSION }, payload)) });
      } catch (e) { throw Object.assign(new Error('เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่ ระบบจะตรวจคำขอเดิมก่อนบันทึกซ้ำ'), { code: 'NETWORK' }); } finally { clearTimeout(timer); }
      try { j = await res.json(); } catch (e) { throw Object.assign(new Error('ระบบตอบกลับไม่ถูกต้อง'), { code: 'BAD_RESPONSE' }); }
      if (!(writing && !j.ok && j.code === 'BUSY' && attempt < BUSY_RETRIES)) break;
      toast('ระบบกำลังบันทึกงานก่อนหน้า รอผลอัตโนมัติ… (' + (attempt + 1) + '/' + BUSY_RETRIES + ')');
      await new Promise((ok) => setTimeout(ok, BUSY_WAIT_MS));
    }
    if (!j.ok) {
      const err = Object.assign(new Error(j.msg || 'เกิดข้อผิดพลาด'), { code: j.code, extra: j.extra });
      if (S.token && /SESSION_EXPIRED|SESSION_REVOKED|NO_ACCESS/.test(j.code)) { toast(err.message); backToLogin(); }
      throw err;
    }
    if (writing) requestKeys.delete(retryKey);
    if (epoch !== navEpoch && !['login','logout','ping','operation_resume'].includes(action)) throw Object.assign(new Error('เปลี่ยนหน้าแล้ว'), { code: 'VIEW_CHANGED' });
    return j.data;
  }

  /* ================================================================ เข้าสู่ระบบ */
  function initLogin() {
    $('#ver').textContent = 'หน้าเว็บรุ่น ' + UI_VERSION;
    // Keep the supplied court emblem and its accessible name in the HTML.
    // SEAL_URL remains available to report exports; branding uses the bundled asset.
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
      $('#whoName').innerHTML = String(S.pick.name || '').trim().split(/\s+/).map((w) => '<span class="nw">' + esc(w) + '</span>').join(' '); $('#whoDept').textContent = S.pick.dept || '';
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
    S.busy = true; pinMsg('กำลังตรวจสอบ…');
    try {
      const d = await api('login', { code: S.pick.code, pin: S.pin });
      S.token = d.token; S.user = d.user;
      pinMsg('เข้าสู่ระบบสำเร็จ', 'ok');
      setTimeout(enterApp, 250);
    } catch (e) {
      S.pin = ''; drawDots(); pinMsg(String(e.message || '').replace(/\s*(ที่|ใน|กับ)?(บัญชี)?ปริ้นฮับ/g, ''), 'err');
      const dots = $('#dots'); dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
    } finally { S.busy = false; }
  }
  function backToLogin() {
    if(window.NP_EXPORT)window.NP_EXPORT.clear();
    navEpoch++; closeQuickSearch(); ['qs','printArea'].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); });
    resetImport(); delete IM.meta; requestKeys.clear(); S.fy = ''; S.calcMode = 'ALL'; S.pin = ''; S.busy = false;
    S.token = ''; S.user = null; S.pick = null;
    $('#app').classList.add('hidden'); $('#login').classList.remove('hidden');
    $('#q').value = ''; $('#picks').innerHTML = ''; showStep(1);
  }

  /* ================================================================ โครงแอป */
  const has = (...r) => S.user && S.user.roles.some((x) => r.indexOf(x) >= 0);
  /** บัญชีดูสถิติรวม (ไอดีเดียวของเจ้าหน้าที่ส่งหมาย) — ดูยอดทุกคน ไม่เห็นชื่อผู้รับ/รายละเอียดคดี */
  /** 0.7.18 ข้อความแจ้งความเป็นส่วนตัว (ผู้ใช้กำหนด 17 พ.ย. 2569) */
  const PRIVACY_TH = 'ระบบไม่เก็บชื่อคู่ความ · ไม่รับคอลัมน์โจทก์/จำเลย';
  const viewerOnly = () => S.user && S.user.roles.length > 0 && S.user.roles.every((x) => x === 'VIEWER');
  /* 0.7.32: 7 กลุ่มงาน ใช้เส้นทางและสิทธิ์เดิม */
  function navGroup(p) { return p === 'ostats' ? 'home' : ['tracking','search','calc','overview','paid','budget'].includes(p) ? 'overview' : ['import','history','review','changes','claim25'].includes(p) ? 'import' : p === 'reports' ? 'compensation' : ['settings','officers','users','audit'].includes(p) ? 'settings' : p; }
  function pages() {
    return [
      {id:'home',th:'ภาพรวมและสถิติ',show:true},
      {id:'import',th:'นำเข้าและกระทบยอด',show:has('NOTICE','FINANCE','ADMIN')},
      {id:'overview',th:viewerOnly()?'ยอดรายผู้ส่ง':'ทะเบียนหมาย',show:true},
      {id:'finance',th:'การเงิน · ตรวจสอบก่อนเบิก',show:has('NOTICE','FINANCE','ADMIN')},
      {id:'payout',th:'รอบเบิก 60/40',show:true},
      {id:'compensation',th:'ค่าตอบแทนและรายงาน',show:true},
      {id:'settings',th:'ตั้งค่าและข้อมูลอ้างอิง',show:true}
    ];
  }
  function sectionTabs(p) {
    const g = navGroup(p); let links = [];
    if (g === 'home') links = [['home','ภาพรวมสถิติ'],['ostats','สถิติเจ้าหน้าที่ส่งหมาย']];
    if (g === 'import') links = [['import','ทะเบียน 50 / 42 / 18 · บัญชี 30'],['claim25','แบบ 25 · ตรวจยอดตามใบเบิก'],['review','รายการรอตรวจ'],['changes','รายการปรับปรุงรออนุมัติ'],['history','ประวัติการนำเข้า']];
    if (g === 'overview') links = (viewerOnly()?[]:[['overview','ทั้ง 2 ประเภท'],['paid','หมายมีเงิน'],['budget','หมายฟรี']]).concat([['calc','ยอดอ้างอิงรายผู้ส่ง']]);
    if (g === 'finance') links = [['finance','ตรวจเงินงบประมาณ · รายการผิดปกติ']];
    if (g === 'payout') links = [['payout','รอบเบิก 60/40']];
    if (g === 'compensation') links = [['compensation','ค่าตอบแทนตามรอบ'],['reports','รายงานรวม']];
    if (g === 'settings') links = [['settings','ข้อมูลอ้างอิง'],['officers','ผู้ส่งหมายและอัตรา']].concat(has('ADMIN') ? [['users','ผู้ใช้และสิทธิ์'],['audit','ประวัติการใช้งาน']] : []);
    if (!links.length) return null;
    const el = document.createElement('div'); el.className = 'row section-tabs';
    links.forEach(([id,label]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm' + (id === p ? ' btn-g' : ''); b.textContent = label; b.onclick = () => go(id); el.appendChild(b); }); return el;
  }
  function enterApp() {
    $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
    $('#meName').textContent = S.user.name; $('#meRoles').textContent = S.user.roles_th.join(' · ');
    $('#meAv').textContent = S.user.name.charAt(0);
    if($('#appVer'))$('#appVer').textContent='หน้าเว็บรุ่น '+UI_VERSION;
    $('#logout').onclick = async () => { try { await api('logout'); } catch (e) {} backToLogin(); };
    initNavMore(); drawNav(); go('home');
  }
  function drawNav() {
    $('#nav').innerHTML = (viewerOnly() ? '' : '<button type="button" class="qs-btn" id="qsOpen" aria-label="ค้นเลขคดีดูสถานะ"><span class="qs-long">ค้นเลขคดีดูสถานะ</span><span class="qs-short" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg> ค้นคดี</span> <kbd>Ctrl K</kbd></button>') + pages().filter((p) => p.sec || p.show).map((p) => p.sec
      ? '<div class="nav-sec">' + esc(p.sec) + '</div>'
      : '<button type="button" data-p="' + p.id + '"' + (p.soon ? ' disabled' : '') + (' class="' + (navGroup(S.page) === p.id ? 'on ' : '') + (!['home','import','overview'].includes(p.id) ? 'nav-secondary' : '') + '"' + (navGroup(S.page) === p.id ? ' aria-current="page"' : '')) + '>' +
        esc(p.th) + (p.soon ? '<span class="soon">' + esc(p.soon) + '</span>' : '') + '</button>').join('');
    $('#nav').querySelectorAll('button[data-p]:not([disabled])').forEach((b) => b.addEventListener('click', () => { S.payoutSub = 'list'; go(b.dataset.p); }));
    if ($('#qsOpen')) $('#qsOpen').addEventListener('click', openQuickSearch);
    navMoreSync(true);
  }
  /* มือถือ: เมนูเลื่อนซ้าย-ขวา · ปุ่ม "เมนู ›" เลื่อนไปเมนูถัดไป ถึงท้ายแล้วเป็น "‹ เมนู" กลับต้นแถว */
  function navMoreSync(toActive) {
    const n=$('#nav'),b=$('#navMore');if(!n||!b)return;
    const mobile=window.matchMedia('(max-width:860px)').matches;
    n.classList.remove('expanded');
    if(mobile&&toActive){const active=n.querySelector('[aria-current="page"]');if(active)n.scrollTo({left:Math.max(0,active.offsetLeft-8),behavior:reduceMotion()?'auto':'smooth'});}
    const overflow=n.scrollWidth>n.clientWidth+2,atEnd=n.scrollLeft+n.clientWidth>=n.scrollWidth-3;
    b.classList.toggle('hide',!mobile||!overflow);n.classList.toggle('fade',mobile&&overflow&&!atEnd);
    b.textContent=atEnd?'‹ เมนูแรก':'เมนูถัดไป ›';b.setAttribute('aria-label',atEnd?'เลื่อนกลับเมนูแรก':'เลื่อนดูเมนูถัดไป');b.removeAttribute('aria-expanded');
  }
  function initNavMore(){const b=$('#navMore'),n=$('#nav');if(!b||b.dataset.on)return;b.dataset.on='1';b.onclick=()=>{const end=n.scrollLeft+n.clientWidth>=n.scrollWidth-3;n.scrollTo({left:end?0:n.scrollLeft+Math.max(120,n.clientWidth*.8),behavior:reduceMotion()?'auto':'smooth'});};n.addEventListener('scroll',()=>navMoreSync(false),{passive:true});window.addEventListener('resize',()=>navMoreSync(false));}
  const RENDER = {};
  function go(p) {
    if (p === 'search') p = 'tracking';
    if (!RENDER[p]) return;
    const ticket = ++navEpoch; S.page = p; drawNav();
    const main = $('#main'); main.innerHTML = '';
    const tabs = sectionTabs(p); if (tabs) main.appendChild(tabs);
    const m = document.createElement('div'); m.className = 'page-body'; main.appendChild(m);
    m.innerHTML = '<div class="clay panel"><span class="spin"></span> <span class="muted">กำลังโหลด…</span></div>';
    Promise.resolve().then(() => RENDER[p](m)).then(() => { if (ticket === navEpoch) { glueThai(m); reveal(m); } }).catch((e) => {
      if (ticket !== navEpoch || e.code === 'VIEW_CHANGED') return;
      m.innerHTML = '<div class="clay panel"><p class="note r">' + esc(e.message) + '</p>' + (e.code === 'RECOVERY_REQUIRED' ? '<button class="btn btn-g" id="recoverWork">ตรวจและกู้คืนงานบันทึก</button>' : '') + '</div>';
      if ($('#recoverWork')) $('#recoverWork').onclick = recoverWork;
    });
    main.focus({preventScroll:true}); window.scrollTo(0,0);
  }
  async function recoverWork() {
    try { const d = await api('operation_status'); if (!d.pending) { go('home'); return; } if (!d.pending.can_resume) return toast('กรุณาให้เจ้าของรายการหรือผู้ดูแลกู้คืนงานนี้');
      if (!(await askBox('ตรวจและกู้คืนงานบันทึกค้างวันที่ ' + thDate(d.pending.at,true) + ' โดยไม่สร้างรายการซ้ำ?'))) return;
      await api('operation_resume',{request_id:d.pending.request_id}); toast('กู้คืนงานเรียบร้อย'); go('home');
    } catch(e) { toast(e.message); }
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
    const rows = d.officers.map((o, i) => '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(o.full_name || o.name) + '</td><td class="n">' + num(o.paid_n) + '</td><td class="n">' + b(o.paid_amount) +
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
      '<div>ลงชื่อ ......................................................... ผู้ตรวจสอบ<br>(.........................................................)<br>ตำแหน่ง .........................................................</div></div>' + '<p class="pr-privacy">' + PRIVACY_TH + '</p>';
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
  function fileDateShort(iso) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(iso||'')))return '';
    const [y,mo,d]=iso.split('-').map(Number),months=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    return d+' '+months[mo-1]+' '+String((y+543)%100).padStart(2,'0');
  }
  function coverageHtml(period) {
    if(!period||!period.to)return '<small class="data-coverage muted">ยังไม่ระบุวันสิ้นสุดข้อมูลในไฟล์</small>';
    return '<small class="data-coverage">ข้อมูล '+esc(fileDateShort(period.from))+' ถึง <strong>'+esc(fileDateShort(period.to))+'</strong></small>'+
      (period.result_to&&period.result_to!==period.to?'<small class="data-coverage muted">ผลส่งถึง '+esc(fileDateShort(period.result_to))+'</small>':'');
  }
  RENDER.home = async (m) => {
    const d = await api('dashboard', { fy: S.fy });
    S.fy = d.fy;
    const t = d.totals;
    const fySel = '<label class="small muted" for="fy">ปีงบประมาณ</label> <select id="fy" class="sel">' +
      d.fys.map((y) => '<option' + (y === d.fy ? ' selected' : '') + '>' + esc(y) + '</option>').join('') + '</select>';
    const kpi = (lbl, v, cls) => '<div class="kpi clay ' + (cls || '') + '"><span>' + esc(lbl) + '</span><b data-count="' + Number(v || 0) + '">' + num(v) + '</b></div>';
    const notes = [];
    if (d.pending_review) notes.push('<div class="note">มีแถวรอตรวจสอบจากการนำเข้า ' + num(d.pending_review) + ' แถว' + (has('NOTICE', 'FINANCE', 'ADMIN') ? ' <button type="button" class="btn btn-xs" data-go="review">ไปที่แถวรอตรวจ</button>' : '') + '</div>');
    if (d.pending_changes) notes.push('<div class="note">มีรายการแก้ไขหมายที่ล็อกแล้ว รออนุมัติ ' + num(d.pending_changes) + ' รายการ' + (has('NOTICE', 'FINANCE', 'ADMIN') ? ' <button type="button" class="btn btn-xs" data-go="changes">ไปที่รายการปรับปรุง</button>' : '') + '</div>');
    if (t.no_area) notes.push('<div class="note">หมาย ' + num(t.no_area) + ' ฉบับ ไม่พบตำบลในตารางอัตรา — ตรวจชื่อตำบล/อำเภอในไฟล์ต้นทาง</div>');
    if (t.adj_up || t.adj_dn) notes.push('<div class="note">หมายมีเงิน ' + num((t.adj_up || 0) + (t.adj_dn || 0)) + ' ฉบับ ราคาไม่เท่าอัตราตำบล — คิดตามอัตราตำบลแล้ว' + (t.adj_up ? ' · <span class="flag-up">▲ เกิน ' + num(t.adj_up) + '</span>' : '') + (t.adj_dn ? ' · <span class="flag-r">▼ ต่ำกว่า ' + num(t.adj_dn) + '</span>' : '') + ' (ดูที่หน้า "ยอดอ้างอิงรายผู้ส่ง")</div>');
    if (t.date_wait) notes.push('<div class="note r">หมาย ' + num(t.date_wait) + ' ฉบับ อาจจ่ายเดือน ก.ย. รอยืนยันวันที่จ่าย — ดูที่หน้า "ยอดอ้างอิงรายผู้ส่ง"</div>');
    if (t.no_addr) notes.push('<div class="note">หมายฟรี ' + num(t.no_addr) + ' ฉบับ ไม่มีที่อยู่ นับเต็มอัตราแยกฉบับ — ควรตรวจกับต้นฉบับ</div>');
    const tot = t.total || 0, money = t.money || {};
    const mTot = ST.reduce((a2, x) => a2 + (Number(money[x.k]) || 0), 0);
    const IC = { all: '<path d="M4 6h16M4 12h16M4 18h10"/>', paid: '<rect x="3" y="6" width="18" height="12" rx="3"/><circle cx="12" cy="12" r="2.5"/>',
      free: '<path d="M4 20V10l8-6 8 6v10"/><path d="M9 20v-6h6v6"/>', wait: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', done: '<path d="M4 12l5 5L20 6"/>' };
    const tile = (area, cls, ic, lbl, v, sub, extra) => '<div class="kpi clay kt ' + cls + '" style="grid-area:' + area + '"><span class="kt-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + IC[ic] + '</svg></span>' +
      '<span>' + esc(lbl) + '</span><b data-count="' + Number(v || 0) + '">' + num(v) + '</b><small>' + sub + '</small>'+(extra||'')+'</div>';
    const share = (v) => tot ? 'ฉบับ · ' + pctOf(v, tot) + ' ของทั้งหมด' : 'ฉบับ';
    let view = 'bar'; try { view = localStorage.getItem('np_money_view') === 'tiles' ? 'tiles' : 'bar'; } catch (e) { /* ใช้ค่าเริ่มต้น */ }
    const canImport = has('NOTICE', 'FINANCE', 'ADMIN');
    const shortcut = '<div class="clay panel kt-nt home-import" style="grid-area:nt"><h3>' + (canImport ? 'นำเข้าไฟล์' : 'ข้อมูลล่าสุด') + '</h3>' +
      (canImport ? '<p class="small muted">เลือกไฟล์ต้นทาง ตรวจรายการ แล้วบันทึกเข้าทะเบียน ระบบแยกเงินนอกงบประมาณและเงินงบประมาณให้ตามประเภทหมาย</p><div class="row" style="gap:8px;margin-bottom:10px"><button type="button" class="btn btn-g btn-sm" data-go="import">เลือกไฟล์นำเข้า</button><button type="button" class="btn btn-sm" data-go="history">ดูประวัติการนำเข้า</button></div>' : '') +
      '<p class="tiny muted" style="margin:0">ไฟล์จ่ายหมาย ' + esc(thDate(d.last_issue_import, true) || '—') + '<br>ไฟล์ผลหมาย ' + esc(thDate(d.last_result_import, true) || '—') + '</p></div>';
    m.innerHTML = top('สถิติ', fySel) +
      '<section class="clay panel workflow-intro"><span class="eyebrow">ทะเบียนเดียว · แยกแหล่งเงินชัดเจน</span><h3><span>ติดตามค่าส่งคำคู่ความ</span> <span>ตั้งแต่รับข้อมูลถึงสรุปค่าตอบแทน</span></h3><p>ดูจำนวนหมายและสถานะล่าสุด แล้วเลือกเมนูตามงานที่ต้องการทำ</p><div class="workflow-steps"><span>1 · ตรวจทะเบียน</span><span>2 · ตรวจสอบก่อนเบิก</span><span>3 · จัดรอบ 60/40</span><span>4 · สรุปค่าตอบแทน</span></div></section>'+
      '<div class="bento"><div class="bn">' +
      '<section class="clay panel hero rv-b" style="grid-area:hero" data-onview="bars" aria-labelledby="heroH">' +
        '<div class="hero-h"><h3 id="heroH">สรุปยอดเงินในทะเบียนหมาย</h3><button type="button" class="btn btn-sm" id="mvBtn" aria-pressed="' + (view === 'tiles') + '">' + (view === 'tiles' ? 'แถบสถานะ' : 'กราฟแยกสถานะ') + '</button></div>' +
        '<div class="hero-t"><b data-count="' + mTot + '" data-money="1" data-suffix="&nbsp;฿">' + baht(mTot) + '&nbsp;฿</b><span>ยอดรวมตามข้อมูลในระบบ ก่อนแบ่ง 60/40</span></div>' +
        '<div id="mvBox">' + (view === 'tiles' ? moneyTilesHtml(money) : moneyBarHtml(money)) + '</div>' +
        '<p class="tiny muted" style="margin:10px 2px 0">แตะสถานะเพื่อดูยอดรายผู้ส่ง · <strong class="flag-a">ยืนยันรอบแล้ว กับจ่ายเงินจริงแล้ว เป็นคนละสถานะ</strong></p><p class="tiny muted" style="margin:6px 2px 0">ยอดทะเบียนอาจรวมยอดอ้างอิง ตรวจยอดที่ใช้แบ่งเงินได้ที่ “รอบเบิก 60/40”</p></section>' +
      tile('k1', 'k-all', 'all', 'หมายทั้งหมด', t.total, 'ฉบับ · ปีงบ ' + esc(d.fy), coverageHtml(d.data_period)) +
      tile('k2', 'k-paid', 'paid', 'หมายเงินนอกงบประมาณ', t.paid, share(t.paid)) +
      tile('k3', 'k-free', 'free', 'หมายเงินงบประมาณ', t.free, share(t.free)) +
      tile('k4', 'k-wait', 'wait', 'ยังไม่มีข้อมูลผลส่ง', t.issued, share(t.issued)) +
      tile('k5', 'k-done', 'done', 'มีข้อมูลผลส่งแล้ว', t.delivered, share(t.delivered)) +
      shortcut +
      '<div style="grid-area:al;display:flex;flex-direction:column;gap:10px">' + (notes.length ? notes.join('') : '<div class="note g">ไม่มีรายการค้างตรวจ</div>') + '</div>' +
      '<div class="clay panel" style="grid-area:off;min-width:0"><div class="row" style="justify-content:space-between;align-items:center;margin:0 0 6px"><h3 style="margin:0">' + (d.scope_officer ? 'หมายของฉัน' : 'แยกรายผู้ส่งหมาย') + '</h3><span id="dnFilter"></span></div><div class="tbl-wrap"><table id="offTbl"><thead><tr><th class="onm">ผู้ส่งหมาย</th>' +
      '<th class="n">นอกงบฯ (ฉบับ)</th><th class="n">งบประมาณ (ฉบับ)</th><th class="n">รวม (ฉบับ)</th><th>ส่งแล้ว 6 สัปดาห์</th><th class="n" data-sort>ยอดตามสถานะ (บาท)</th></tr></thead><tbody>' +
      offRows(d.officers, null) + '</tbody></table></div>' +
      '<div class="stlegend">' + ST.map((x) => '<span><i style="background:' + x.c + '"></i>' + esc(x.th) + '</span>').join('') +
      '<span class="muted">· กราฟเส้น = จำนวนหมายที่ส่งแล้วรายสัปดาห์</span></div></div>' +
      '</div></div><div id="fcBox" aria-live="polite"></div>';
    $('#fy').addEventListener('change', (e) => { S.fy = e.target.value; go('home'); });
    loadFreeClaim($('#fcBox'), d.fy);
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
      resort($('#offTbl'));
      $('#dnFilter').innerHTML = x ? '<button type="button" class="stchip" style="--c:' + x.c + ';cursor:pointer" id="dnClr">กรอง: ' + esc(x.th) + ' ✕</button>' : '';
      if ($('#dnClr')) $('#dnClr').addEventListener('click', () => apply(sel));
    };
    const bind = () => m.querySelectorAll('#mvBox [data-k]').forEach((b2) => b2.addEventListener('click', () => apply(b2.dataset.k)));
    bind();
    sortable($('#offTbl'));
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
  /** 0.7.13 ผลตรวจรายการรอยืนยันการจับคู่อัตโนมัติหลังนำเข้า */
  function ledgerCheckHtml(c) {
    if (!c) return '';
    if (c.auto === false) return '<p class="note" style="margin:0 0 12px">ปิดการตรวจจับคู่อัตโนมัติไว้ (CONFIG LEDGER_AUTO_RECONCILE) — กดตรวจเองที่ การเงิน · ตรวจสอบก่อนเบิก</p>';
    if (c.error) return '<p class="note r" style="margin:0 0 12px">ตรวจรายการรอยืนยันการจับคู่อัตโนมัติไม่สำเร็จ: ' + esc(c.error) + ' — กดตรวจเองที่ การเงิน · ตรวจสอบก่อนเบิก</p>';
    return '<p class="note g" style="margin:0 0 12px">ตรวจรายการรอยืนยันการจับคู่บัญชีจ่ายให้อัตโนมัติแล้ว · เชื่อมเพิ่ม ' + num(c.newly_matched || 0) + ' รายการ' +
      (c.unlinked ? ' · ถอดการเชื่อมที่หลักฐานขัดกัน ' + num(c.unlinked) + ' รายการ' : '') + ' · เหลือรอยืนยัน ' + num(c.pending || 0) + ' รายการ · ยอดเงินและรอบเดิมไม่เปลี่ยน</p>';
  }
  /** 0.7.13 หมายเงินงบประมาณ: เบิกจ่ายจริง / ยังไม่เบิก (เต็มอัตรา) รายผู้ส่ง — ทุกบทบาทเห็น ผู้ส่งเห็นเฉพาะตนเอง */
  async function loadFreeClaim(box, fy) {
    if (!box) return;
    box.innerHTML = '<div class="clay panel"><p class="muted small">กำลังโหลดสรุปหมายเงินงบประมาณ…</p></div>';
    try { box.innerHTML = freeClaimHtml(await api('free_claim', { fy: fy })); }
    catch (e) { box.innerHTML = '<div class="clay panel"><p class="flag-r small">โหลดสรุปหมายเงินงบประมาณไม่ได้: ' + esc(e.message) + '</p></div>'; }
  }
  function freeClaimHtml(d) {
    const row = (o, total) => '<tr' + (total ? ' class="tot"' : '') + '><td>' + (total ? '<b>รวม</b>' : '<span class="onm">' + esc(o.name) + '</span>') +
      '<br><span class="tiny muted">ส่งแล้ว ' + num(o.delivered_n) + ' · รอผล ' + num(o.wait_n) + ' ฉบับ</span></td>' +
      '<td class="n" data-v="' + o.claimed_amount + '"><b style="color:#2f7a4f">' + baht2(o.claimed_amount) + '</b><br><span class="tiny muted">' + num(o.claimed_n) + ' ฉบับ</span></td>' +
      '<td class="n" data-v="' + o.unclaimed_full + '"><b class="flag-a">' + baht2(o.unclaimed_full) + '</b><br><span class="tiny muted">' + num(o.unclaimed_n) + ' ฉบับ</span></td></tr>';
    const t = d.totals || {}, list = d.officers || [];
    return '<section class="clay panel fc-panel" aria-labelledby="fcH"><h3 id="fcH">หมายเงินงบประมาณ · ตามรอบยืนยัน และยังไม่เบิก</h3>' +
      '<p class="small muted" style="margin:0 0 8px">ปีงบประมาณ ' + esc(d.fy) + (d.scope_officer ? ' · เฉพาะหมายของฉัน' : ' · แยกรายผู้ส่ง') + '</p>' +
      '<div class="tbl-wrap"><table class="fc-tbl"><thead><tr><th>ผู้ส่ง</th>' +
      '<th class="n">เบิกตามรอบยืนยัน<br><span class="tiny muted">บาท</span></th><th class="n">ยังไม่เบิก*<br><span class="tiny muted">บาท · เต็มอัตรา</span></th></tr></thead><tbody>' +
      (list.length ? list.map((o) => row(o)).join('') : '<tr><td colspan="3" class="muted small">ยังไม่มีหมายเงินงบประมาณในปีงบนี้</td></tr>') +
      '</tbody>' + (list.length > 1 ? '<tfoot>' + row(t, true) + '</tfoot>' : '') + '</table></div>' +
      '<div class="note fc-note small" role="note"><b>หมายเหตุ</b><ul style="margin:6px 0 0;padding-left:18px">' +
      '<li><b>* ยังไม่เบิก</b> คิดเต็มอัตราต่อฉบับตามวันที่ส่ง (อ.เมืองลพบุรี 300 บาท อำเภออื่นตามอัตราตำบล) เป็นยอดสูงสุดที่อาจเบิกได้ เมื่อเบิกจริงอาจได้กึ่งหนึ่ง (เช่น 150 บาท) หรือนับรวมเป็นหมายเดียว ตามระเบียบ ก.บ.ศ. ว่าด้วยค่าตอบแทนในการส่งคำคู่ความหรือเอกสารโดยเจ้าพนักงานศาล พ.ศ. 2562 ข้อ 7 (ส่งหลายคดีในหมู่บ้านเดียวกันคราวเดียวกัน) หรือเบิกไม่ได้หากพ้นปีงบประมาณ (30 ก.ย.)</li>' +
      '<li><b>เบิกตามรอบยืนยัน</b> ไม่ใช่หลักฐานจ่ายจริง · คือยอดในรอบเบิกที่ยืนยันแล้ว · หมายรอผลส่งยังไม่คิดเงิน · ไม่นับหมายก่อนเริ่มปีงบและหมายที่ปิดไม่เบิก' + (t.closed_n ? ' (' + num(t.closed_n) + ' ฉบับ)' : '') + '</li>' +
      '<li>ต.ท่าหิน ต.ท่าศาลา และ ต.ทะเลชุบศร มีหมู่บ้าน — หมายที่ที่อยู่ไม่ระบุหมู่' + (t.no_moo_n ? ' <b>' + num(t.no_moo_n) + ' ฉบับ</b>' : '') + ' ควรตรวจหมู่ก่อนเสนอเบิก</li>' +
      '<li>ยอดเสนอเบิกตามข้อ 7 (หักกึ่งหนึ่ง/รวมหน่วยแล้ว) ดูที่ การเงิน · ตรวจสอบก่อนเบิก</li></ul></div></section>';
  }
  /** แถวตารางผู้ส่งหมาย (กรองตามสถานะยอดเงินได้) */
  function offRows(list, sel) {
    let L = list.slice();
    if (sel) L = L.filter((o) => (o.money || {})[sel] > 0).sort((a, b) => b.money[sel] - a.money[sel]);
    if (!L.length) return '<tr><td colspan="6" class="muted small">ยังไม่มีผู้ส่งที่มียอดในสถานะนี้</td></tr>';
    const lbl = sel ? ST_BY[sel].th : 'ยอดประมาณการก่อนการเบิก', key = sel || 'ready';
    return L.map((o) => '<tr><td class="onm"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + esc(o.color) + ';margin-right:8px"></span>' + esc(o.name) + '</td>' +
      '<td class="n"><span data-rc="' + (o.paid_issued + o.paid_delivered) + '">' + num(o.paid_issued+o.paid_delivered) + '</span></td><td class="n"><span data-rc="' + (o.free_issued + o.free_delivered) + '">' + num(o.free_issued+o.free_delivered) +
      '</span></td><td class="n"><b data-rc="' + (o.paid_issued + o.paid_delivered + o.free_issued + o.free_delivered) + '">' + num(o.paid_issued + o.paid_delivered + o.free_issued + o.free_delivered) + '</b></td>' +
      '<td>' + spark(o.weeks) + '</td><td data-v="' + Number((o.money || {})[key] || 0) + '">' + stBar(o.money || {}) + '<span class="tiny muted">' + esc(lbl) + ' <span data-rc="' + Number((o.money || {})[key] || 0) + '" data-money="1">' + baht((o.money || {})[key]) + '</span> ฿</span></td></tr>').join('');
  }

  /* ---------------------------------------------------------------- ค้นหาหมาย */
  /* ---------- 0.7.26 สถิติเจ้าหน้าที่ส่งหมาย: เลือกหมายฟรี/หมายมีเงิน · ช่วงวันที่ · จำนวน ยอดเงิน · เรียงสูง↔ต่ำ · 6 เดือนย้อนหลัง ---------- */
  const OST_KEY = 'np_ostats_v2';
  const ostToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const ostFyStart = (iso) => { const y = Number(iso.slice(0, 4)), mo = Number(iso.slice(5, 7)); return (mo >= 10 ? y : y - 1) + '-10-01'; };
  const ostMonthTh = (k) => { const MO = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']; return MO[Number(k.slice(5, 7)) - 1] + ' ' + String((Number(k.slice(0, 4)) + 543) % 100).padStart(2, '0'); };
  const ostShift = (iso, months) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months); return d.toISOString().slice(0, 10); };
  /** เส้นกราฟเล็กแบบเดิม (สีเขียว จุดท้าย) 6 เดือน */
  function spark6(vals, months, unit) {
    const a = vals.map(Number), mx = Math.max(1, ...a);
    const pts = a.map((v, i) => (2 + i * 13) + ',' + (19 - v / mx * 16).toFixed(1)).join(' ');
    const lab = months.map((k, i) => ostMonthTh(k) + ' ' + (unit === 'บาท' ? baht(a[i]) : num(a[i]))).join(', ');
    return '<svg class="spark lnfx" style="--d:.12s" viewBox="0 0 70 22" width="70" height="22" role="img" aria-label="6 เดือนย้อนหลัง (' + unit + '): ' + esc(lab) + '"><title>' + esc(lab) + '</title>' +
      lnSegs(a.map((v, i) => [2 + i * 13, 19 - v / mx * 16]), 1.8) +
      (a.length ? '<circle class="pt" style="--i:' + (a.length - 1) + '" cx="' + (2 + (a.length - 1) * 13) + '" cy="' + (19 - a[a.length - 1] / mx * 16).toFixed(1) + '" r="2.4" fill="#2E6B4F"/>' : '') + '</svg>';
  }
  /** เส้นกราฟแบ่งเป็นช่วงจุดต่อจุด (ลากทีละช่วงเมื่อเล่นภาพเคลื่อนไหว · ภาพนิ่ง/พิมพ์เห็นเส้นเต็ม) */
  function lnSegs(xy, w, color) {
    return xy.slice(1).map((p, i) => '<path class="seg" pathLength="1" style="--i:' + i + '" d="M' + xy[i][0].toFixed(1) + ' ' + xy[i][1].toFixed(1) + 'L' + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + '" fill="none" stroke="' + (color || '#2E6B4F') + '" stroke-width="' + w + '" stroke-linecap="round"/>').join('');
  }
  /** กราฟเส้น 6 เดือนย้อนหลัง พร้อมตัวเลขทุกจุด */
  const ostColor = type => type==='PAID'?'#98701F':type==='ALL'?'#326A97':'#2E6B4F';
  function ostChart(d, metric) {
    const color=ostColor(d.pay_type);
    const vals = d.totals.months.map((x) => metric === 'n' ? x.n : x.amount), mx = Math.max(1, ...vals);
    const W = 640, H = 236, L = 56, R = 56, Tp = 40, B = 52, step = (W - L - R) / Math.max(1, vals.length - 1);
    const xy = vals.map((v, i) => [L + i * step, Tp + (1 - v / mx) * (H - Tp - B)]);
    const fmt = (v) => metric === 'n' ? num(v) : baht(v);
    const grid = [0, 0.5, 1].map((f) => '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + (Tp + f * (H - Tp - B)).toFixed(1) + '" y2="' + (Tp + f * (H - Tp - B)).toFixed(1) + '" stroke="#DCE6DE" stroke-dasharray="3 4"/>').join('');
    const area = 'M' + xy.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L') + ' L' + xy[xy.length - 1][0].toFixed(1) + ',' + (H - B) + ' L' + L + ',' + (H - B) + 'Z';
    return '<svg class="ost-chart lnfx" style="--d:.28s" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc('6 เดือนย้อนหลัง ' + d.months.map((k, i) => ostMonthTh(k) + ' ' + fmt(vals[i])).join(', ')) + '">' + grid +
      '<path class="ar" d="' + area + '" fill="' + color + '" opacity=".13"/>' + lnSegs(xy, 3.5, color) +
      xy.map((p, i) => '<circle class="pt" style="--i:' + i + '" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + (i === xy.length - 1 ? 5.5 : 4) + '" fill="' + (i === xy.length - 1 ? color : '#fff') + '" stroke="' + color + '" stroke-width="2.4"/>' +
        '<text x="' + p[0].toFixed(1) + '" y="' + (p[1] - 12).toFixed(1) + '" text-anchor="middle" class="ost-v pt" style="--i:' + i + '" data-rc="' + vals[i] + '" data-dl="' + (i * 280) + '"' + (metric === 'n' ? '' : ' data-money="1"') + ' data-final="' + esc(fmt(vals[i])) + '">' + esc(fmt(vals[i])) + '</text>' +
        '<text x="' + p[0].toFixed(1) + '" y="' + (H - B + 22) + '" text-anchor="middle" class="ost-m">' + esc(ostMonthTh(d.months[i])) + '</text>' +
        '<text x="' + p[0].toFixed(1) + '" y="' + (H - B + 40) + '" text-anchor="middle" class="ost-s">' + esc(metric === 'n' ? baht(d.totals.months[i].amount) + ' ฿' : num(d.totals.months[i].n) + ' ฉบับ') + '</text>').join('') + '</svg>';
  }
  /** 6 เดือนในบรรทัดเดียว: เส้นสีเขียวและตัวเลขแต่ละเดือนอยู่ตรงกัน (จุดอยู่เหนือตัวเลขของเดือนนั้น) */
  function sparkRow(vals, months, unit, opt) {
    opt = opt || {};
    const a = vals.map(Number), mx = Math.max(1, ...a), CW = opt.cw || 60, W = CW * a.length, H = opt.h || 46;
    const fmt = (v) => unit === 'บาท' ? baht(v) : num(v);
    const pts = a.map((v, i) => [CW * i + CW / 2, 5 + (1 - v / mx) * 16]);
    const lab = months.map((k, i) => ostMonthTh(k) + ' ' + fmt(a[i])).join(', ');
    return '<svg class="spark-row lnfx" style="--d:.12s" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="6 เดือนย้อนหลัง (' + unit + '): ' + esc(lab) + '"><title>' + esc(lab) + '</title>' +
      lnSegs(pts, 2) +
      pts.map((p, i) => '<circle class="pt" style="--i:' + i + '" cx="' + p[0] + '" cy="' + p[1].toFixed(1) + '" r="' + (i === pts.length - 1 ? 3.2 : 2.2) + '" fill="' + (i === pts.length - 1 ? '#2E6B4F' : '#fff') + '" stroke="#2E6B4F" stroke-width="1.6"/>' +
        '<text class="pt" style="--i:' + i + ';font-variant-numeric:tabular-nums" x="' + p[0] + '" y="' + (H - 6) + '" text-anchor="middle" font-size="' + (opt.fs || 12) + '" fill="#4b5d53">' + esc(fmt(a[i])) + '</text>').join('') + '</svg>';
  }
  async function ostSavePng(blob, name, msg) {
    const file = typeof File === 'function' ? new File([blob], name, { type: 'image/png' }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast(msg);
  }
  const ostTitle = (d) => 'สถิติเจ้าหน้าที่ส่งหมาย · ' + ({ BUDGET: 'หมายฟรี (เงินงบประมาณ)', PAID: 'หมายมีเงิน (นอกงบประมาณ)', ALL: 'รวม 2 ประเภท' }[d.pay_type] || '');
  const ostSub = (d) => 'ช่วงวันที่ ' + dLong(d.from) + ' ถึง ' + dLong(d.to) + ' · นับตาม' + (d.basis === 'issued' ? 'วันที่จ่ายหมาย' : 'วันที่ส่งหมาย');
  /** พิมพ์ A4: หัวเอกสาร · สรุป · กราฟ 6 เดือน · ตารางรายคนพร้อมเส้น 6 เดือน */
  async function printOstats(d, metric, order) {
    loadSarabun();
    const unit = metric === 'n' ? 'ฉบับ' : 'บาท', mval = (o) => o.months.map((x) => metric === 'n' ? x.n : x.amount), t = d.totals;
    const rows = order.map((o, i) => '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(o.name) + '</td><td class="n">' + num(o.n) + '</td><td class="n">' + num(o.n_delivered) + '</td><td class="n">' + baht2(o.amount) + '</td><td class="c pr-sp">' + sparkRow(mval(o), d.months, unit, { cw: 46, h: 36, fs: 10 }) + '</td></tr>').join('');
    await printArea('<div class="pr-head"><img src="court-seal.webp" alt=""><div class="pr-court">ศาลจังหวัดลพบุรี</div>' +
      '<div class="pr-title">' + esc(ostTitle(d)) + '</div><div class="pr-sub">' + esc(ostSub(d)) + '</div></div>' +
      '<table class="pr-tbl pr-kpi"><tbody><tr><td>จำนวนหมาย<br><b>' + num(t.n) + ' ฉบับ</b></td><td>ส่งแล้ว<br><b>' + num(t.n_delivered) + ' ฉบับ</b></td><td>ยอดเงิน<br><b>' + baht2(t.amount) + ' บาท</b></td><td>เฉลี่ยต่อคน<br><b>' + baht2(d.officers.length ? t.amount / d.officers.length : 0) + ' บาท</b></td></tr></tbody></table>' +
      '<div class="pr-chart"><div class="pr-ch">6 เดือนย้อนหลัง (' + esc(metric === 'n' ? 'จำนวนฉบับ' : 'ยอดเงิน บาท') + ') ถึง ' + esc(ostMonthTh(d.months[5])) + '</div>' + ostChart(d, metric) + '</div>' +
      '<table class="pr-tbl pr-ost"><thead><tr><th>ที่</th><th>ผู้ส่งหมาย</th><th>จำนวน</th><th>ส่งแล้ว</th><th>ยอดเงิน (บาท)</th><th>6 เดือน (' + unit + ')</th></tr></thead><tbody>' + rows +
      '<tr class="pr-sum"><td></td><td><b>รวม</b></td><td class="n"><b>' + num(t.n) + '</b></td><td class="n"><b>' + num(t.n_delivered) + '</b></td><td class="n"><b>' + baht2(t.amount) + '</b></td><td class="c pr-sp">' + sparkRow(mval(t), d.months, unit, { cw: 46, h: 36, fs: 10 }) + '</td></tr></tbody></table>' +
      '<div class="pr-note">ยอดเงินหมายฟรีที่ยังไม่เบิกเป็นยอดประมาณการก่อนการเบิก · หมายที่ปิด "ไม่เบิก" หรือพ้นปีงบนับจำนวนแต่ไม่นับยอด · พิมพ์เมื่อ ' + esc(new Date().toLocaleString('th-TH')) + '</div>');
  }
  /** รูป PNG ขนาด A4 (1240×1754) วาดจากข้อมูลครบทุกแถว ไม่ถ่ายหน้าจอ */
  async function pngOstats(d, metric, order) {
    loadSarabun();
    try { await Promise.race([Promise.all([document.fonts.load('400 28px Sarabun'), document.fonts.load('700 28px Sarabun')]), new Promise((res) => setTimeout(res, 2000))]); } catch (e) { /* ฟอนต์สำรอง */ }
    const unit = metric === 'n' ? 'ฉบับ' : 'บาท', mval = (o) => o.months.map((x) => metric === 'n' ? x.n : x.amount), t = d.totals;
    const fmt = (v) => metric === 'n' ? num(v) : baht(v);
    const W = 1240, P = 56, RH = 68, F = '"Sarabun","TH Sarabun New","Noto Sans Thai",sans-serif';
    const H = Math.max(1754, 760 + RH * (order.length + 1) + 210);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'); if (!g) throw new Error('เบราว์เซอร์นี้ไม่รองรับการสร้างรูป PNG');
    const txt = (s, x, y, o) => { o = o || {}; g.font = (o.b ? '700 ' : '400 ') + (o.s || 24) + 'px ' + F; g.fillStyle = o.c || '#1d2b24'; g.textAlign = o.a || 'left'; g.fillText(String(s), x, y); };
    const G = ostColor(d.pay_type);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#e7f2ea'; g.fillRect(0, 0, W, 190);
    const seal = await new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = C.SEAL_URL || 'court-seal.webp'; setTimeout(() => res(null), 1500); });
    if (seal) { try { const scale = Math.min(112 / seal.naturalWidth, 112 / seal.naturalHeight); const w = seal.naturalWidth * scale, h = seal.naturalHeight * scale; g.drawImage(seal, P + (112 - w) / 2, 36 + (112 - h) / 2, w, h); } catch (e) { /* ข้ามตรา */ } }
    const tx = seal ? P + 136 : P;
    txt('ศาลจังหวัดลพบุรี', tx, 70, { s: 28, b: 1, c: '#2f6b4a' });
    txt(ostTitle(d), tx, 114, { s: 34, b: 1 });
    txt(ostSub(d), tx, 154, { s: 22, c: '#4b5d53' });
    // สรุป 4 ช่อง
    const kp = [['จำนวนหมาย', num(t.n) + ' ฉบับ', '#E4F3E8'], ['ส่งแล้ว', num(t.n_delivered) + ' ฉบับ', '#EEF5DE'], ['ยอดเงิน', baht2(t.amount) + ' ฿', '#FDF0CF'], ['เฉลี่ยต่อคน', baht2(d.officers.length ? t.amount / d.officers.length : 0) + ' ฿', '#DCEAF8']];
    const kw = (W - 2 * P - 3 * 16) / 4;
    kp.forEach((k, i) => { const x = P + i * (kw + 16); g.fillStyle = k[2]; g.fillRect(x, 220, kw, 118); txt(k[0], x + 20, 260, { s: 22, c: '#4b5d53' }); txt(k[1], x + 20, 312, { s: 34, b: 1 }); });
    // กราฟ 6 เดือน
    let y0 = 370;
    txt('6 เดือนย้อนหลัง (' + (metric === 'n' ? 'จำนวนฉบับ' : 'ยอดเงิน บาท') + ') ถึง ' + ostMonthTh(d.months[5]), P, y0 + 10, { s: 26, b: 1 });
    const vals = t.months.map((x) => metric === 'n' ? x.n : x.amount), mx = Math.max(1, ...vals);
    const cL = P + 60, cR = W - P - 60, cT = y0 + 64, cB = y0 + 270, step = (cR - cL) / 5;
    const xy = vals.map((v, i) => [cL + i * step, cT + (1 - v / mx) * (cB - cT)]);
    g.strokeStyle = '#DCE6DE'; g.lineWidth = 1.5; g.setLineDash([6, 8]);
    [0, 0.5, 1].forEach((f) => { g.beginPath(); g.moveTo(cL, cT + f * (cB - cT)); g.lineTo(cR, cT + f * (cB - cT)); g.stroke(); });
    g.setLineDash([]);
    g.fillStyle = G+'18'; g.beginPath(); g.moveTo(xy[0][0], cB); xy.forEach((p) => g.lineTo(p[0], p[1])); g.lineTo(xy[5][0], cB); g.closePath(); g.fill();
    g.strokeStyle = G; g.lineWidth = 5; g.lineJoin = 'round'; g.lineCap = 'round'; g.beginPath(); xy.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke();
    xy.forEach((p, i) => {
      g.beginPath(); g.arc(p[0], p[1], i === 5 ? 9 : 7, 0, Math.PI * 2); g.fillStyle = i === 5 ? G : '#fff'; g.fill(); g.lineWidth = 4; g.strokeStyle = G; g.stroke();
      txt(fmt(vals[i]), p[0], p[1] - 20, { s: 26, b: 1, a: 'center' });
      txt(ostMonthTh(d.months[i]), p[0], cB + 40, { s: 24, b: 1, a: 'center', c: '#3D5A4A' });
      txt(metric === 'n' ? baht(t.months[i].amount) + ' ฿' : num(t.months[i].n) + ' ฉบับ', p[0], cB + 72, { s: 20, a: 'center', c: '#7A8A80' });
    });
    // ตารางรายคน
    let y = cB + 120;
    const SPX = 720, CW = (W - P - 16 - SPX) / 6;
    const cols = [['ที่', P + 12, 'left'], ['ผู้ส่งหมาย', P + 70, 'left'], ['จำนวน', 430, 'right'], ['ส่งแล้ว', 540, 'right'], ['ยอดเงิน (บาท)', 700, 'right']];
    g.fillStyle = '#f1f5f2'; g.fillRect(P, y - 38, W - 2 * P, RH - 4);
    cols.forEach((c) => txt(c[0], c[1], y, { s: 22, b: 1, a: c[2], c: '#4b5d53' }));
    txt('6 เดือน (' + unit + ')', SPX + 3 * CW, y, { s: 22, b: 1, a: 'center', c: '#4b5d53' });
    const rowSpark = (vs, yy) => {
      const m2 = Math.max(1, ...vs), pts = vs.map((v, i) => [SPX + CW * i + CW / 2, yy - 22 + (1 - v / m2) * 20]);
      g.strokeStyle = G; g.lineWidth = 2.6; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke();
      pts.forEach((p, i) => { g.beginPath(); g.arc(p[0], p[1], i === 5 ? 4.5 : 3.2, 0, Math.PI * 2); g.fillStyle = i === 5 ? G : '#fff'; g.fill(); g.lineWidth = 2; g.stroke(); txt(fmt(vs[i]), p[0], yy + 24, { s: 16, a: 'center', c: '#4b5d53' }); });
    };
    order.forEach((o, i) => {
      y += RH; if (i % 2) { g.fillStyle = '#f4f8f5'; g.fillRect(P, y - 36, W - 2 * P, RH); }
      txt(i + 1, cols[0][1], y, { s: 24 }); txt(o.name, cols[1][1], y, { s: 24 });
      txt(num(o.n), cols[2][1], y, { s: 24, a: 'right' }); txt(num(o.n_delivered), cols[3][1], y, { s: 24, a: 'right' }); txt(baht2(o.amount), cols[4][1], y, { s: 24, b: 1, a: 'right' });
      rowSpark(mval(o), y);
    });
    y += RH; g.fillStyle = '#b9d0c1'; g.fillRect(P, y - 38, W - 2 * P, 2);
    txt('รวม', cols[1][1], y, { s: 26, b: 1 }); txt(num(t.n), cols[2][1], y, { s: 26, b: 1, a: 'right' }); txt(num(t.n_delivered), cols[3][1], y, { s: 26, b: 1, a: 'right' }); txt(baht2(t.amount), cols[4][1], y, { s: 26, b: 1, a: 'right' });
    rowSpark(mval(t), y);
    y += 84;
    txt('ยอดเงินหมายฟรีที่ยังไม่เบิกเป็นยอดประมาณการก่อนการเบิก · หมายที่ปิด "ไม่เบิก" หรือพ้นปีงบนับจำนวนแต่ไม่นับยอด', P, y, { s: 20, c: '#4b5d53' });
    txt('สร้างรูปเมื่อ ' + new Date().toLocaleString('th-TH'), P, y + 34, { s: 20, c: '#6b7b72' });
    txt(PRIVACY_TH, P, y + 68, { s: 20, b: 1, c: '#2f6b4a' });
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    if (!blob) throw new Error('สร้างรูปไม่สำเร็จ');
    await ostSavePng(blob, 'สถิติเจ้าหน้าที่ส่งหมาย-' + d.pay_type + '-' + d.from + '-' + d.to + '.png', 'บันทึกรูป PNG แล้ว');
  }
  /* ---------- 0.7.28 สถิติการเงิน (ปีงบ) บนหน้าสถิติ — อ่านอย่างเดียวจาก compensation_summary + free_claim (ไม่แตะ Apps Script) ---------- */
  // Presentation only: do not reallocate money. Widths reflect saved amounts, not an assumed 60/40.
  function splitVisual(c60, c40, fmt) {
    if (!Number.isFinite(c60) || !Number.isFinite(c40) || c60 < 0 || c40 < 0) return '';
    const sum = c60 + c40, ratio = sum ? 100 * c60 / sum : 0;
    return '<div class="np-split-visual"><div class="np-split-track" aria-hidden="true"><i style="width:'+ratio+'%"></i><i style="width:'+(sum?100-ratio:0)+'%"></i></div><div class="np-split-legend"><div><span>เจ้าหน้าที่ส่งหมาย 60%</span><b>'+fmt(c60)+' ฿</b></div><div><span>ยอดโอนคืน 40%</span><b>'+fmt(c40)+' ฿</b></div></div><p class="tiny muted">ยอดโอนคืน 40% คือยอดส่วนแบ่งเข้ากองกลางตามใบแบ่ง ไม่ใช่หลักฐานว่าโอนเงินจริงแล้ว</p></div>';
  }
  function financeCardsHtml(c, f, fy) {
    const t = c.totals || {}, ft = (f && f.totals) || {}, ready = c.free_ready, paidRef = c.paid_pending_reference;
    const valid = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
    const base = valid(t.paid)&&valid(t.budget) ? t.paid+t.budget : null;
    const rounds = (c.rounds || []).slice().sort((a,b)=>String(b.pay_date||'').localeCompare(String(a.pay_date||''))||String(b.round_id||'').localeCompare(String(a.round_id||'')));
    const last = rounds[0], lf = rounds.find(r=>r.round_type==='FREE');
    const readyOk = ready && ready.fy===String(fy||c.fy) && valid(ready.ready_amount);
    const paidRefOk = paidRef && paidRef.fy===String(fy||c.fy) && valid(paidRef.amount);
    const latestOk = lf && valid(lf.base_total) && (c.scope_officer || lf.base_verified===true);
    const card = (lbl,v,sub,cls) => '<div class="clay kpi np-fin-card '+cls+'"><span>'+lbl+'</span><b>'+ (valid(v)?baht2(v):'—')+'</b><small>'+sub+'</small></div>';
    const na='<span class="flag-r">ข้อมูลไม่พร้อม · ไม่ใช่ 0 บาท</span>';
    const scope = c.scope_officer?' · เฉพาะของฉัน':'';
    return '<section class="clay panel fin-stats" aria-labelledby="finH"><h3 id="finH">สถิติการเงิน · ปีงบประมาณ '+esc(c.fy||fy||'')+scope+'</h3><div class="comp-kpis np-fin-grid">'+
      card('ยอดยังไม่เบิก · หมายฟรีที่พร้อมเบิก',readyOk?ready.ready_amount:null,readyOk?'บาท · '+num(ready.ready_n)+' ฉบับ · '+num(ready.ready_units)+' หน่วยเบิก · หลังรวมหน่วยตามกฎเดิม':na,'np-wait')+
      card('ยอดหมายฟรีเบิกครั้งล่าสุด',latestOk?lf.base_total:null,lf?(latestOk?'บาท · รอบ '+esc(thDate(lf.pay_date))+' · '+(lf.payment_status==='PAID'?'บันทึกจ่ายจริง '+esc(thDate(lf.payment_date)):'ยืนยันแล้ว ยังไม่บันทึกหลักฐานจ่าย'):na):'ยังไม่มีรอบหมายฟรีในปีงบนี้','np-last')+
      card('หมายมีเงิน · ยังไม่พบบัญชีจ่าย',paidRefOk?paidRef.amount:null,paidRefOk?'บาท · '+num(paidRef.count)+' ฉบับ · ยอดอ้างอิง ต้องตรวจบัญชี 30 ที่จับคู่ไม่ครบ':na,'np-paid-ref')+
      card('เบิกแล้ว (ตามรอบยืนยัน)',base,'บาท · ก่อนแบ่ง · มีเงิน '+(valid(t.paid)?baht2(t.paid):'—')+' · ฟรี '+(valid(t.budget)?baht2(t.budget):'—'),'np-confirmed')+
      card('รอเบิก · หมายฟรี (ประมาณการเต็มอัตรา)',valid(ft.unclaimed_full)?ft.unclaimed_full:null,valid(ft.unclaimed_full)?'บาท · '+num(ft.unclaimed_n)+' ฉบับ · ไม่ใช่ยอดพร้อมเบิกจริง':na,'np-estimate')+
      card('จ่ายจริงแล้ว (ส่วน 60%)',valid(t.paid60)?t.paid60:null,'บาท · บันทึกหลักฐานจ่ายแล้ว','np-paid')+
      card('ยังไม่บันทึกหลักฐานจ่าย (60%)',valid(t.pending60)?t.pending60:null,'บาท · '+num(c.unrecorded_rounds)+' รอบ · ไม่ได้แปลว่ายังไม่จ่าย','np-unrecorded')+
      '</div>'+splitVisual(t.c60,t.c40,baht2)+
      (last?'<p class="tiny muted">รอบล่าสุดทุกประเภท '+esc(thDate(last.pay_date))+' · '+esc(RTYPE_TH[last.round_type]||last.round_type||'')+'</p>':'')+
      '<p class="tiny muted">ยอดยังไม่เบิกช่องแรกคือหมายฟรีพร้อมเสนอ ไม่รวมรอผล/รอตรวจ · หมายมีเงินที่ยังไม่พบบัญชีจ่ายเป็นยอดอ้างอิงแยกต่างหาก ไม่ถือว่าเป็นเงินค้างจ่ายจนกว่าจะกระทบยอด · ยอด 60/40 ใช้ค่าที่บันทึกในรอบเดิม</p><div class="row"><button type="button" class="btn btn-sm" data-go="compensation">ดูรายรอบ</button>'+(has('NOTICE','FINANCE','ADMIN')?'<button type="button" class="btn btn-sm" data-go="finance">ตรวจเงินงบประมาณ</button>':'')+'</div></section>';
  }
  async function finStatsPanel(box, fy) {
    box.innerHTML = '<section class="clay panel"><span class="spin"></span> <span class="muted">กำลังโหลดสถิติการเงิน…</span></section>';
    let c,f;
    try { [c,f] = await Promise.all([api('compensation_summary',{fy:fy||'',include_ready:true}),api('free_claim',{fy:fy}).catch(()=>null)]); }
    catch(e) { box.innerHTML='<section class="clay panel"><p class="flag-r small">โหลดสถิติการเงินไม่ได้: '+esc(e.message)+'</p></section>'; return; }
    if(!box.isConnected)return;
    box.innerHTML=financeCardsHtml(c,f,fy);
    box.querySelectorAll('[data-go]').forEach(b=>{b.onclick=()=>go(b.dataset.go);});
  }
  { const _home = RENDER.home; RENDER.home = async (m) => { await _home(m); const box = document.createElement('div'); box.className = 'fin-stats-wrap'; const head = m.querySelector('.top'); if (head) head.after(box); else m.prepend(box); await finStatsPanel(box, S.fy); }; }
  RENDER.ostats = async (m) => {
    let st = null; try { st = JSON.parse(localStorage.getItem(OST_KEY) || 'null'); } catch (e) { st = null; }
    const td = ostToday();
    st = Object.assign({ type: 'BUDGET', from: ostFyStart(td), to: td, basis: 'issued', metric: 'amount' }, st || {});
    const saveSt = () => { try { localStorage.setItem(OST_KEY, JSON.stringify(st)); } catch (e) { /* ใช้ต่อได้ */ } };
    const TYPES = [['BUDGET', 'หมายฟรี'], ['PAID', 'หมายมีเงิน'], ['ALL', 'รวม']];
    m.innerHTML = top('สถิติเจ้าหน้าที่ส่งหมาย', '<div class="row" style="gap:8px"><button type="button" class="btn btn-g btn-sm" id="oPrint" disabled>พิมพ์ A4</button><button type="button" class="btn btn-sm" id="oPng" disabled>บันทึก PNG</button></div>') +
      '<div class="clay panel ost-ctl">' +
        '<div class="row ost-seg" role="group" aria-label="ประเภทหมาย">' + TYPES.map(([k, t]) => '<button type="button" class="btn btn-sm" data-t="' + k + '" aria-pressed="false">' + t + '</button>').join('') + '</div>' +
        '<div class="pform" style="margin-top:12px"><label>วันที่เริ่ม<input type="date" class="inp" id="oFrom"></label><label>วันที่สิ้นสุด<input type="date" class="inp" id="oTo"></label>' +
          '<label>นับตามวันที่<select class="inp" id="oBasis"><option value="issued">วันที่จ่ายหมาย</option><option value="delivered">วันที่ส่งหมาย</option></select></label></div>' +
        '<div class="row ost-quick" style="gap:6px;margin-top:10px"><button type="button" class="btn btn-xs" data-q="m0">เดือนนี้</button><button type="button" class="btn btn-xs" data-q="m3">3 เดือน</button><button type="button" class="btn btn-xs" data-q="m6">6 เดือน</button><button type="button" class="btn btn-xs" data-q="fy">ปีงบนี้</button></div></div>' +
      '<div id="oBody"><div class="clay panel"><span class="spin"></span> <span class="muted">กำลังโหลด…</span></div></div>';
    const paint = () => {
      m.querySelectorAll('.ost-seg [data-t]').forEach((b) => { const on = b.dataset.t === st.type; b.classList.toggle('btn-g', on); b.setAttribute('aria-pressed', String(on)); });
      $('#oFrom').value = st.from; $('#oTo').value = st.to; $('#oBasis').value = st.basis;
    };
    let ticket = 0;
    const load = async () => {
      const my = ++ticket; paint(); saveSt();
      if (!st.from || !st.to || st.from > st.to) { $('#oBody').innerHTML = '<div class="clay panel"><p class="note r">วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด</p></div>'; return; }
      let d; try { d = await api('officer_stats', { pay_type: st.type, from: st.from, to: st.to, basis: st.basis }); }
      catch (e) { if (my === ticket) $('#oBody').innerHTML = '<div class="clay panel"><p class="note r">' + esc(e.message) + '</p></div>'; return; }
      if (my !== ticket) return;
      const t = d.totals, tName = (TYPES.find((x) => x[0] === d.pay_type) || [])[1], unit = st.metric === 'n' ? 'ฉบับ' : 'บาท';
      const mval = (o) => o.months.map((x) => st.metric === 'n' ? x.n : x.amount);
      const kt = (cls, lbl, v, sub, money) => '<div class="kpi clay kt ' + cls + '"><span>' + esc(lbl) + '</span><b data-count="' + Number(v || 0) + '"' + (money ? ' data-money="1" data-suffix="&nbsp;฿" data-final="' + baht2(v) + '&nbsp;฿"' : '') + '>' + (money ? baht2(v) + '&nbsp;฿' : num(v)) + '</b><small>' + sub + '</small></div>';
      $('#oBody').innerHTML =
        '<div class="bn4 ost-k">' + kt('k-all', 'จำนวนหมาย · ' + tName, t.n, 'ฉบับ · ' + esc(thDate(d.from)) + ' – ' + esc(thDate(d.to))) +
          kt('k-paid', 'ยอดเงิน', t.amount, 'ตามข้อมูลในระบบ ก่อนแบ่ง 60/40', true) +
          kt('k-done', 'ส่งแล้ว', t.n_delivered, 'ฉบับ · ' + (t.n ? pctOf(t.n_delivered, t.n) : '0%') + ' ของทั้งหมด') +
          kt('k-free', 'เฉลี่ยต่อคน', d.officers.length ? t.amount / d.officers.length : 0, num(d.officers.length) + ' คน', true) + '</div>' +
        '<div class="clay panel ost-box" id="oChartBox"><div class="row" style="justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0">6 เดือนย้อนหลัง <span class="small muted">ถึง ' + esc(ostMonthTh(d.months[5])) + '</span></h3>' +
          '<div class="row" style="gap:6px" role="group" aria-label="แสดงค่า"><button type="button" class="btn btn-xs' + (st.metric === 'amount' ? ' btn-g' : '') + '" data-mt="amount">ยอดเงิน</button><button type="button" class="btn btn-xs' + (st.metric === 'n' ? ' btn-g' : '') + '" data-mt="n">จำนวน</button></div></div>' +
          ostChart(d, st.metric) + '</div>' +
        '<div class="clay panel" id="oTblBox"><h3>' + (d.scope_officer ? 'หมายของฉัน' : 'แยกรายผู้ส่งหมาย') + '</h3><div class="tbl-wrap"><table id="ostTbl"><thead><tr><th class="onm">ผู้ส่งหมาย</th>' +
          '<th class="n" data-sort>จำนวน (ฉบับ)</th><th class="n" data-sort>ยอดเงิน (บาท)</th><th class="ost-6">6 เดือน (' + unit + ')</th></tr></thead><tbody>' +
          (d.officers.length ? d.officers.map((o) => '<tr data-oid="' + esc(o.officer_id) + '"><td class="onm">' + oDot({ [o.officer_id]: o }, o.officer_id) + esc(o.name) + '<span class="ost-msp">' + spark6(mval(o), d.months, unit) + '<span class="tiny muted">' + esc(ostMonthTh(d.months[5])) + ' ' + (st.metric === 'n' ? num(mval(o)[5]) : baht(mval(o)[5])) + '</span></span></td>' +
            '<td class="n" data-v="' + o.n + '"><b data-rc="' + o.n + '">' + num(o.n) + '</b><span class="tiny muted ost-sub">ส่งแล้ว <span data-rc="' + o.n_delivered + '">' + num(o.n_delivered) + '</span></span></td>' +
            '<td class="n" data-v="' + o.amount + '"><b data-rc="' + o.amount + '" data-money="1" data-final="' + baht2(o.amount) + '">' + baht2(o.amount) + '</b></td>' +
            '<td class="ost-6">' + sparkRow(mval(o), d.months, unit) + '</td></tr>').join('')
            : '<tr><td colspan="4" class="muted small">ไม่มีข้อมูลในช่วงนี้</td></tr>') +
          '</tbody><tfoot><tr><td><b>รวม</b></td><td class="n"><b data-rc="' + t.n + '">' + num(t.n) + '</b><span class="tiny muted ost-sub">ส่งแล้ว <span data-rc="' + t.n_delivered + '">' + num(t.n_delivered) + '</span></span></td><td class="n"><b data-rc="' + t.amount + '" data-money="1" data-final="' + baht2(t.amount) + '">' + baht2(t.amount) + '</b></td><td class="ost-6">' + sparkRow(mval(t), d.months, unit) + '</td></tr></tfoot></table></div>' +
          '<p class="tiny muted" style="margin:8px 2px 0">กดลูกศร ▲ เรียงจากมากไปน้อย · ▼ จากน้อยไปมาก · นับตาม' + (d.basis === 'issued' ? 'วันที่จ่ายหมาย' : 'วันที่ส่งหมาย') +
            ' · ยอดเงินหมายฟรีที่ยังไม่เบิกเป็นยอดประมาณการก่อนการเบิก · หมายที่ปิด "ไม่เบิก" หรือพ้นปีงบนับจำนวนแต่ไม่นับยอด</p></div>';
      const tbl = $('#ostTbl'); if (st.sc !== undefined) { tbl.dataset.sc = st.sc; tbl.dataset.sd = st.sd; } else { tbl.dataset.sc = '2'; tbl.dataset.sd = 'desc'; }
      sortable(tbl);
      tbl.querySelectorAll('.srt button').forEach((b) => b.addEventListener('click', () => { st.sc = tbl.dataset.sc; st.sd = tbl.dataset.sd; saveSt(); }));
      m.querySelectorAll('[data-mt]').forEach((b) => b.addEventListener('click', () => { st.metric = b.dataset.mt; load(); }));
      glueThai($('#oBody'));
      S.ostLast = { d: d, metric: st.metric }; $('#oPrint').disabled = false; $('#oPng').disabled = false;
      // ภาพเคลื่อนไหว: การ์ดเล่นทันที · กราฟและตารางเล่นเมื่อเลื่อนมาถึง (กด/เลื่อนเมาส์ผ่านเพื่อเล่นซ้ำ)
      m.querySelectorAll('#oBody .kpi').forEach((k) => replayFx(k));
      const playIn = (el) => { if ('IntersectionObserver' in window) { const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.disconnect(); replayFx(el); } }), { threshold: 0.15 }); io.observe(el); } else replayFx(el); };
      playIn($('#oChartBox')); playIn($('#oTblBox'));
    };
    const order = () => { const L = S.ostLast; const ids = Array.from(m.querySelectorAll('#ostTbl tbody tr')).map((r) => r.dataset.oid); const by = {}; L.d.officers.forEach((o) => { by[o.officer_id] = o; }); return ids.map((id) => by[id]).filter(Boolean); };
    $('#oPrint').addEventListener('click', () => { const L = S.ostLast; if (L) printOstats(L.d, L.metric, order()); });
    $('#oPng').addEventListener('click', async () => { const L = S.ostLast; if (!L) return; const b = $('#oPng'); b.disabled = true; try { await pngOstats(L.d, L.metric, order()); } catch (e) { toast(e.message || 'สร้างรูปไม่สำเร็จ'); } b.disabled = false; });
    m.querySelectorAll('.ost-seg [data-t]').forEach((b) => b.addEventListener('click', () => { st.type = b.dataset.t; load(); }));
    $('#oFrom').addEventListener('change', (e) => { st.from = e.target.value; load(); });
    $('#oTo').addEventListener('change', (e) => { st.to = e.target.value; load(); });
    $('#oBasis').addEventListener('change', (e) => { st.basis = e.target.value; load(); });
    m.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
      const td2 = ostToday(), q = b.dataset.q;
      st.to = td2; st.from = q === 'fy' ? ostFyStart(td2) : ostShift(td2, q === 'm0' ? 0 : -(Number(q.slice(1)) - 1)); load();
    }));
    await load();
  };

  RENDER.search = (m) => {
    m.innerHTML = top('ค้นหาหมาย') +
      '<form class="clay panel row" id="sf"><label class="sr" for="sq">เลขคดีหรือเลขหมาย</label>' +
      '<input id="sq" class="inp" style="flex:1;min-width:220px" placeholder="เลขคดีหรือเลขหมาย เช่น ต1250/2569">' +
      '<button class="btn btn-g">ค้นหา</button></form><div id="sr"></div>';
    $('#sq').focus();
    $('#sf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const out = $('#sr'); out.innerHTML = '<div class="clay panel"><span class="spin"></span></div>';
      try {
        const d = await api('notice_search', { q: $('#sq').value });
        out.innerHTML = '<div class="clay panel"><h3>พบ ' + num(d.rows.length) + ' รายการ</h3>' + (d.rows.length ? '<div class="tbl-wrap"><table><thead><tr><th>เลขคดี</th><th>ชนิดหมาย</th><th>ประเภท</th><th>ผู้รับ / พื้นที่</th><th class="onm">ผู้ส่ง</th><th>จ่ายหมาย</th><th>ส่ง</th><th class="n">ค่าหมาย</th><th>สถานะ</th></tr></thead><tbody>' +
          d.rows.map((r) => '<tr><td><b>' + esc(r.case_no) + '</b>' + (r.case_ref ? '<br><span class="tiny muted">' + esc(r.case_ref) + '</span>' : '') + '</td><td>' + esc(r.notice_kind || r.notice_no) + '</td><td><span class="pill ' + (r.pay_type === 'BUDGET' ? 'b' : 'g') + '">' + esc(PAY_TH[r.pay_type] || r.pay_type) + '</span>' +
            (r.pay_type === 'PAID' && r.amount !== '' ? '<br><span class="tiny">' + num(r.amount) + ' บาท</span>' : '') + '</td>' +
            '<td>' + esc(r.recipient) + '<br><span class="tiny muted">' + esc(r.place) + '</span></td><td class="onm">' + esc(r.officer) + '</td><td>' + esc(thDate(r.issued_date)) + '</td><td>' + esc(thDate(r.delivered_date)) +
            (r.result ? '<br><span class="tiny muted">' + esc(r.result) + '</span>' : '') + '</td>' +
            '<td class="n">' + (r.calc_amount !== '' && r.calc_amount !== undefined ? '<b>' + num(r.calc_amount) + '</b>' : '—') + (r.budget_unit_id ? '<br><span class="tiny muted">รวมใน ' + esc(r.budget_unit_id) + '</span>' : '') +
            (r.calc_rule && r.pay_type === 'BUDGET' ? '<br><span class="tiny muted">' + esc(r.calc_rule) + '</span>' : '') + '</td><td><span class="pill ' + (r.status === 'DELIVERED' ? 'g' : 'a') + '">' + esc(STATUS_TH[r.status] || r.status) + '</span>' +
            (r.flags ? '<br>' + flagsOf(r) : '') + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="muted" style="margin:0">ไม่พบหมาย</p>') + '</div>';
      } catch (er) { out.innerHTML = '<div class="clay panel"><p class="note r" style="margin:0">' + esc(er.message) + '</p></div>'; }
    });
  };

  /* ---------------------------------------------------------------- นำเข้าข้อมูล */
  const IM = {};
  let importEpoch = 0;
  const IMPORT_META = () => IM.meta;
  function resetImport() { importEpoch++; Object.keys(IM).forEach((k) => { if (k !== 'meta') delete IM[k]; }); }
  const normH = (s) => String(s || '').replace(/[๐-๙]/g, (c) => String(c.charCodeAt(0) - 0x0E50)).replace(/\s+/g, '').toLowerCase();

  RENDER.import = async (m) => {
    if (!IM.meta) IM.meta = await api('import_templates');
    else api('import_templates').then((x) => { IM.meta = x; paintKinds(); }).catch(() => {});   // สถานะไฟล์ล่าสุด (ผู้อื่นอาจนำเข้าแล้ว)
    resetImport();
    m.innerHTML = top('นำเข้าและกระทบยอด') + '<p class="privacy-note">🔒 ' + PRIVACY_TH + '</p><section class="clay panel np-import-groups"><h3>ข้อมูลตั้งต้น 50 · 42 · 18</h3><p class="small muted">ทะเบียนหมายสะสมทั้งปี · ผลการส่ง · ราคาตามบัญชีศาล</p><h3>ข้อมูลการเงิน 25 · 30</h3><p class="small muted">30 นำเข้าบัญชีจ่ายด้านล่าง · 25 ใช้หน้าตรวจยอดใบเบิกเดิม ไม่บวกยอดซ้ำกับ 30</p><div class="row"><button class="btn btn-g btn-sm" type="button" id="npOpen25">แบบ 25 · ตรวจยอด</button><a class="btn btn-sm" href="tools/party-cleaner/notice-pay-party-cleaner-offline.html" download>เครื่องมือตัดชื่อออฟไลน์เดิม</a></div></section>' + importGuideHtml() +
      batchPanelHtml() +
      '<div class="clay panel"><h3><span class="small muted">หรือนำเข้าทีละไฟล์ ·</span> 1 · เลือกชนิดไฟล์</h3><p class="small muted" style="margin:-4px 2px 10px"><span class="kdot ok"></span> สีเขียว = นำเข้าแล้ว (แสดงไฟล์ล่าสุด) · <span class="kdot"></span> สีเทา = ยังไม่เคยนำเข้า</p><div class="kinds">' +
      '<button type="button" class="kind clay-mint" data-k="ISSUE"><b>ไฟล์จ่ายหมาย</b><span class="small">นำเข้าวันที่จ่ายหมาย — แบบรวมทุกคน หรือแยกรายคน · หมายใหม่จะมีสถานะ "จ่ายหมายแล้ว รอผล"</span>' +
        '<span class="howto">นำเข้าไฟล์เมนู <b>บัญชีหมาย</b> › ประเภท <b>50. บัญชีจ่ายหมาย พนักงานศาลนี้ส่ง (แบบรวม)</b> › เลือกวันที่ ถึงวันที่</span></button>' +
      '<button type="button" class="kind clay-mint" data-k="RESULT"><b>ไฟล์ผลหมาย</b><span class="small">นำเข้าวันอื่นได้ — หมายที่ส่งแล้วพร้อมวันที่ส่ง · ระบบจับคู่กับหมายเดิมแล้วเปลี่ยนเป็น "ส่งแล้ว"</span>' +
        '<span class="howto">นำเข้าไฟล์เมนู <b>บัญชีหมาย</b> › ประเภท <b>42. บัญชีผลการส่งคำคู่ความ ส่งโดยเจ้าพนักงาน</b> › เลือกวันที่ ถึงวันที่</span></button>' +
      '<button type="button" class="kind clay-mint" data-k="FREE18"><b>ราคาหมายฟรีตามบัญชีศาล</b><span class="small">ราคาหมายฟรีรายเรื่องที่ศาลคิด (รวมหมายตามข้อ 7 แล้ว) · ใช้เป็นยอดเบิกในรอบหมายฟรี · นำเข้าก่อนตั้งรอบหมายฟรีทุกครั้ง</span>' +
        '<span class="howto">นำเข้าไฟล์เมนู <b>บัญชีหมาย</b> › ประเภท <b>18. บัญชีจ่ายหมาย พนักงานศาลนี้ส่ง หมายฟรี</b></span></button>' +
      '<button type="button" class="kind clay-mint" data-k="PAY"><b>บัญชีจ่ายเงินหมายมีเงิน</b><span class="small">หมายมีเงินที่จ่ายจริง แยกตามวันที่จ่าย · นำเข้าทุกสัปดาห์ก่อนตั้งรอบหมายเงิน (ยอดตามไฟล์) · ไฟล์เดียวมีได้หลายวันจ่าย</span>' +
        '<span class="howto">นำเข้าไฟล์เมนู <b>บัญชีเบิกจ่ายหมาย</b> › ประเภท <b>30. บัญชีการจ่ายเงินให้เจ้าพนักงานศาล</b> (แบบหลายใบเสร็จ) › เลือกวันที่ ถึงวันที่</span></button>' +
      '</div></div><div id="imFile"></div><div id="imMap"></div><div id="imPrev"></div>' +
      (IM.meta.start_fy ? '<p class="small" style="margin:0 6px 6px"><span class="period">เริ่มประมวลผลตั้งแต่ปีงบประมาณ ' + esc(IM.meta.start_fy) + ' (1 ต.ค. ' + esc(Number(IM.meta.start_fy) - 1) + ')</span> หมายที่จ่ายก่อนวันนี้ไม่นำเข้า</p>' : '') +
      '<p class="small muted" style="margin:0 6px">กฎการนำเข้าตามข้อกำหนดฉบับ 4.0 ข้อ 3: นำเข้าไฟล์เดิมซ้ำได้ ยอดไม่เพิ่ม · ไม่ลบข้อมูลที่ไม่อยู่ในไฟล์ล่าสุด · หมายที่เข้ารอบจ่าย/เบิกแล้วจะไม่ถูกเขียนทับ</p>';
    $('#npOpen25').onclick=()=>go('claim25');
    paintKinds(); bindBatch();
    const gd = $('#imGuide');
    if (gd) { $('#imGuideClose').addEventListener('click', () => { gd.open = false; gd.scrollIntoView({ block: 'nearest' }); }); }
    m.querySelectorAll('.kind').forEach((b) => b.addEventListener('click', () => {
      m.querySelectorAll('.kind').forEach((x) => x.classList.toggle('on', x === b));
      resetImport(); IM.kind = b.dataset.k; drawFile();
    }));
  };

  /** กล่องชนิดไฟล์: นำเข้าแล้ว = สีเขียว + ไฟล์ล่าสุดและช่วงวันที่ในไฟล์ · ยังไม่เคยนำเข้า = สีเทา */
  function paintKinds() {
    const L = (IM.meta && IM.meta.last) || {};
    document.querySelectorAll('.kinds .kind').forEach((b) => {
      const x = L[b.dataset.k];
      b.classList.toggle('clay-mint', !!x); b.classList.toggle('kind-none', !x);
      let st = b.querySelector('.kstat');
      if (!st) { st = document.createElement('span'); b.appendChild(st); }
      st.className = 'kstat' + (x ? ' ok' : '');
      if (!x) { st.innerHTML = 'ยังไม่เคยนำเข้า'; return; }
      const per = x.from && x.to
        ? 'ไฟล์ข้อมูลเริ่มวันที่ <b>' + esc(thLong(x.from)) + '</b> ถึงวันที่ <b>' + esc(thLong(x.to)) + '</b>' + (x.derived ? ' <span class="tiny">(ตามวันที่จ่ายในไฟล์)</span>' : '')
        : (b.dataset.k === 'FREE18' ? 'ไฟล์ประเภท 18 ไม่ระบุช่วงวันที่ — ข้อมูล ณ วันที่นำเข้า' : 'ไม่ได้บันทึกช่วงวันที่ (นำเข้าก่อนรุ่น 0.6.2) — นำเข้าครั้งถัดไปจะแสดง');
      st.innerHTML = '✓ นำเข้าล่าสุด ' + esc(thDate(x.at, true)) + ' · ' + num(x.rows) + ' รายการ<br>' + per;
    });
  }

  function drawFile() {
    $('#imMap').innerHTML = ''; $('#imPrev').innerHTML = '';
    $('#imFile').innerHTML = '<div class="clay panel"><h3>2 · เลือกไฟล์ ' + ({ ISSUE: 'จ่ายหมาย', RESULT: 'ผลหมาย', FREE18: 'บัญชีจ่ายหมาย หมายฟรี (ประเภท 18)', PAY: 'บัญชีการจ่ายเงินให้เจ้าพนักงานศาล (ประเภท 30)' }[IM.kind] || '') + '</h3>' +
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
      const fileEpoch = ++importEpoch;
      $('#imPrev').innerHTML = '';
      const buf = await f.arrayBuffer();
      if (fileEpoch !== importEpoch) return;
      const dig = await crypto.subtle.digest('SHA-256', buf);
      if (fileEpoch !== importEpoch) return;
      IM.file = { name: f.name, size: f.size, checksum: Array.from(new Uint8Array(dig)).map((b) => b.toString(16).padStart(2, '0')).join('') };
      IM.wb = XLSX.read(buf, { type: 'array', cellDates: false });
      IM.sheet = IM.wb.SheetNames[0];
      if (IM.kind === 'PAY' || IM.kind === 'FREE18') return ledgerFile(fileEpoch);
      loadSheet();
    } catch (e) { $('#fInfo').innerHTML = '<p class="note r">อ่านไฟล์ไม่ได้: ' + esc(e.message) + '</p>'; }
  }

  /* ---------- นำเข้าบัญชีการเงิน: บัญชีการจ่ายเงินให้เจ้าพนักงานศาล (PAY) · บัญชีจ่ายหมาย หมายฟรี ประเภท 18 (FREE18) ---------- */
  const TH_MON = { 'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6, 'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12 };
  const digits = (v) => String(v === null || v === undefined ? '' : v).replace(/[๐-๙]/g, c => String(c.charCodeAt(0)-0x0E50));
  function thIso(v, wb) {
    wb = wb || IM.wb;
    return NoticeImportFormat.date(v, !!(wb && wb.Workbook && wb.Workbook.WBProps && wb.Workbook.WBProps.date1904)) || '';
  }
  const amtOf = (v) => { const t=digits(v).trim().replace(/,/g,''); if(!/^\d+(?:\.\d{1,2})?$/.test(t)) throw new Error('จำนวนเงินไม่ถูกต้อง: '+String(v)); const n=Number(t); if(!Number.isFinite(n))throw new Error('จำนวนเงินไม่ถูกต้อง'); return n; };
  const firstLine = (v) => String(v || '').split(/\r?\n/)[0].trim();
  function parseLedger(kind, aoa, wb) {
    const thIsoW = (v) => thIso(v, wb);
    const text = (r) => r.map((c) => String(cellVal(c))).join(' ').replace(/\s+/g, ' ').trim();
    const need = kind === 'PAY' ? ['วันที่จ่าย', 'เลขดำที่', 'ส่งหมายถึงใคร', 'ราคา'] : ['เลขดำที่', 'หมายถึงใคร', 'ราคา', 'เจ้าของหมาย'];
    const hi = aoa.findIndex((r) => need.every((h) => r.some((c) => normH(c) === normH(h))));
    const title = aoa.slice(0, Math.max(hi, 0)).map(text).join(' ');
    if (hi < 0) throw new Error(kind === 'PAY' ? 'ไม่พบหัวตาราง วันที่จ่าย / เลขดำที่ / ส่งหมายถึงใคร / ราคา — ตรวจว่าเป็นไฟล์ "บัญชีการจ่ายเงินให้เจ้าพนักงานศาล"' : 'ไม่พบหัวตาราง เลขดำที่ / หมายถึงใคร / ราคา / เจ้าของหมาย — ตรวจว่าเป็นไฟล์ "18. บัญชีจ่ายหมาย พนักงานศาลนี้ส่ง หมายฟรี"');
    const H = aoa[hi].map(normH), col = (h) => H.indexOf(normH(h));
    const seq = H.findIndex((h) => h === 'ที่');
    const rows = [], groups = []; let officer = '', footer = null, footerN = null;
    aoa.slice(hi + 1).forEach((r) => {
      const t = text(r);
      if (kind === 'PAY' && /^จ่ายเงินให้/.test(t)) { const m = t.match(/จ่ายเงินให้\s*(.+?)\s*รวมเป็นเงิน\s*([\d,]+(?:\.\d+)?)/); if (m) { officer = m[1].trim(); groups.push({ officer: officer, amount: amtOf(m[2]) }); } return; }
      if (/รวมเป็นเงินทั้งสิ้น|รวมทั้งสิ้น/.test(t)) {
        const m = t.match(/([\d,]+\.\d{2})\s*(?:บาท)?\s*$/) || t.match(/([\d,]+\.\d{2})/); if (m) footer = amtOf(m[1]);
        const k = t.match(/=?\s*(\d[\d,]*)\s*(?:เรื่อง|หมาย)/); if (k) footerN = amtOf(k[1]);
        return;
      }
      if (seq < 0 || !/^\d+$/.test(digits(r[seq]).trim())) return;
      if (kind === 'PAY' && r[col('วันที่รับเงิน')] && !thIsoW(r[col('วันที่รับเงิน')])) throw new Error('วันที่รับเงินแถว '+(rows.length+1)+' ไม่ถูกต้อง กรุณาใช้วัน/เดือน/ปี 4 หลัก');
      if (kind === 'PAY') rows.push({ pay_date: thIsoW(r[col('วันที่จ่าย')]), case_no: firstLine(r[col('เลขดำที่')]), recipient: NoticeImportFormat.recipient(firstLine(r[col('เลขดำที่')]), r[col('ส่งหมายถึงใคร')]),
        received_date: thIsoW(r[col('วันที่รับเงิน')]), receipt_no: String(r[col('เลขที่ใบเสร็จ')] || '').trim(), amount: amtOf(r[col('ราคา')]), officer: officer });
      else rows.push({ case_no: firstLine(r[col('เลขดำที่')]), notice_kind: String(r[col('หมายอะไร')] || '').trim(), recipient: NoticeImportFormat.recipient(firstLine(r[col('เลขดำที่')]), r[col('หมายถึงใคร')]),
        tambon: String(r[col('ตำบล')] || '').trim(), amount: amtOf(r[col('ราคา')]), officer: String(r[col('เจ้าของหมาย')] || '').trim(), result: String(r[col('ผลการส่งหมาย')] || '').trim() });
    });
    if (kind === 'FREE18') { const m = aoa.slice(0, hi).map(text).join(' ').match(/จำนวนรวม\s*(\d[\d,]*)\s*หมาย/); if (m && footerN === null) footerN = amtOf(m[1]); }
    const sum = Math.round(rows.reduce((a, x) => a + x.amount, 0) * 100) / 100;
    const period = aoa.slice(0, Math.max(hi, 0)).map(text).map((t) => t.match(/ตั้งแต่วันที่\s*(.+?)\s*ถึงวันที่\s*(.+?)$/)).filter(Boolean)[0] || [];
    const badDate = kind === 'PAY' ? rows.filter((x) => !x.pay_date).length : 0;
    const grpBad = groups.filter((g) => Math.abs(rows.filter((x) => x.officer === g.officer).reduce((a, x) => a + x.amount, 0) - g.amount) > 0.005).map((g) => g.officer);
    return { rows: rows, sum: sum, footer: footer, footerN: footerN, groups: groups, grpBad: grpBad, badDate: badDate,
             title: title, period: period[1] ? period[1] + ' – ' + period[2] : '', period_from: period[1] || '', period_to: period[2] || '', wrongKind: kind === 'PAY' ? /หมายฟรี/.test(title) && !/จ่ายเงินให้เจ้าพนักงานศาล/.test(title) : /บัญชีการจ่ายเงินให้เจ้าพนักงานศาล/.test(title) };
  }
  async function ledgerFile(revision) {
    const kind = IM.kind; revision = revision || importEpoch;
    try {
      const aoa = XLSX.utils.sheet_to_json(IM.wb.Sheets[IM.sheet], { header: 1, raw: true, defval: '' });
      const p = IM.ledger = parseLedger(kind, aoa, IM.wb);
      const totOk = p.footer === null || Math.abs(p.footer - p.sum) < 0.005;
      const nOk = p.footerN === null || p.footerN === p.rows.length;
      IM.ledgerOk = totOk && nOk && !p.badDate && !p.grpBad.length && !p.wrongKind && p.rows.length > 0;
      $('#fInfo').innerHTML = '<div class="note ' + (IM.ledgerOk ? 'g' : 'r') + '" style="margin-top:10px"><b>' + esc(IM.file.name) + '</b> · ' + num(p.rows.length) + ' เรื่อง · รวม ' + baht2(p.sum) + ' บาท' +
        (p.period ? ' · ช่วงรายงาน ' + esc(p.period) : '') + '<br><span class="tiny">' +
        (p.footer !== null ? 'ยอดท้ายไฟล์ ' + baht2(p.footer) + ' บาท ' + (totOk ? '✓ ตรงผลรวมทุกแถว' : '✗ ไม่ตรงผลรวมแถว (ต่าง ' + baht2(p.footer - p.sum) + ')') : 'ไม่พบยอดท้ายไฟล์') +
        (p.footerN !== null ? ' · จำนวนท้ายไฟล์ ' + num(p.footerN) + (nOk ? ' ✓' : ' ✗') : '') +
        (kind === 'PAY' ? ' · ผู้ส่ง ' + num(p.groups.length) + ' คน' + (p.grpBad.length ? ' ✗ ยอดรายคนไม่ตรงหัวกลุ่ม: ' + esc(p.grpBad.join(', ')) : ' ✓ ยอดรายคนตรงหัวกลุ่ม') + (p.badDate ? ' · ✗ อ่านวันที่จ่ายไม่ได้ ' + num(p.badDate) + ' แถว' : '') : '') +
        (p.wrongKind ? '<br><b>ไฟล์นี้ดูเหมือนเป็นอีกชนิด — ตรวจว่าเลือกชนิดไฟล์ถูก</b>' : '') + '</span></div>' +
        '<p class="tiny muted" style="margin:8px 2px 0">ส่งเข้าระบบเฉพาะ เลขดำ · รหัสจับคู่แทนชื่อ · ' + (kind === 'PAY' ? 'วันที่จ่าย · ใบเสร็จ · ' : 'ชนิดหมาย · ตำบล · ผล · ') + 'ราคา · ผู้ส่ง (ไม่ส่งชื่อโจทก์/จำเลย/ผู้รับหมาย/ผู้วางเงิน)</p>';
      if (!IM.ledgerOk) { $('#imPrev').innerHTML = ''; return; }
      $('#imPrev').innerHTML = '<div class="clay panel"><span class="spin"></span> <span class="muted">กำลังจับคู่กับหมายในระบบ…</span></div>';
      const r = await api('ledger_import', { kind: kind, rows: p.rows, file: IM.file, sheet: IM.sheet, period_from: p.period_from, period_to: p.period_to });
      if (revision !== importEpoch) return;
      IM.ledgerBody = {kind:kind, rows:p.rows, file:IM.file, sheet:IM.sheet, commit:true, period_from:p.period_from, period_to:p.period_to, preview_token:r.preview_token, preview_snapshot:r.preview_snapshot || ''};
      drawLedgerPreview(r);
    } catch (e) { $('#fInfo').innerHTML = '<p class="note r">' + esc(e.message) + '</p>'; }
  }
  function drawLedgerPreview(r) {
    const s = r.summary;
    const price = r.kind === 'FREE18' ? (r.price_changes || null) : null;
    const priceDetails = price ? '<div class="note" style="margin-top:12px"><b>ตรวจราคาหมายฟรีก่อนยืนยันใช้ยอดใหม่</b><br>' +
      'หมายฟรีที่จับคู่ได้และยังไม่เข้ารอบ ' + num(price.matched_unlocked) + ' รายการ · ยอดเปลี่ยน ' + num(price.count) + ' รายการ<br>' +
      'ยอดเดิมที่ใช้คำนวณ ' + baht2(price.previous) + ' บาท → ยอดใหม่จากแบบ 18 ' + baht2(price.proposed) + ' บาท' +
      ' · ส่วนต่าง ' + (price.difference > 0 ? '+' : '') + baht2(price.difference) + ' บาท' +
      (r.compare.locked ? '<br><b>ไม่แก้รอบที่ยืนยันแล้ว ' + num(r.compare.locked) + ' รายการ</b>' : '') +
      (r.compare.non_budget ? '<br><b>ข้ามรายการที่ไม่ใช่หมายฟรี ' + num(r.compare.non_budget) + '</b>' : '') +
      '<p class="tiny muted">ยอดเปลี่ยนเฉพาะหมายฟรีที่ยังไม่เข้ารอบ · ตรวจรายการที่จับคู่ไม่ได้ก่อนใช้ยอดจริง · ยังไม่จัดรอบ 60/40</p></div>' +
      ((price.samples || []).length ? '<details style="margin-top:10px"><summary>ดูรายการยอดเดิม → ยอดใหม่ (แสดงสูงสุด 30 รายการ)</summary><div class="tbl-wrap"><table><thead><tr><th>เลขคดี</th><th class="n">ยอดเดิม</th><th class="n">ยอดใหม่</th><th class="n">ผลต่าง</th></tr></thead><tbody>' +
        price.samples.map(x => '<tr><td>' + esc(x.case_no) + '</td><td class="n">' + baht2(x.previous) + '</td><td class="n">' + baht2(x.proposed) + '</td><td class="n">' +
          (Number(x.difference) > 0 ? '+' : '') + baht2(x.difference) + '</td></tr>').join('') + '</tbody></table></div></details>' : '') : '';
    const none = (r.samples_none || []).map((x) => '<tr><td>' + esc(x.pay_date ? thDate(x.pay_date) : '') + '</td><td>' + esc(x.case_no) + '</td><td class="small">' + esc(x.recipient) + '</td><td class="small">' + esc(x.received_date ? 'รับเงิน ' + thDate(x.received_date) : (x.notice_kind || '')) + '</td><td class="n">' + baht2(x.amount) + '</td><td class="small">' + 'รอยืนยัน · ' + esc(x.match_reason || (x.match === 'TYPE' ? 'ประเภทหรือผู้ส่งไม่ตรง' : 'ยังไม่พบหมายที่ตรงกัน')) + '</td></tr>').join('');
    $('#imPrev').innerHTML = '<div class="clay panel"><h3>3 · ผลตรวจ ' + esc(r.kind_th) + '</h3>' +
      '<p class="small" style="margin:0 0 8px">ที่มา: <b>' + esc(r.source) + '</b></p>' +
      '<div class="chips"><span class="chip on"><span>ทั้งหมด</span><b>' + num(s.rows) + '</b></span><span class="chip c-NEW"><span>จับคู่ได้</span><b>' + num(s.ok) + '</b></span><span class="chip c-AMBIGUOUS"><span>รอยืนยันการจับคู่</span><b>' + num(s.none) + '</b></span>' + (s.no_officer ? '<span class="chip c-ERROR"><span>ไม่รู้จักผู้ส่ง</span><b>' + num(s.no_officer) + '</b></span>' : '') + '</div>' +
      (r.kind === 'PAY' ? '<div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>วันที่จ่าย</th><th class="n">เรื่อง</th><th class="n">บาท</th><th class="n">รอยืนยัน</th><th>สถานะ</th></tr></thead><tbody>' +
          r.dates.map((x) => '<tr><td>' + esc(thDate(x.pay_date)) + '</td><td class="n">' + num(x.rows) + '</td><td class="n">' + baht2(x.amount) + '</td><td class="n">' + (x.none ? num(x.none) + ' (' + baht2(x.none_amount) + ')' : '—') + '</td><td>' + (x.locked ? '<span class="pchip pok">ตั้งรอบแล้ว · ไม่แก้</span>' : '<span class="pchip pm">รอตั้งรอบ</span>') + '</td></tr>').join('') + '</tbody></table></div>' +
          (s.none ? '<p class="note" style="margin:10px 0 0">รายการรอยืนยันยังแสดงยอดตามบัญชีจ่าย ไม่ได้แปลว่ายังไม่จ่ายเงิน ควรตรวจวันจ่ายหมาย วันส่ง และไฟล์ 50 ของช่วงที่เกี่ยวข้อง (นำเข้าไฟล์ 50 เพิ่ม แล้วนำเข้าไฟล์นี้ซ้ำ จะจับคู่ได้)</p>' : '')
        : '<p class="small" style="margin:12px 0 0">เทียบกับยอดที่ระบบคำนวณ: ตรง ' + num(r.compare.same) + ' · ศาลคิดมากกว่า ' + num(r.compare.court_more) + ' · ศาลคิดน้อยกว่า ' + num(r.compare.court_less) + ' เรื่อง' +
          (r.compare.locked ? ' · เข้ารอบเบิกแล้ว (ไม่แก้) ' + num(r.compare.locked) : '') + '<br><span class="tiny muted">หมายฟรีในระบบ ' + num(r.compare.system_free) + ' เรื่อง · ไม่อยู่ในไฟล์ ' + num(r.compare.system_not_in_file) + ' (ใช้ยอดที่ระบบคำนวณ) · ศาลรวมหมายตามข้อ 7 แล้ว ฉบับที่รวมได้ราคา 0</span></p>') +
      priceDetails +
      (none ? '<h3 style="margin-top:16px">รอยืนยันการจับคู่ (แสดง ' + num((r.samples_none || []).length) + ' แถวแรก)</h3><div class="tbl-wrap"><table><thead><tr><th>วันที่จ่าย</th><th>เลขดำ</th><th>ผู้รับ</th><th></th><th class="n">บาท</th><th></th></tr></thead><tbody>' + none + '</tbody></table></div>' : '') +
      '<div class="row" style="margin-top:14px;gap:8px"><button type="button" class="btn btn-g" id="lgOk">' + (r.kind === 'FREE18' ? 'ยืนยันใช้ยอดใหม่ (หมายฟรี)' : 'ยืนยันนำเข้า') + '</button><span class="small muted">' + (r.kind === 'PAY' ? 'วันที่จ่ายที่ตั้งรอบแล้วจะไม่ถูกแก้ · วันที่ยังไม่ตั้งรอบเพิ่มหรือปรับตามใบเสร็จ โดยเก็บรายการที่ไม่อยู่ในไฟล์ไว้' : 'ราคาศาลใช้แทนยอดระบบในรอบหมายฟรี · หมายที่เบิกแล้วไม่ถูกแก้') + '</span></div></div>';
    $('#lgOk').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      if (r.kind === 'FREE18') {
        if (!r.preview_snapshot || !r.price_changes) { toast('ไม่มีผลตรวจยอดเดิม–ใหม่ กรุณาเลือกไฟล์ 18 อีกครั้ง'); return; }
        const p = r.price_changes;
        const ok = await askBox('ยืนยันใช้ยอดหมายฟรีจากแบบ 18?\\nยอดเดิม ' + baht2(p.previous) + ' บาท → ยอดใหม่ ' + baht2(p.proposed) +
          ' บาท\\nเปลี่ยน ' + num(p.count) + ' รายการ · ข้ามรายการเข้ารอบแล้ว ' + num(r.compare.locked || 0) + '\\nยังไม่คำนวณหรือยืนยันรอบ 60/40');
        if (!ok) return;
      }
      b.disabled = true; b.innerHTML = '<span class="spin"></span> กำลังนำเข้า…';
      try {
        const x = await api('ledger_import', IM.ledgerBody);
        try { IM.meta = await api('import_templates'); paintKinds(); } catch (e2) { /* แสดงสถานะครั้งหน้า */ }
        toast('นำเข้าแล้ว ' + num(x.imported) + ' รายการ' + (x.skipped_locked ? ' · ข้ามวันที่ตั้งรอบแล้ว ' + num(x.skipped_locked) : ''));
        $('#imPrev').innerHTML = '<div class="clay panel"><p class="note g" style="margin:0"><b>นำเข้าเรียบร้อย</b> ชุด ' + esc(x.batch_id) + ' · ' + num(x.imported) + ' รายการ' + (x.skipped_locked ? ' · ข้ามวันที่ตั้งรอบแล้ว ' + num(x.skipped_locked) : '') +
          ' — ไปที่ <a href="#" id="lgGo">รอบเบิก / วันจ่าย 60:40</a> เพื่อตั้งรอบ</p></div>';
        $('#lgGo').addEventListener('click', (ev) => { ev.preventDefault(); S.payoutSub = 'list'; go('payout'); });
      } catch (x) { toast(x.message); b.disabled = false; b.textContent = 'ยืนยันนำเข้า'; }
    });
  }

  function cellVal(v) {
    if (v instanceof Date) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
    if (v === null || v === undefined) return '';
    return typeof v === 'string' ? v.trim() : v;
  }
  /** อ่านแผ่นงานแบบไม่แตะหน้าจอ (ใช้ทั้งนำเข้าทีละไฟล์และหลายไฟล์ 0.7.20) */
  function sheetState(wb, sheet) {
    const IM = { meta: IMPORT_META() };
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true, defval: '' });
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
      if (seq >= 0 ? !/^\d+$/.test(digits(r[seq]).trim()) : r.filter((c) => String(c).trim() !== '').length < 3) { IM.skipped++; return; }
      const o = {}; IM.headers.forEach((h, i) => { o[h] = cellVal(r[i]); });
      IM.rows.push(o); IM.rowNos.push(best + k + 2);
    });
    return IM;
  }
  function loadSheet() {
    Object.assign(IM, sheetState(IM.wb, IM.sheet));
    autoMap();
    $('#fInfo').innerHTML = '<div class="row small" style="margin-top:12px"><span class="pill g">' + esc(IM.file.name) + '</span>' +
      '<label for="shSel">แผ่นงาน</label><select id="shSel" class="sel">' + IM.wb.SheetNames.map((s) => '<option' + (s === IM.sheet ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select>' +
      '<span>หัวตารางแถวที่ ' + (IM.headerRow + 1) + ' · ข้อมูล ' + num(IM.rows.length) + ' แถว' + (IM.skipped ? ' · ข้ามแถวท้ายรายงาน ' + num(IM.skipped) + ' แถว' : '') + '</span>' +
      (IM.period ? '<span class="period small">ช่วงรายงาน ' + esc(IM.period.from) + ' – ' + esc(IM.period.to) + '</span>' : '') + '</div>';
    $('#shSel').addEventListener('change', (e) => { IM.sheet = e.target.value; loadSheet(); });
    drawMap();
  }

  function autoMap() { Object.assign(IM, mapState(IM.kind, IM.headers, IM.period)); }
  function mapState(kind, headers, period) {
    const IM = { meta: IMPORT_META(), kind: kind, headers: headers, period: period };
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
    return { mapping: IM.mapping, keys: IM.keys, opts: IM.opts };
  }

  function drawMap() {
    $('#imPrev').innerHTML = '';
    const RES_F = ['case_no', 'notice_no', 'notice_kind', 'recipient', 'officer', 'issued_date', 'delivered_date', 'reported_date', 'result'];
    const fields = IM.meta.fields.filter((fd) => !['recipient','payer'].includes(fd.f) && (IM.kind === 'ISSUE' ? fd.f !== 'reported_date' : RES_F.includes(fd.f)));
    const isRes = IM.kind === 'RESULT';
    const visibleHeaders = IM.headers.filter(h => !/โจทก์|จำเลย|คู่ความ|plaintiff|defendant/i.test(h) && ![IM.mapping.recipient,IM.mapping.payer].includes(h));
    fields.forEach(fd=>{if(IM.mapping[fd.f]&&!visibleHeaders.includes(IM.mapping[fd.f]))IM.mapping[fd.f]='';});
    const opt = (sel) => '<option value="">— ไม่มีในไฟล์ —</option>' + visibleHeaders.map((h) => '<option' + (h === sel ? ' selected' : '') + '>' + esc(h) + '</option>').join('');
    const sample = IM.rows.slice(0, 2);
    $('#imMap').innerHTML = '<div class="clay panel"><h3>3 · จับคู่คอลัมน์</h3>' +
      '<p class="small muted" style="margin:0 0 12px">ระบบเดาให้จากชื่อหัวคอลัมน์และครั้งก่อน ตรวจแล้วแก้ได้ · ระบบจำการจับคู่ไว้ใช้ครั้งต่อไป · ' +
        (isRes ? 'ไฟล์ผลหมายจับคู่กับหมายเดิมด้วย <b>เลขคดี + รหัสจับคู่ + ผู้ส่ง</b> (ไฟล์ผลไม่มีที่อยู่)' : '✓ = ใช้เป็นคีย์ไม่ซ้ำ (ไฟล์ของศาลไม่มีเลขหมาย ใช้ เลขคดี + รหัสจับคู่ + ผู้ส่ง + ชนิดหมาย + บ้านเลขที่ + หมู่)') +
        ' · <b>ตัดชื่อโจทก์/จำเลย/ผู้รับหมายก่อนส่ง ใช้รหัสจับคู่แทนชื่อ</b> · ราคา 0.00 = หมายฟรี (เงินงบประมาณ)</p>' +
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
      const identity = IM.keys.filter(k => ['recipient','payer'].includes(k));
      IM.keys = identity.concat(Array.from($('#imMap').querySelectorAll('.kchk:checked')).map((x) => x.dataset.f)); IM.preview = null; $('#imPrev').innerHTML = '';
    }));
    if ($('#fOff')) $('#fOff').addEventListener('change', (e) => { IM.opts.file_officer_id = e.target.value; IM.preview = null; $('#imPrev').innerHTML = ''; });
    if ($('#fPay')) $('#fPay').addEventListener('change', (e) => { IM.opts.default_pay_type = e.target.value; IM.preview = null; $('#imPrev').innerHTML = ''; });
    $('#doPrev').addEventListener('click', doPreview);
  }

  function importBody() { return bodyOf(IM); }
  function bodyOf(IM) {
    const map = {}; Object.keys(IM.mapping).forEach((k) => { if (IM.mapping[k]) map[k] = IM.mapping[k]; });
    // Remove party names locally, before any request; dates use the shared parser.
    const date1904 = !!(IM.wb && IM.wb.Workbook && IM.wb.Workbook.WBProps && IM.wb.Workbook.WBProps.date1904);
    const rows = IM.rows.map((r, i) => {
      try { return NoticeImportFormat.mapped(r, map, date1904); }
      catch (e) { throw new Error('แถว '+(IM.rowNos[i] || i+2)+': '+e.message); }
    });
    return { kind: IM.kind, mapping: map, key_fields: IM.keys, options: IM.opts, rows: rows, row_nos: IM.rowNos,
             file: { name: IM.file.name, size: IM.file.size, checksum: IM.file.checksum, sheet: IM.sheet } };
  }

  async function doPreview() {
    const revision = importEpoch;
    const b = $('#doPrev'); b.disabled = true;
    $('#imPrev').innerHTML = '<div class="clay panel"><span class="spin"></span> กำลังตรวจ ' + num(IM.rows.length) + ' แถว…</div>';
    try {
      const body = importBody(), fingerprint = JSON.stringify(body);
      const result = await api('import_preview', body);
      if (revision !== importEpoch || JSON.stringify(importBody()) !== fingerprint) return;
      IM.preview = result; IM.previewBody = body; IM.previewFingerprint = fingerprint;
      IM.cls = ['NEW', 'CHANGED', 'HELD', 'AMBIGUOUS', 'ERROR', 'SAME', 'OUTSIDE'].find((c) => IM.preview.counts[c]) || 'NEW';
      drawPreview();
    } catch (e) { if (revision !== importEpoch) return; $('#imPrev').innerHTML = '<div class="clay panel"><p class="note r" style="margin:0">' + esc(e.message) + '</p></div>'; }
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
      (list.length ? list.map((r) => '<tr><td>' + r.row_no + '</td><td>' + esc(r.case_no) + (r.case_ref ? '<br><span class="tiny muted">' + esc(r.case_ref) + '</span>' : '') + '</td><td class="small">' + esc(r.notice_kind) + '</td><td class="small">' + esc(r.recipient) + '</td><td class="small onm">' + esc(r.officer) + '</td><td>' + esc(PAY_TH[r.pay_type] || '') +
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
      if (!IM.preview || IM.previewFingerprint !== JSON.stringify(importBody())) throw new Error('ข้อมูลเปลี่ยน กรุณาตรวจสอบก่อนนำเข้าใหม่');
      const r = await api('import_commit', Object.assign({}, IM.previewBody, {preview_token:IM.preview.preview_token}));
      api('import_templates').then((x) => { IM.meta=x; paintKinds(); }).catch(() => {});
      $('#imPrev').innerHTML = '<div class="clay panel"><h3>นำเข้าเรียบร้อย</h3><p class="note g" style="margin:0 0 12px">เลขชุด ' + esc(r.batch_id) +
        ' · เพิ่มใหม่ ' + num(r.inserted) + ' · ปรับปรุง ' + num(r.updated) + ' · รออนุมัติแก้ ' + num(r.held_changes) + ' · แถวรอตรวจสอบ ' + num(r.review_rows) + (r.review_auto_resolved ? ' · ระบบจับคู่แถวที่ค้างให้แล้ว ' + num(r.review_auto_resolved) + ' แถว' : '') + '</p>' +
        ledgerCheckHtml(r.ledger_check) +
        (r.calc ? (r.calc.error ? '<p class="note r" style="margin:0 0 12px">คำนวณค่าหมายไม่สำเร็จ: ' + esc(r.calc.error) + '</p>'
          : '<p class="note g" style="margin:0 0 12px">คำนวณค่าหมายใหม่แล้ว · หน่วยเบิกหมายฟรี ' + num(r.calc.units) + ' หน่วย' + (r.calc.warnings ? ' · ข้อควรตรวจ ' + num(r.calc.warnings) + ' รายการ' : '') + '</p>') : '') +
        '<div class="row"><button type="button" class="btn btn-g" id="again">นำเข้าไฟล์ถัดไป</button><button type="button" class="btn" id="toCalc">ดูยอดค่าหมาย</button><button type="button" class="btn" id="toHome">ไปหน้าแรก</button></div></div>';
      $('#imMap').innerHTML = ''; $('#imFile').innerHTML = '';
      $('#again').addEventListener('click', () => go('import'));
      $('#toHome').addEventListener('click', () => go('home'));
      $('#toCalc').addEventListener('click', () => go('calc'));
    } catch (e) { b.disabled = false; b.textContent = 'ยืนยันนำเข้า'; toast(e.message); }
  }

  /* ---------------------------------------------------------------- นำเข้าหลายไฟล์พร้อมกัน (0.7.20) */
  /* เลือกหลายไฟล์ → ระบบรู้ชนิดเอง → ตรวจทุกไฟล์ → ป้าย 3 สีตามผลกระทบ → ยืนยันครั้งเดียว นำเข้าตามลำดับ 50 → 42 → 18 → 30
   * ใช้ API เดิมทุกตัว (import_preview/import_commit/ledger_import) ด้วยข้อมูลชุดเดียวกับนำเข้าทีละไฟล์ จึงได้ยอดเท่ากัน
   * ยอดที่ยืนยันรอบหรือจ่ายแล้วไม่เปลี่ยนทุกกรณี (ระบบล็อกฝั่งเซิร์ฟเวอร์) */
  const BATCH_ORDER = ['ISSUE', 'RESULT', 'FREE18', 'PAY'];
  const BATCH_KIND_TH = { ISSUE: '50 · จ่ายหมาย', RESULT: '42 · ผลหมาย', FREE18: '18 · ราคาหมายฟรี', PAY: '30 · บัญชีจ่ายเงิน' };
  const BT = { files: [], epoch: 0 };
  /** ชนิดไฟล์จากหัวตาราง (15 แถวแรกของแผ่นแรก) */
  function detectImportKind(aoa) {
    for (let r = 0; r < Math.min(15, aoa.length); r++) {
      const H = (aoa[r] || []).map(normH), has = (h) => H.indexOf(normH(h)) >= 0;
      if (!has('เลขดำที่')) continue;
      if (has('วันที่จ่าย') && has('ส่งหมายถึงใคร')) return 'PAY';
      if (has('เจ้าของหมาย') && has('หมายถึงใคร')) return 'FREE18';
      if (has('ส่งหมายให้ใคร') && has('วันที่ส่งหมาย')) return 'RESULT';
      if (has('หมายถึงใคร') && has('ผู้ส่งหมาย')) return 'ISSUE';
    }
    return '';
  }
  const fyStartIso = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})/); if (!m) return ''; const y = +m[2] >= 10 ? +m[1] : +m[1] - 1; return y + '-10-01'; };
  const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  /** ป้าย 3 สี: green ซ้ำไม่เปลี่ยนยอด · amber มีรายการใหม่/แก้ไข (ยอดรอเบิก) · red ขัดกับรอบที่จ่ายแล้ว (ส่งไปรออนุมัติ ต้องติ๊กยืนยัน) */
  function batchImpact(x) {
    const p = x.preview || {};
    if (x.kind === 'ISSUE' || x.kind === 'RESULT') {
      const c = p.counts || {}, real = p.real || { CHANGED: c.CHANGED, HELD: c.HELD };
      if (real.HELD) return 'red';
      return (c.NEW || real.CHANGED || c.AMBIGUOUS || c.ERROR) ? 'amber' : 'green';
    }
    if (x.kind === 'PAY') return (p.dates || []).some((d) => !d.locked && (d.new_rows || d.changed_rows)) ? 'amber' : 'green';
    return p.changed ? 'amber' : 'green';
  }
  /** ช่วงวันที่ของไฟล์ (ISO) · ย้อนหลัง = เริ่มก่อนวันสุดท้ายของไฟล์ชนิดเดียวกันที่เคยนำเข้า */
  function batchPeriod(x) {
    let from = '', to = '';
    if (x.state && x.state.period) { from = thIso(x.state.period.from, x.wb); to = thIso(x.state.period.to, x.wb); }
    if (x.ledger) {
      from = thIso(x.ledger.period_from, x.wb) || from; to = thIso(x.ledger.period_to, x.wb) || to;
      if (!from && x.kind === 'PAY') { const ds = x.ledger.rows.map((r) => r.pay_date).filter(Boolean).sort(); from = ds[0] || ''; to = ds[ds.length - 1] || ''; }
    }
    return { from: from, to: to };
  }
  function batchTags(x) {
    const tags = [], last = ((IM.meta && IM.meta.last) || {})[x.kind];
    if (x.period.from && last && last.to && x.period.from < String(last.to).slice(0, 10)) tags.push(['a', 'ย้อนหลัง · เคยนำเข้าถึง ' + thLong(last.to)]);
    if (x.period.from && x.period.from < fyStartIso(todayIso())) tags.push(['b', 'มีช่วงปีงบก่อน']);
    if (x.preview && x.preview.duplicate_file) tags.push(['g', 'ไฟล์เดิม เคยนำเข้าเมื่อ ' + thDate(x.preview.duplicate_file.at, true)]);
    return tags;
  }
  const batchPanelHtml = () => '<div class="clay panel" id="bt"><h3>นำเข้าหลายไฟล์พร้อมกัน <span class="pill g" style="font-size:12px">ใหม่</span></h3>' +
    '<p class="small muted" style="margin:-4px 2px 10px">เลือกไฟล์ 50 · 42 · 18 · 30 ได้พร้อมกัน ไม่ต้องเลือกชนิดก่อน · ช่วงวันที่ย้อนหลังได้ ระบบตรวจและแจ้งผลกระทบก่อนบันทึก · ยอดที่ยืนยันรอบ/จ่ายแล้วไม่เปลี่ยน</p>' +
    '<label class="drop sunk" id="btDrop"><input type="file" id="btIn" accept=".xlsx,.xls,.csv" class="sr" multiple>' +
    '<b>แตะเพื่อเลือกหลายไฟล์ หรือลากมาวางพร้อมกัน</b><span class="small muted">ระบบนำเข้าตามลำดับ 50 → 42 → 18 → 30 ให้เอง</span></label><div id="btList"></div></div>';
  function bindBatch() {
    const drop = $('#btDrop'); if (!drop) return;
    $('#btIn').addEventListener('change', (e) => { if (e.target.files.length) batchRead(Array.from(e.target.files)); e.target.value = ''; });
    ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => e.dataTransfer.files.length && batchRead(Array.from(e.dataTransfer.files)));
  }
  async function batchRead(files) {
    if (BT.busy) { toast('กำลังนำเข้าไฟล์ชุดเดิม'); return; }
    if (!window.XLSX) { toast('กำลังโหลดตัวอ่าน Excel กรุณาลองอีกครั้ง'); return; }
    const ep = ++BT.epoch; BT.files = []; BT.done = false;
    $('#btList').innerHTML = '<p class="small"><span class="spin"></span> กำลังอ่านและตรวจ ' + num(files.length) + ' ไฟล์…</p>';
    for (const f of files) {
      const x = { name: f.name, size: f.size, kind: '', status: 'wait', err: '', include: true, tick: false };
      BT.files.push(x);
      try {
        const buf = await f.arrayBuffer();
        const dig = await crypto.subtle.digest('SHA-256', buf);
        x.file = { name: f.name, size: f.size, checksum: Array.from(new Uint8Array(dig)).map((b) => b.toString(16).padStart(2, '0')).join('') };
        x.wb = XLSX.read(buf, { type: 'array', cellDates: false });
        x.sheet = x.wb.SheetNames[0];
        const aoa = XLSX.utils.sheet_to_json(x.wb.Sheets[x.sheet], { header: 1, raw: true, defval: '' });
        x.kind = detectImportKind(aoa);
        if (!x.kind) throw new Error('ไม่รู้จักชนิดไฟล์ — รองรับ 50 · 42 · 18 · 30');
        if (x.kind === 'PAY' || x.kind === 'FREE18') {
          const p = x.ledger = parseLedger(x.kind, aoa, x.wb);
          const totOk = p.footer === null || Math.abs(p.footer - p.sum) < 0.005, nOk = p.footerN === null || p.footerN === p.rows.length;
          if (!(totOk && nOk && !p.badDate && !p.grpBad.length && !p.wrongKind && p.rows.length > 0))
            throw new Error(!totOk ? 'ยอดท้ายไฟล์ไม่ตรงผลรวมแถว' : !nOk ? 'จำนวนท้ายไฟล์ไม่ตรง' : p.badDate ? 'อ่านวันที่จ่ายไม่ได้ ' + p.badDate + ' แถว' : p.grpBad.length ? 'ยอดรายคนไม่ตรงหัวกลุ่ม' : p.wrongKind ? 'ชนิดไฟล์ไม่ตรงหัวรายงาน' : 'ไม่มีแถวข้อมูล');
          const r = await api('ledger_import', { kind: x.kind, rows: p.rows, file: x.file, sheet: x.sheet, period_from: p.period_from, period_to: p.period_to });
          x.preview = r;
          x.body = { kind: x.kind, rows: p.rows, file: x.file, sheet: x.sheet, commit: true, period_from: p.period_from, period_to: p.period_to, preview_token: r.preview_token, preview_snapshot: r.preview_snapshot || '' };
          x.money = p.sum; x.rowsN = p.rows.length;
        } else {
          const st = x.state = sheetState(x.wb, x.sheet);
          Object.assign(st, mapState(x.kind, st.headers, st.period), { kind: x.kind, wb: x.wb, sheet: x.sheet, file: x.file });
          const need = ['case_no', 'officer'].concat(x.kind === 'ISSUE' ? ['notice_kind'] : ['delivered_date']).filter((f) => !st.mapping[f]);
          if (need.length) throw new Error('จับคู่คอลัมน์อัตโนมัติไม่ครบ (' + need.join(', ') + ') — ใช้การ์ดนำเข้าทีละไฟล์ด้านล่าง');
          const body = bodyOf(st), r = await api('import_preview', body);
          x.preview = r; x.body = Object.assign({}, body, { preview_token: r.preview_token });
          x.rowsN = r.rows_total; x.money = r.totals ? r.totals.PAID.amount : null;
        }
        x.period = batchPeriod(x); x.impact = batchImpact(x); x.status = 'ready';
      } catch (e) { x.status = 'error'; x.err = e.message; x.include = false; }
      x.wb = null; if (x.state) { x.state.wb = null; }
      if (ep !== BT.epoch) return;
    }
    BT.files.sort((a, b) => (BATCH_ORDER.indexOf(a.kind) + 1 || 9) - (BATCH_ORDER.indexOf(b.kind) + 1 || 9) || String(a.period && a.period.from).localeCompare(String(b.period && b.period.from)));
    drawBatch();
  }
  const IMPACT_TH = { green: ['g', '🟢 ซ้ำ ไม่เปลี่ยนยอด'], amber: ['a', '🟡 มีรายการใหม่/แก้ไข · เข้ายอดรอเบิก'], red: ['r', '🔴 ขัดกับรอบที่จ่ายแล้ว · ส่งไปรออนุมัติ'] };
  function batchDetail(x) {
    const p = x.preview || {};
    if (x.kind === 'ISSUE' || x.kind === 'RESULT') {
      const c = p.counts || {};
      const real = p.real || { CHANGED: c.CHANGED, HELD: c.HELD };
      return 'ใหม่ ' + num(c.NEW) + ' · เดิมตรงกัน ' + num((c.SAME || 0) + (c.CHANGED - real.CHANGED) + (c.HELD - real.HELD)) + ' · ปรับปรุง ' + num(real.CHANGED) + ' · ขัดกับรอบที่จ่ายแล้ว ' + num(real.HELD) + ' · รอตรวจ ' + num((c.AMBIGUOUS || 0) + (c.ERROR || 0)) + (c.OUTSIDE ? ' · ก่อนปีงบเริ่มระบบ ' + num(c.OUTSIDE) : '') +
        (p.totals ? '<br>หมายมีเงิน ' + num(p.totals.PAID.n) + ' รายการ ' + num(p.totals.PAID.amount) + ' บาท · หมายฟรี ' + num(p.totals.BUDGET.n) + ' รายการ' : '');
    }
    if (x.kind === 'PAY') {
      const ds = p.dates || [], lk = ds.filter((d) => d.locked), op = ds.filter((d) => !d.locked);
      return num(x.rowsN) + ' เรื่อง ' + baht2(x.money) + ' บาท · จับคู่ได้ ' + num(p.summary && p.summary.ok) + ' · รอยืนยันการจับคู่ ' + num(p.summary && p.summary.none) +
        '<br>วันที่จ่ายรอตั้งรอบ ' + num(op.length) + ' วัน · รายการใหม่ ' + num(op.reduce((a, d) => a + (d.new_rows || 0), 0)) + ' (' + baht2(op.reduce((a, d) => a + (d.new_amount || 0), 0)) + ' บาท)' +
        (op.some((d) => d.changed_rows) ? ' · ยอดเปลี่ยน ' + num(op.reduce((a, d) => a + (d.changed_rows || 0), 0)) : '') + (lk.length ? ' · ตั้งรอบแล้ว ข้าม ไม่แก้ ' + num(lk.length) + ' วัน' : '');
    }
    const k = p.compare || {};
    return num(x.rowsN) + ' เรื่อง ' + baht2(x.money) + ' บาท · ตรงยอดระบบ ' + num(k.same) + ' · ศาลคิดมากกว่า ' + num(k.court_more) + ' · น้อยกว่า ' + num(k.court_less) + (k.locked ? ' · เข้ารอบเบิกแล้ว (ไม่แก้) ' + num(k.locked) : '') + '<br>ราคาที่จะปรับจากครั้งก่อน ' + num(p.changed) + ' เรื่อง (เฉพาะหมายที่ยังไม่เข้ารอบ)' + (p.price_changes ? '<br><b>ยอดเดิม ' + baht2(p.price_changes.previous) + ' บาท → ยอดใหม่ ' + baht2(p.price_changes.proposed) + ' บาท · ผลต่าง ' + (p.price_changes.difference > 0 ? '+' : '') + baht2(p.price_changes.difference) + ' บาท</b> · จะขอยืนยันใช้ยอดใหม่อีกครั้งก่อนบันทึก' : '');
  }
  function batchCanCommit() {
    const on = BT.files.filter((x) => x.include && x.status === 'ready');
    return on.length > 0 && on.every((x) => x.impact !== 'red' || x.tick);
  }
  function drawBatch() {
    const rows = BT.files.map((x, i) => {
      const imp = IMPACT_TH[x.impact] || ['r', ''];
      const head = '<div class="row" style="gap:8px;align-items:center"><label class="row" style="gap:6px"><input type="checkbox" class="btInc" data-i="' + i + '"' + (x.include ? ' checked' : '') + (x.status !== 'ready' || BT.done ? ' disabled' : '') + '>' +
        '<b>' + esc(BATCH_KIND_TH[x.kind] || 'ไม่รู้จักชนิด') + '</b></label><span class="small muted">' + esc(x.name) + '</span></div>';
      if (x.status === 'error') return '<div class="bt-item bt-err">' + head + '<p class="note r" style="margin:6px 0 0">' + esc(x.err) + '</p></div>';
      const tags = batchTags(x).map((t) => '<span class="pill ' + t[0] + '">' + esc(t[1]) + '</span>').join(' ');
      return '<div class="bt-item bt-' + x.impact + '">' + head +
        '<div class="small" style="margin:4px 0">' + (x.period.from ? 'ช่วงวันที่ ' + esc(thLong(x.period.from)) + ' – ' + esc(thLong(x.period.to)) : 'ไม่ระบุช่วงวันที่ (ข้อมูล ณ วันที่ส่งออก)') + ' ' + tags + '</div>' +
        '<div class="row" style="gap:8px;align-items:center"><span class="pill ' + imp[0] + '">' + imp[1] + '</span></div>' +
        '<p class="small" style="margin:6px 0 0">' + batchDetail(x) + '</p>' +
        (x.result ? '<p class="note ' + (x.result.ok ? 'g' : 'r') + '" style="margin:8px 0 0">' + x.result.html + '</p>' : '') +
        (x.impact === 'red' && !BT.done ? '<label class="note r bt-tick" style="display:flex;gap:8px;margin:8px 0 0"><input type="checkbox" class="btTick" data-i="' + i + '"' + (x.tick ? ' checked' : '') + '>' +
          '<span>ยืนยันนำเข้าไฟล์นี้ — รายการที่ต่างจากรอบที่จ่ายแล้ว <b>ไม่แก้ยอด</b> ระบบบันทึกเป็นรายการปรับปรุงรออนุมัติ</span></label>' : '') + '</div>';
    }).join('');
    const ready = BT.files.filter((x) => x.status === 'ready'), on = ready.filter((x) => x.include);
    $('#btList').innerHTML = '<div class="bt-list">' + rows + '</div>' +
      (BT.done ? '<div class="row" style="margin-top:12px;gap:8px"><button type="button" class="btn btn-g" id="btCalc">ดูยอดค่าหมาย</button><button type="button" class="btn" id="btPay">รอบเบิก / วันจ่าย 60:40</button><button type="button" class="btn" id="btNew">นำเข้าชุดใหม่</button></div>'
        : ready.length ? '<div class="row" style="margin-top:12px;gap:8px;align-items:center"><button type="button" class="btn btn-g" id="btGo"' + (batchCanCommit() ? '' : ' disabled') + '>ยืนยันนำเข้า ' + num(on.length) + ' ไฟล์</button>' +
          '<span class="small muted">นำเข้าตามลำดับ 50 → 42 → 18 → 30 แล้วคำนวณยอดใหม่ · ยอดรอบที่ยืนยัน/จ่ายแล้วไม่เปลี่ยน' + (on.some((x) => x.impact === 'red' && !x.tick) ? ' · <b class="flag-r">ติ๊กยืนยันไฟล์สีแดงก่อน</b>' : '') + '</span></div>' +
          (on.some((x) => x.kind === 'RESULT') && on.some((x) => x.kind === 'ISSUE') ? '<p class="tiny muted" style="margin:6px 2px 0">ไฟล์ผลหมายอาจจับคู่ได้มากกว่าผลตรวจนี้ เพราะระบบนำเข้าไฟล์จ่ายหมายในชุดเดียวกันก่อน — ดูผลจริงหลังนำเข้า</p>' : '') : '');
    $('#btList').querySelectorAll('.btInc').forEach((c) => c.addEventListener('change', () => { BT.files[+c.dataset.i].include = c.checked; drawBatch(); }));
    $('#btList').querySelectorAll('.btTick').forEach((c) => c.addEventListener('change', () => { BT.files[+c.dataset.i].tick = c.checked; drawBatch(); }));
    if ($('#btGo')) $('#btGo').addEventListener('click', batchCommit);
    if ($('#btCalc')) $('#btCalc').addEventListener('click', () => go('calc'));
    if ($('#btPay')) $('#btPay').addEventListener('click', () => { S.payoutSub = 'list'; go('payout'); });
    if ($('#btNew')) $('#btNew').addEventListener('click', () => { BT.files = []; BT.done = false; BT.epoch++; $('#btList').innerHTML = ''; });
  }
  async function batchCommit() {
    if (!batchCanCommit() || BT.busy) return;
    BT.busy = true;
    const b = $('#btGo'); b.disabled = true; b.innerHTML = '<span class="spin"></span> กำลังนำเข้า…';
    const todo = BT.files.filter((x) => x.include && x.status === 'ready');
    let stop = '';
    for (const x of todo) {
      if (stop) { x.result = { ok: false, html: 'ยังไม่นำเข้า (หยุดเพราะไฟล์ก่อนหน้าไม่สำเร็จ)' }; continue; }
      try {
        const isLedger = x.kind === 'PAY' || x.kind === 'FREE18';
        // Reuse the approved file payload, but renew the preview after earlier commits.
        const probe = Object.assign({}, x.body);
        delete probe.preview_token; delete probe.preview_snapshot; delete probe.commit;
        if (isLedger) probe.commit = false;
        const current = await api(isLedger ? 'ledger_import' : 'import_preview', probe);
        if (!current.preview_token) throw new Error('ไม่พบรหัสผลตรวจล่าสุด กรุณาตรวจรุ่น API');
        x.preview = current; x.impact = batchImpact(x);
        if (x.impact === 'red' && !x.tick) throw new Error('ผลตรวจล่าสุดพบรายการขัดกับรอบที่จ่ายแล้ว กรุณาตรวจและยืนยันอีกครั้ง');
        x.body = Object.assign({}, x.body, {preview_token: current.preview_token});
        if (isLedger) {
          if (x.kind === 'FREE18') {
            // The exact, current snapshot is required. Never silently approve revised court prices.
            if (!current.preview_snapshot || !current.price_changes) throw new Error('ไม่พบยอดเปรียบเทียบแบบ 18 กรุณาตรวจข้อมูลอีกครั้ง');
            const p = current.price_changes, c = current.compare || {}, summary = current.summary || {};
            const approved = await askBox('ยืนยันใช้ยอดหมายฟรีล่าสุดจากแบบ 18?\\n' +
              'ยอดเดิมที่ใช้คำนวณ ' + baht2(p.previous) + ' บาท → ยอดใหม่ ' + baht2(p.proposed) + ' บาท\\n' +
              'ยอดเปลี่ยน ' + num(p.count) + ' รายการ · รอจับคู่ ' + num(summary.none || 0) + ' รายการ' +
              ' · ไม่แก้รอบที่ยืนยันแล้ว ' + num(c.locked || 0) + ' รายการ\\n' +
              'การยืนยันนี้ปรับเฉพาะราคาหมายฟรีที่ยังไม่เข้ารอบ และยังไม่ตั้งรอบ 60/40');
            if (!approved) {
              x.result = { ok: false, html: 'ยังไม่ยืนยันใช้ยอดใหม่แบบ 18 — ไม่ได้บันทึกไฟล์นี้' };
              stop = 'ยกเลิกการยืนยันยอดใหม่แบบ 18';
              continue;
            }
            x.body = Object.assign({}, x.body, { preview_snapshot: current.preview_snapshot });
          }
          const r = await api('ledger_import', x.body);
          x.result = { ok: true, html: '<b>นำเข้าแล้ว</b> ชุด ' + esc(r.batch_id) + ' · ' + num(r.imported) + ' รายการ' + (r.skipped_locked ? ' · ข้ามวันที่ตั้งรอบแล้ว ' + num(r.skipped_locked) : '') };
        } else {
          const r = await api('import_commit', x.body);
          x.result = { ok: !(r.calc && r.calc.error), html: '<b>นำเข้าแล้ว</b> ชุด ' + esc(r.batch_id) + ' · ใหม่ ' + num(r.inserted) + ' · ปรับปรุง ' + num(r.updated) + ' · รออนุมัติแก้ ' + num(r.held_changes) + ' · รอตรวจ ' + num(r.review_rows) +
            (r.review_auto_resolved ? ' · จับคู่แถวค้างให้แล้ว ' + num(r.review_auto_resolved) : '') + (r.calc && r.calc.error ? '<br>คำนวณค่าหมายไม่สำเร็จ: ' + esc(r.calc.error) : '') };
        }
        if (!x.result.ok) stop = 'คำนวณค่าหมายไม่สำเร็จ';
      } catch (e) { x.result = { ok: false, html: 'ไม่สำเร็จ: ' + esc(e.message) }; stop = e.message; }
    }
    BT.done = true; BT.busy = false;
    try { IM.meta = await api('import_templates'); paintKinds(); } catch (e2) { /* แสดงครั้งหน้า */ }
    toast(stop ? 'นำเข้าไม่ครบ — ดูรายละเอียดในรายการ' : 'นำเข้าครบ ' + num(todo.length) + ' ไฟล์');
    drawBatch();
  }

  /* ---------------------------------------------------------------- แถวรอตรวจ (0.6.3) */
  /* ระบบจับคู่ให้เองก่อนทุกครั้งที่นำเข้า · หน้านี้เหลือเฉพาะแถวที่ระบบตัดสินเองไม่ได้ ให้เลือกฉบับหรือปิดแถว */
  /* ---------------------------------------------------------------- รายการปรับปรุงรออนุมัติ (0.7.21) */
  /* นำเข้าย้อนหลังแล้วขัดกับหมายในรอบที่ยืนยัน/จ่ายแล้ว → รอบเดิมไม่ถูกแก้ · อนุมัติ = แก้ข้อมูลทั่วไปในหมาย + ยอดปรับปรุง (ถ้ามี) เข้ารอบถัดไป */
  const ADJ_RT_TH = { FREE: 'รอบหมายเงินงบประมาณ (หมายฟรี)', PAID: 'รอบหมายเงินนอกงบประมาณ (หมายมีเงิน)' };
  RENDER.changes = async (m) => {
    const d = await api('change_list'), names = d.officers || {};
    const offOpt = (sel) => Object.keys(names).sort().map((k) => '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(names[k].name) + '</option>').join('');
    const roundTxt = (g) => g.round ? 'อยู่ในรอบ' + esc(RTYPE_TH[g.round.round_type] || '') + ' วันที่ ' + esc(thDate(g.round.pay_date)) + (g.round.amount !== null ? ' · ยอดเดิม ' + baht2(g.round.amount) + ' บาท' : '') +
      (g.round.payment_status === 'PAID' ? ' · <b>จ่ายจริงแล้ว</b>' : '') : (g.locked_by ? 'ล็อกจาก' + esc(g.locked_by) : 'ล็อกแล้ว');
    const card = (g, i) => '<div class="clay panel chg" data-i="' + i + '">' +
      '<div class="row" style="gap:8px;align-items:center;margin-bottom:6px">' + (d.can_decide ? '<label class="chg-pk" title="เลือกเรื่องนี้เพื่ออนุมัติพร้อมกัน"><input type="checkbox" class="chg-pick" aria-label="เลือก ' + esc(g.case_no || '') + '"></label>' : '') + '<b>' + esc(g.case_no || '—') + '</b><span class="small muted">' + esc(g.notice_kind) + '</span>' + typeChip(g.pay_type) +
        '<span class="small">' + oDot(names, g.officer_id) + esc(g.officer) + '</span></div>' +
      '<p class="small" style="margin:0 0 8px"><span class="pill a">' + roundTxt(g) + '</span></p>' +
      '<div class="tbl-wrap"><table><thead><tr><th>ข้อมูล</th><th>เดิม (ในรอบ)</th><th>ไฟล์ใหม่</th><th>ผลเมื่ออนุมัติ</th></tr></thead><tbody>' +
        g.changes.map((c) => '<tr><td>' + esc(c.field_th) + '</td><td>' + esc(c.field.includes('date') ? thDate(c.old_value) : c.old_value || '—') + '</td><td><b>' + esc(c.field.includes('date') ? thDate(c.new_value) : c.new_value || '—') + '</b></td><td class="small">' +
          (c.money ? '<span class="flag-r">กระทบเงิน · ไม่แก้หมายเดิม ใช้ยอดปรับปรุง</span>' : '<span class="flag-ok">แก้ในหมาย · ไม่เปลี่ยนยอดที่จ่ายแล้ว</span>') + '</td></tr>').join('') +
      '</tbody></table></div>' + '<p class="tiny muted" style="margin:6px 2px 0">จากการนำเข้าชุด ' + esc(g.changes[0].batch_id) + ' · ' + esc(thDate(g.changes[0].created_at, true)) + '</p>' +
      (d.can_decide ? '<div class="adj-f"><b class="small">ยอดปรับปรุงในรอบถัดไป (ถ้ามี)</b>' +
        '<div class="row" style="gap:8px;margin-top:6px"><label class="small">บาท (ปรับลดใส่ −)<input class="inp" data-f="amount" inputmode="decimal" placeholder="เช่น 150 หรือ -150"></label>' +
        '<label class="small">รอบ<select class="sel" data-f="round_type"><option value="FREE"' + (g.pay_type !== 'PAID' ? ' selected' : '') + '>' + ADJ_RT_TH.FREE + '</option><option value="PAID"' + (g.pay_type === 'PAID' ? ' selected' : '') + '>' + ADJ_RT_TH.PAID + '</option></select></label>' +
        '<label class="small">ผู้ส่งหมาย<select class="sel" data-f="officer_id">' + offOpt(g.officer_id) + '</select></label></div>' +
        '<label class="small" style="display:block;margin-top:6px">เหตุผล / บันทึก<input class="inp" data-f="note" maxlength="200" placeholder="เช่น ตรวจกับรายงานแล้ว ผลส่งจริงวันที่ 4"></label>' +
        '<div class="row" style="gap:8px;margin-top:10px"><button type="button" class="btn btn-g" data-act="APPROVE">อนุมัติ</button><button type="button" class="btn" data-act="REJECT">ไม่อนุมัติ</button></div></div>'
        : '<p class="small muted" style="margin:8px 0 0">รอผู้ดูแลระบบตัดสิน</p>') + '</div>';
    const st = (a) => a.state === 'VOID' ? '<span class="pchip">ยกเลิก</span>' : a.state === 'APPLIED' ? '<span class="pchip pok">เข้ารอบ ' + esc(thDate(a.applied.pay_date)) + '</span>' : '<span class="pchip pm">รอรอบถัดไป</span>';
    m.innerHTML = top('รายการปรับปรุงรออนุมัติ') +
      '<div class="note">นำเข้าไฟล์ย้อนหลังแล้วข้อมูลต่างจากหมายที่อยู่ในรอบยืนยัน/จ่ายแล้ว — <b>ระบบไม่แก้รอบเดิม</b> · อนุมัติ = แก้ข้อมูลทั่วไปในหมาย (วันที่ ผล ชนิดหมาย บ้านเลขที่ หมู่) และถ้ามีผลต่อเงิน ให้ใส่ <b>ยอดปรับปรุง</b> ซึ่งเข้ารอบถัดไปของประเภทนั้น แบ่ง 60:40 ตามปกติ · ไม่อนุมัติ = เก็บข้อมูลเดิม (ต้องมีเหตุผล)</div>' +
      (d.can_decide && d.pending.length > 1 ? '<div class="clay panel chg-bulk"><label class="row" style="gap:6px;align-items:center"><input type="checkbox" id="chgAll"> <b>เลือกทั้งหมด</b></label>' +
        '<span class="small" id="chgN">ยังไม่ได้เลือก</span><input class="inp" id="chgNote" maxlength="200" placeholder="บันทึก (ถ้ามี) ใช้กับทุกเรื่องที่เลือก" aria-label="บันทึกสำหรับเรื่องที่เลือก">' +
        '<button type="button" class="btn btn-g" id="chgBulk" disabled>อนุมัติที่เลือก</button>' +
        '<p class="tiny muted" style="margin:0;flex-basis:100%">อีกทางหนึ่งนอกจากกดทีละเรื่อง · ยอดปรับปรุงที่กรอกไว้ในแต่ละเรื่องจะบันทึกไปด้วย · ถ้าเรื่องใดบันทึกไม่ได้ ระบบจะไม่บันทึกเลยสักเรื่อง</p></div>' : '') +
      (d.pending.length ? d.pending.map(card).join('') : '<div class="clay panel"><p class="small muted" style="margin:0">ไม่มีรายการรออนุมัติ</p></div>') +
      '<div class="clay panel"><h3>ยอดปรับปรุง (' + num(d.adjustments.length) + ')</h3>' + (d.adjustments.length ? '<div class="tbl-wrap"><table><thead><tr><th>เลขคดี</th><th class="onm">ผู้ส่งหมาย</th><th>รอบ</th><th class="n">บาท</th><th>เหตุผล</th><th>สถานะ</th><th></th></tr></thead><tbody>' +
        d.adjustments.map((a) => '<tr><td>' + esc(a.case_no) + '<br><span class="tiny muted">จากรอบ ' + esc(a.source_round_id || '—') + '</span></td><td class="onm">' + oDot(names, a.officer_id) + esc(a.officer) + '</td><td class="small">' + esc(a.round_type_th) +
          '</td><td class="n ' + (a.amount < 0 ? 'flag-r' : '') + '">' + baht2(a.amount) + '</td><td class="small">' + esc(a.reason) + (a.void_reason ? '<br><span class="tiny muted">ยกเลิก: ' + esc(a.void_reason) + '</span>' : '') + '</td><td>' + st(a) + '</td><td>' +
          (d.can_decide && a.state === 'WAIT' ? '<button type="button" class="btn btn-xs" data-void="' + esc(a.adj_id) + '">ยกเลิก</button>' : '') + '</td></tr>').join('') + '</tbody></table></div>'
        : '<p class="small muted" style="margin:0">ยังไม่มี</p>') + '</div>' +
      (d.decided.length ? '<details class="clay panel"><summary>ตัดสินแล้ว (' + num(d.decided.length) + ' ล่าสุด)</summary><div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th>เลขคดี</th><th>ข้อมูล</th><th>ไฟล์ใหม่</th><th>ผล</th><th>บันทึก</th><th>โดย</th></tr></thead><tbody>' +
        d.decided.map((c) => '<tr><td>' + esc(c.case_no) + '</td><td>' + esc(c.field_th) + '</td><td>' + esc(c.new_value) + '</td><td>' + (c.status === 'APPROVED' ? '<span class="flag-ok">อนุมัติ</span>' : '<span class="flag-r">ไม่อนุมัติ</span>') + (c.adj_id ? '<br><span class="tiny">+ ยอดปรับปรุง</span>' : '') +
          '</td><td class="small">' + esc(c.note) + '</td><td class="tiny">' + esc(c.decided_by) + '<br>' + esc(thDate(c.decided_at, true)) + '</td></tr>').join('') + '</tbody></table></div></details>' : '');
    m.querySelectorAll('.chg [data-act]').forEach((b) => b.addEventListener('click', async () => {
      const box = b.closest('.chg'), g = d.pending[+box.dataset.i], f = (k) => box.querySelector('[data-f="' + k + '"]').value.trim();
      const act = b.dataset.act, amt = f('amount').replace(/,/g, '').replace(/[−–]/g, '-'), note = f('note');
      if (act === 'REJECT' && !note) { toast('กรุณาใส่เหตุผลที่ไม่อนุมัติ'); box.querySelector('[data-f="note"]').focus(); return; }
      if (amt && !/^-?\d+(\.\d{1,2})?$/.test(amt)) { toast('ยอดปรับปรุงไม่ถูกต้อง (บาท ทศนิยมไม่เกิน 2 ตำแหน่ง)'); return; }
      if (act === 'APPROVE' && amt && Number(amt) !== 0 && !note) { toast('กรุณาใส่เหตุผลของยอดปรับปรุง'); box.querySelector('[data-f="note"]').focus(); return; }
      const money = act === 'APPROVE' && amt && Number(amt) !== 0;
      const msg = act === 'REJECT' ? 'ไม่อนุมัติ ' + g.changes.length + ' รายการของ ' + g.case_no + ' — คงข้อมูลเดิม' :
        'อนุมัติ ' + g.changes.length + ' รายการของ ' + g.case_no + '\nรอบเดิมไม่เปลี่ยน' + (money ? '\nยอดปรับปรุง ' + baht2(Number(amt)) + ' บาท → ' + ADJ_RT_TH[f('round_type')] + ' ถัดไป · ' + oName(names, f('officer_id')) : '\nไม่มียอดปรับปรุง');
      if (!(await askBox(msg))) return;
      b.disabled = true;
      try {
        const r = await api('change_decide', { notice_uid: g.notice_uid, change_ids: g.changes.map((c) => c.change_id), decision: act, note: note,
          adjust: money ? { amount: amt, round_type: f('round_type'), officer_id: f('officer_id'), reason: note } : null });
        toast(act === 'REJECT' ? 'ไม่อนุมัติแล้ว' : 'อนุมัติแล้ว' + (r.adj_id ? ' · ยอดปรับปรุงรอรอบถัดไป' : '')); go('changes');
      } catch (x) { toast(x.message); b.disabled = false; }
    }));
    // 0.7.24 เลือกหลายเรื่อง → อนุมัติครั้งเดียว
    const picks = () => Array.from(m.querySelectorAll('.chg-pick')).filter((x) => x.checked).map((x) => x.closest('.chg'));
    const syncBulk = () => {
      const p = picks(), all = m.querySelectorAll('.chg-pick'), b = $('#chgBulk');
      m.querySelectorAll('.chg').forEach((c) => c.classList.toggle('picked', !!(c.querySelector('.chg-pick') || {}).checked));
      if (!b) return;
      const nChg = p.reduce((s, c) => s + d.pending[+c.dataset.i].changes.length, 0);
      $('#chgN').textContent = p.length ? 'เลือก ' + num(p.length) + ' เรื่อง (' + num(nChg) + ' รายการข้อมูล)' : 'ยังไม่ได้เลือก';
      b.disabled = !p.length; b.textContent = p.length ? 'อนุมัติที่เลือก (' + num(p.length) + ')' : 'อนุมัติที่เลือก';
      $('#chgAll').checked = p.length > 0 && p.length === all.length; $('#chgAll').indeterminate = p.length > 0 && p.length < all.length;
    };
    m.querySelectorAll('.chg-pick').forEach((x) => x.addEventListener('change', syncBulk));
    if ($('#chgAll')) $('#chgAll').addEventListener('change', (e) => { m.querySelectorAll('.chg-pick').forEach((x) => { x.checked = e.target.checked; }); syncBulk(); });
    if ($('#chgBulk')) $('#chgBulk').addEventListener('click', async (e) => {
      const b = e.currentTarget, shared = $('#chgNote').value.trim(), items = [];
      let nAdj = 0, sumAdj = 0, nChg = 0;
      for (const box of picks()) {
        const g = d.pending[+box.dataset.i], f = (k) => box.querySelector('[data-f="' + k + '"]').value.trim();
        const amt = f('amount').replace(/,/g, '').replace(/[−–]/g, '-'), note = f('note') || shared;
        if (amt && !/^-?\d+(\.\d{1,2})?$/.test(amt)) { toast('ยอดปรับปรุงของ ' + g.case_no + ' ไม่ถูกต้อง'); box.scrollIntoView({ behavior: 'smooth' }); return; }
        const money = amt && Number(amt) !== 0;
        if (money && !note) { toast('ใส่เหตุผลของยอดปรับปรุง ' + g.case_no + ' (หรือบันทึกรวมด้านบน)'); box.querySelector('[data-f="note"]').focus(); return; }
        if (money) { nAdj++; sumAdj += Math.round(Number(amt) * 100); }
        nChg += g.changes.length;
        items.push({ notice_uid: g.notice_uid, change_ids: g.changes.map((c) => c.change_id), note: f('note'),
          adjust: money ? { amount: amt, round_type: f('round_type'), officer_id: f('officer_id'), reason: note } : null });
      }
      if (!items.length) return;
      const msg = 'อนุมัติ ' + num(items.length) + ' เรื่อง (' + num(nChg) + ' รายการข้อมูล)\nรอบเดิมไม่เปลี่ยน' +
        (nAdj ? '\nยอดปรับปรุง ' + num(nAdj) + ' เรื่อง รวม ' + baht2(sumAdj / 100) + ' บาท → รอบถัดไป' : '\nไม่มียอดปรับปรุง');
      if (!(await askBox(msg))) return;
      b.disabled = true; b.innerHTML = '<span class="spin"></span>';
      try {
        const r = await api('change_decide_bulk', { items: items, decision: 'APPROVE', note: shared });
        toast('อนุมัติแล้ว ' + num(r.decided_notices) + ' เรื่อง' + (r.adjustments ? ' · ยอดปรับปรุง ' + num(r.adjustments) + ' เรื่องรอรอบถัดไป' : '')); go('changes');
      } catch (x) { toast(x.message); syncBulk(); }
    });
    syncBulk();
    m.querySelectorAll('[data-void]').forEach((b) => b.addEventListener('click', async () => {
      const reason = await askBox('เหตุผลที่ยกเลิกยอดปรับปรุงนี้ (ยังไม่เข้ารอบ)', { input: 'ระบุเหตุผล' }); if (!reason) return;
      try { await api('adjust_void', { adj_id: b.dataset.void, reason: reason }); toast('ยกเลิกยอดปรับปรุงแล้ว'); go('changes'); } catch (x) { toast(x.message); }
    }));
  };

  RENDER.review = async (m) => {
    const d = await api('review_open');
    const canAct = has('NOTICE', 'ADMIN');
    const KTH = { RESULT: 'ไฟล์ผลหมาย (42)', ISSUE: 'ไฟล์จ่ายหมาย (50)' };
    const cand = (x, c, i) => {
      const where = [c.house_no ? 'บ้าน ' + c.house_no : '', c.moo ? 'ม.' + c.moo : '', c.tambon ? 'ต.' + c.tambon : ''].filter(Boolean).join(' ');
      const dis = !canAct || x.kind !== 'RESULT' || c.locked;
      return '<label class="rvc' + (c.like ? ' like' : '') + (dis ? ' dis' : '') + '"><input type="radio" name="rv' + esc(x.id) + '" value="' + esc(c.notice_uid) + '"' + (dis ? ' disabled' : '') + (c.like && !dis ? ' checked' : '') + '>' +
        '<span><b>' + esc(c.notice_kind || '—') + '</b> · ' + esc(where || '—') + ' · ' + esc(c.officer) + ' ' + typeChip(c.pay_type) +
        '<br><span class="tiny">' + (c.delivered_date ? 'ส่งแล้ว ' + esc(thDate(c.delivered_date)) : '<b>รอผล</b>') + (c.result ? ' · ผลในไฟล์จ่ายหมาย: ' + esc(c.result) : '') +
        (c.court_amount !== null && c.court_amount !== undefined ? ' · ศาลคิด ' + num(c.court_amount) + ' ฿' : '') + (c.locked ? ' · เข้ารอบเบิกแล้ว' : '') +
        (c.like ? ' · <span class="pill g">ผลการส่งตรงกัน</span>' : '') + '</span></span></label>';
    };
    const card = (x) => '<div class="clay panel rvbox" data-id="' + esc(x.id) + '" data-b="' + esc(x.batch_id) + '" data-r="' + x.row_no + '">' +
      '<div class="row" style="gap:8px;align-items:center;margin-bottom:6px"><span class="pill a">' + esc(KTH[x.kind] || x.kind) + '</span><span class="small muted">ชุด ' + esc(x.batch_id) + ' · แถว ' + x.row_no + '</span></div>' +
      '<p style="margin:0 0 6px"><b>' + esc(x.reason) + '</b></p>' +
      '<p class="small" style="margin:0 0 10px">เลขคดี <b>' + esc(x.case_no || '—') + '</b> · ' + esc(x.notice_kind || '—') + ' · ผู้รับ ' + esc(x.recipient || '—') + ' · ผู้ส่ง ' + esc(x.officer || '—') +
        (x.delivered_date ? ' · ส่ง ' + esc(thDate(x.delivered_date)) : '') + (x.reported_date ? ' · รายงาน ' + esc(thDate(x.reported_date)) : '') + (x.result ? '<br>ผล: ' + esc(x.result) : '') + '</p>' +
      (x.cands.length ? '<div class="small muted" style="margin:0 0 4px">หมายในระบบของคดีนี้' + (x.kind === 'RESULT' ? ' — เลือกฉบับที่เป็นของผลนี้' : '') + '</div><div class="rvcs">' + x.cands.map((c, i) => cand(x, c, i)).join('') + '</div>'
        : '<p class="note" style="margin:0">ไม่พบหมายของคดีนี้ในระบบ — ถ้าเป็นหมายของศาลนี้ ให้นำเข้าไฟล์จ่ายหมาย (50) ช่วงที่จ่ายหมายนี้ ระบบจะจับคู่ให้เอง</p>') +
      (canAct ? '<div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap">' +
        (x.kind === 'RESULT' && x.cands.some((c) => !c.locked) ? '<button type="button" class="btn btn-g btn-sm rv-apply">ใช้ผลนี้กับหมายที่เลือก</button>' : '') +
        '<input class="inp rv-why" style="flex:1;min-width:180px" placeholder="เหตุผลที่ไม่ใช้แถวนี้ เช่น แถวซ้ำ / ไม่ใช่หมายศาลนี้" aria-label="เหตุผลที่ไม่ใช้แถวนี้">' +
        '<button type="button" class="btn btn-sm rv-ign">ไม่ใช้แถวนี้</button></div>' : '') + '</div>';
    m.innerHTML = top('แถวรอตรวจ', canAct ? '<button type="button" class="btn" id="rvRetry">ให้ระบบลองจับคู่ใหม่</button>' : '') +
      '<p class="small muted" style="margin:0 6px 10px">ระบบจับคู่ให้เองทุกครั้งที่นำเข้าไฟล์ (รวมถึงเลือกฉบับจากผลการส่งในไฟล์จ่ายหมาย และปิดแถวที่ซ้ำ) · หน้านี้แสดงเฉพาะแถวที่ระบบตัดสินเองไม่ได้ · เลือกแล้วระบบคำนวณค่าหมายใหม่ทันที</p>' +
      (!d.total ? '<div class="clay panel"><p class="note g" style="margin:0">ไม่มีแถวรอตรวจ — ระบบจับคู่ได้ครบทุกแถว</p></div>' : '') +
      (d.total && !d.n_action ? '<div class="clay panel"><p class="note g" style="margin:0">ไม่มีแถวที่ต้องเลือกเอง</p></div>' : '') +
      d.rows.filter((x) => x.cands.length).map(card).join('') +
      (d.n_wait ? '<div class="clay panel"><h3 style="margin-top:0">ผลหมายที่ยังไม่พบหมายต้นทาง ' + num(d.n_wait) + ' แถว</h3>' +
        '<p class="small" style="margin:0 0 8px">ไม่ต้องทำอะไรทีละแถว — นำเข้า <b>ไฟล์จ่ายหมาย (50)</b> ที่ครอบช่วงวันที่จ่ายหมาย' + (d.wait_from ? ' <b>' + esc(thLong(d.wait_from)) + ' – ' + esc(thLong(d.wait_to)) + '</b>' : '') + ' ระบบจะจับคู่และปิดแถวเหล่านี้ให้เองทันที (ไม่ต้องนำเข้าไฟล์ผลซ้ำ)</p>' +
        '<details><summary class="small">ดูรายการ</summary>' + d.rows.filter((x) => !x.cands.length).map(card).join('') + '</details></div>' : '') +
      (d.total > d.rows.length ? '<p class="small muted">แสดง ' + num(d.rows.length) + ' จาก ' + num(d.total) + ' แถว</p>' : '');
    const act = async (b, body, okMsg) => {
      b.disabled = true; const t0 = b.textContent; b.innerHTML = '<span class="spin"></span>';
      try { const r = await api('review_resolve', body); toast(okMsg(r)); go('review'); }
      catch (e) { toast(e.message); b.disabled = false; b.textContent = t0; }
    };
    if ($('#rvRetry')) $('#rvRetry').addEventListener('click', (e) => act(e.currentTarget, { op: 'RETRY' }, (r) => 'ระบบจับคู่ได้เพิ่ม ' + num(r.closed) + ' แถว · เหลือ ' + num(r.left) + ' แถว'));
    m.querySelectorAll('.rvbox').forEach((bx) => {
      const base = { batch_id: bx.dataset.b, row_no: Number(bx.dataset.r) };
      const ap = bx.querySelector('.rv-apply');
      if (ap) ap.addEventListener('click', () => {
        const pick = bx.querySelector('input[type=radio]:checked');
        if (!pick) { toast('เลือกหมายที่เป็นของผลนี้ก่อน'); return; }
        act(ap, Object.assign({ op: 'APPLY', notice_uid: pick.value }, base), () => 'บันทึกผลการส่งแล้ว · คำนวณค่าหมายใหม่แล้ว');
      });
      const ig = bx.querySelector('.rv-ign');
      if (ig) ig.addEventListener('click', () => {
        const why = bx.querySelector('.rv-why').value.trim();
        if (!why) { toast('ระบุเหตุผลที่ไม่ใช้แถวนี้'); bx.querySelector('.rv-why').focus(); return; }
        act(ig, Object.assign({ op: 'IGNORE', reason: why }, base), () => 'ปิดแถวนี้แล้ว');
      });
    });
  };

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
        box.innerHTML = '<div class="clay panel"><h3>แถวรอตรวจสอบ · ' + esc(b.dataset.b) + '</h3><p class="small muted" style="margin:0 0 10px">แถวที่ยังค้าง เลือกฉบับหรือปิดแถวได้ที่หน้า "แถวรอตรวจ" · ชื่อผู้ส่งไม่ตรง แก้ชื่อเรียกอื่นในหน้า "ผู้ส่งหมายและอัตรา" แล้วนำเข้าไฟล์อีกครั้ง</p><div class="tbl-wrap"><table><thead><tr><th>แถว</th><th>กลุ่ม</th><th>เหตุผล</th><th>ข้อมูลในไฟล์</th></tr></thead><tbody>' +
          r.rows.map((x) => '<tr><td>' + x.row_no + '</td><td><span class="pill ' + (x.cls === 'ERROR' ? 'r' : 'a') + '">' + esc(CLS_TH[x.cls]) + '</span></td><td>' + esc(x.reason) + '</td><td class="tiny">' +
            esc(Object.keys(x.raw).map((k) => k + ': ' + x.raw[k]).join(' · ')) + '</td></tr>').join('') + '</tbody></table></div></div>';
        box.scrollIntoView({ behavior: 'smooth' });
      } catch (e) { box.innerHTML = '<div class="clay panel"><p class="note r" style="margin:0">' + esc(e.message) + '</p></div>'; }
    }));
  };

  /* ---------------------------------------------------------------- ผู้ส่งหมายและอัตรา */
  /* ---------------------------------------------------------------- คำนวณค่าหมาย (ระยะ 3) */
  const baht = (v) => Number(v || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  function calcOfficerModel(d, mode) {
    const sets = {
      ALL: {label:'รวมหมายมีเงินและหมายฟรี',columns:[['paid_n','มีเงิน (ฉบับ)'],['free_n','ฟรี (ฉบับ)'],['total_amount','รวม (บาท)','money']]},
      PAID: {label:'หมายเงินนอกงบประมาณ',columns:[['paid_n','มีเงิน (ฉบับ)'],['paid_amount','มีเงิน (บาท)','money']]},
      FREE: {label:'หมายเงินงบประมาณทั้งหมด',columns:[['free_n','ฟรี (ฉบับ)'],['free_units','หน่วยเบิก'],['free_wait','รอผลส่ง (ฉบับ)'],['free_amount','ฟรี (บาท)','money']]},
      FREE_PENDING: {label:'เงินงบประมาณทั้งหมดที่ยังไม่เบิก',columns:[['pending_free_n','ทั้งหมดที่ยังไม่เบิก (ฉบับ)'],['pending_ready_n','พร้อมเสนอ (ฉบับ)'],['pending_wait_review_n','รอผล / รอตรวจ (ฉบับ)'],['pending_noclaim_n','ไม่เบิกจ่าย (ฉบับ)'],['pending_ready_amount','ยอดประมาณการก่อนการเบิก (บาท)','money']]}
    };
    mode=sets[mode]?mode:'ALL';const spec=sets[mode];
    const values=o=>{const x=Object.assign({},o,{total_amount:Number(o.paid_amount||0)+Number(o.free_amount||0),pending_wait_review_n:Number(o.pending_wait_n||0)+Number(o.pending_review_n||0)});return spec.columns.map(c=>Number(x[c[0]])||0);};
    return {mode,label:spec.label,columns:spec.columns,rows:d.officers.map(o=>({officer:o,values:values(o)})),total:values(d.totals),
      note:mode==='FREE_PENDING'?'รวมหมายฟรีที่ยังไม่เบิกทุกสถานะในปีงบที่เลือก: ส่งแล้ว รอผล รอตรวจ และไม่เบิกจ่าย · ยอดเงินรวมเฉพาะที่ยอดประมาณการก่อนการเบิก รายการรอผล/รอตรวจยังไม่รวมเงิน':
        mode==='PAID'?'ยอดหมายมีเงินตามหน้าคำนวณ ใช้อัตราตำบลเมื่อราคาต่างจากอัตรา · ยอดก่อนแบ่ง 60/40':mode==='FREE'?'หมายฟรีทั้งหมดตามปีงบที่เลือก รวมรายการเบิกแล้วและยังไม่เบิก · ยอดก่อนแบ่ง 60/40':'หมายมีเงินและหมายฟรีทั้งหมดตามปีงบที่เลือก · ยอดก่อนแบ่ง 60/40'};
  }
  function paintCalcOfficers(d) {
    const model=calcOfficerModel(d,$('#calcMode').value),old=$('#calcOff'),order=old&&old.dataset.sd;
    const format=(v,c)=>c[2]==='money'?baht(v):num(v);
    const name=(o)=>'<span class="onm"><span class="officer-dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px;background:'+esc(o.color||'#21503a')+'"></span>'+esc(o.name)+'</span>'+
      ((model.mode==='ALL'||model.mode==='PAID')&&o.adj_up?'<br><span class="tiny flag-up">▲ เกินอัตรา '+num(o.adj_up)+' ฉบับ '+baht(o.adj_up_baht)+' บาท</span>':'')+
      ((model.mode==='ALL'||model.mode==='PAID')&&o.adj_dn?'<br><span class="tiny flag-r">▼ ต่ำกว่าอัตรา '+num(o.adj_dn)+' ฉบับ '+baht(o.adj_dn_baht)+' บาท</span>':'')+
      (!viewerOnly()&&model.mode!=='PAID'&&model.mode!=='FREE_PENDING'&&o.free_n?'<br><button type="button" class="btn btn-s ou" data-o="'+esc(o.officer_id)+'" data-n="'+esc(o.name)+'">ดูหมายฟรี</button>':'');
    $('#calcOfficerTable').innerHTML='<table id="calcOff"><thead><tr><th class="onm">ผู้ส่งหมาย</th>'+model.columns.map((c,i)=>'<th class="n"'+(i===model.columns.length-1?' data-sort':'')+'>'+esc(c[1])+'</th>').join('')+'</tr></thead><tbody>'+
      model.rows.map(r=>'<tr data-officer="'+esc(r.officer.officer_id)+'"><td class="onm">'+name(r.officer)+'</td>'+r.values.map((v,i)=>'<td class="n" data-v="'+v+'">'+(i===r.values.length-1?'<b>'+format(v,model.columns[i])+'</b>':format(v,model.columns[i]))+'</td>').join('')+'</tr>').join('')+
      '<tr class="sum"><td><b>รวมทุกคน</b></td>'+model.total.map((v,i)=>'<td class="n"><b>'+format(v,model.columns[i])+'</b></td>').join('')+'</tr></tbody></table>';
    $('#calcFilterNote').textContent=model.note+' · ▲ มากไปน้อย · ▼ น้อยไปมาก';
    const table=$('#calcOff');if(order){table.dataset.sc=String(model.columns.length);table.dataset.sd=order;}
    sortable(table);table.querySelectorAll('.ou').forEach(b=>b.onclick=()=>drawUnits(b.dataset.o,b.dataset.n));
  }
  function calcOfficerPngSpec(d) {
    const model=calcOfficerModel(d,$('#calcMode').value),byId=new Map(model.rows.map(r=>[r.officer.officer_id,r]));
    const ordered=Array.from($('#calcOff tbody').querySelectorAll('tr[data-officer]')).map(tr=>byId.get(tr.dataset.officer)).filter(Boolean);
    const rows=ordered.map(r=>[{text:(r.officer.full_name||r.officer.name)+((model.mode==='ALL'||model.mode==='PAID')&&r.officer.adj_up?'\nเกินอัตรา '+num(r.officer.adj_up)+' ฉบับ '+baht2(r.officer.adj_up_baht)+' บาท':'')+((model.mode==='ALL'||model.mode==='PAID')&&r.officer.adj_dn?'\nต่ำกว่าอัตรา '+num(r.officer.adj_dn)+' ฉบับ '+baht2(r.officer.adj_dn_baht)+' บาท':''),color:r.officer.color||'#21503a'}].concat(r.values.map((v,i)=>model.columns[i][2]==='money'?baht2(v):num(v))));
    const sum=['รวมทุกคน'].concat(model.total.map((v,i)=>model.columns[i][2]==='money'?baht2(v):num(v)));sum.sum=true;rows.push(sum);
    return {title:'สรุปค่าหมายรายผู้ส่ง · ปีงบประมาณ '+d.fy,subtitle:model.label+' · คำนวณล่าสุด '+(thDate(d.last_run,true)||'ไม่ระบุ'),headers:['ผู้ส่งหมาย'].concat(model.columns.map(c=>c[1])),widths:[310].concat(model.columns.map(c=>c[2]==='money'?210:155)),rows,note:model.note,filename:'notice-pay-officers-'+model.mode.toLowerCase()+'-'+d.fy,links:$('#calcPngLinks')};
  }
  RENDER.calc = async (m) => {
    const d = await api('calc_summary', { fy: S.fy });
    S.fy = d.fy;
    const t = d.totals;
    const kpi = (lbl, v, sub, cls, raw, money) => '<div class="kpi clay ' + (cls || '') + '"><span>' + esc(lbl) + '</span><b' +
      (raw !== undefined ? ' data-count="' + Number(raw || 0) + '"' + (money ? ' data-money="1" data-suffix="&nbsp;฿"' : '') : '') + '>' + v + '</b>' + (sub ? '<span class="tiny muted">' + sub + '</span>' : '') + '</div>';
    m.innerHTML = top((S.page==='overview'?'ภาพรวม 2 ประเภท':'ยอดอ้างอิงรายผู้ส่ง')+' · ปีงบประมาณ ' + esc(d.fy),
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
      '<section class="clay panel"><div class="row calc-officer-toolbar" style="justify-content:space-between"><h3>'+(d.scope_officer?'ค่าหมายของฉัน':'แยกรายผู้ส่งหมาย')+'</h3><label>ยอดที่ต้องการดู<select class="sel" id="calcMode"><option value="ALL">รวมทั้ง 2 ประเภท</option><option value="PAID">เงินนอกงบประมาณ</option><option value="FREE">เงินงบประมาณทั้งหมด</option><option value="FREE_PENDING">เงินงบประมาณที่ยังไม่เบิก</option></select></label><button type="button" class="btn btn-sm" id="calcPng">พิมพ์ / PNG สี</button></div><div id="calcPngLinks" class="row export-links"></div><div id="calcOfficerTable" class="tbl-wrap"></div><p id="calcFilterNote" class="tiny muted" style="margin-top:10px"></p></section>' +
      (d.warnings.length ? '<div class="clay panel"><h3>ข้อควรตรวจ</h3><div class="tbl-wrap"><table><thead><tr><th>วันที่ส่ง</th><th class="onm">ผู้ส่ง</th><th>รายละเอียด</th><th class="n">ฉบับ</th><th>หน่วยเบิก</th></tr></thead><tbody>' +
        d.warnings.map((w) => '<tr><td>' + esc(thDate(w.date)) + '</td><td class="small onm">' + esc(w.officer) + '</td><td class="small">' + esc(w.text) + (w.place_key && !/^X:/.test(w.place_key) ? ' · ' + esc(w.place_key) : '') +
          '</td><td class="n">' + num(w.count) + '</td><td class="tiny">' + esc(w.unit_id) + '</td></tr>').join('') + '</tbody></table></div></div>' : '') +
      '<div id="chkBox"></div><div id="unitBox"></div>';
    drawChecks();
    countUp(m);
    $('#printSum').addEventListener('click', () => printSummary(d));
    $('#calcPng').onclick = async(e) => {
      const b=e.currentTarget;b.disabled=true;
      try {
        $('#calcPngLinks').innerHTML='';
        await window.NP_EXPORT.png(calcOfficerPngSpec(d));
        toast('สร้าง PNG สีครบทุกคนและทุกคอลัมน์แล้ว');
      }catch(x){toast(x.message);}finally{b.disabled=false;}
    };
    if ($('#runCalc')) $('#runCalc').addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spin"></span> กำลังคำนวณ…';
      try { const r = await api('calc_run'); toast('คำนวณเสร็จ · หน่วยเบิก ' + num(r.units) + ' หน่วย'); go('calc'); }
      catch (er) { b.disabled = false; b.textContent = 'คำนวณใหม่'; toast(er.message); }
    });
    $('#calcMode').value=S.calcMode||'ALL';
    $('#calcMode').onchange=()=>{S.calcMode=$('#calcMode').value;$('#unitBox').innerHTML='';$('#calcPngLinks').innerHTML='';if(window.NP_EXPORT)window.NP_EXPORT.clear();paintCalcOfficers(d);};
    paintCalcOfficers(d);
    if (d.scope_officer && d.officers[0] && d.officers[0].free_n) drawUnits(d.officers[0].officer_id, d.officers[0].name);
  };
  /* รายการรอยืนยัน: ยอดเงินไม่ตรงอัตราตำบล · วันที่จ่ายไม่แน่ชัด (ไฟล์ 50 คร่อม 1 ต.ค.) */
  async function drawChecks() {
    const box = $('#chkBox'); if (!box || viewerOnly()) return;
    let d;
    try { d = await api('notice_checks', { fy: S.fy }); } catch (e) { box.innerHTML = ''; return; }
    if (!box.isConnected) return;
    if (!d.amount.length && !d.date.length) { box.innerHTML = ''; return; }
    const caseCell = (x) => '<b>' + esc(x.case_no) + '</b>' + (x.case_ref ? '<br><span class="tiny muted">' + esc(x.case_ref) + '</span>' : '') + '<br><span class="tiny muted">' + esc(x.kind) + '</span>';
    const waitN = d.date.filter((x) => !x.date_ok).length;
    const upL = d.amount.filter((x) => x.adj && x.adj.dir === 'UP'), dnL = d.amount.filter((x) => x.adj && x.adj.dir === 'DOWN');
    const sumD = (L) => L.reduce((a, x) => a + Number(x.adj.diff), 0);
    let h = '';
    if (d.amount.length) h += '<div class="clay panel"><h3>ราคาไม่เท่าอัตราตำบล · คิดตามอัตราตำบลแล้ว ' + num(d.amount.length) + ' ฉบับ</h3>' +
      '<p class="small" style="margin:0 0 10px">' + (upL.length ? '<span class="flag-up">▲ เกินอัตรา ' + num(upL.length) + ' ฉบับ รวม ' + num(sumD(upL)) + ' บาท — ส่วนต่างเทียบอัตรา · รอบจ่ายใช้ยอดบัญชีจ่ายจริง</span>' : '') +
        (upL.length && dnL.length ? ' · ' : '') + (dnL.length ? '<span class="flag-r">▼ ต่ำกว่าอัตรา ' + num(dnL.length) + ' ฉบับ รวม ' + num(sumD(dnL)) + ' บาท — ปรับขึ้นเป็นอัตราตำบล</span>' : '') + '</p>' +
      '<p class="tiny muted" style="margin:0 0 10px">ยอดคำนวณใช้อัตราตำบล · รอบจ่ายใช้บัญชีจ่ายจริง · เก็บราคาต้นทางเพื่อเทียบขาด/เกิน</p>' +
      '<div class="tbl-wrap"><table><thead><tr><th>เลขคดี</th><th class="onm">ผู้ส่ง</th><th>ผู้รับ / พื้นที่</th><th class="n">ราคาไฟล์</th><th class="n">อัตราตำบล (คิดเงิน)</th><th>ส่วนต่าง</th></tr></thead><tbody>' +
      d.amount.map((x) => '<tr><td>' + caseCell(x) + '</td><td class="small onm">' + esc(x.officer) + '</td><td class="small">' + esc(x.recipient) + '<br><span class="tiny muted">' + esc(x.place) + '</span></td>' +
        '<td class="n">' + num(x.amount) + '</td><td class="n"><b>' + num(x.rate) + '</b></td>' +
        '<td class="small">' + (x.adj ? adjMark(x.adj) + (x.adj.dir === 'UP' ? '<br><span class="tiny muted">ยอดคำนวณตามอัตรา · ยอดจ่ายตรวจจากบัญชี</span>' : '<br><span class="tiny muted">ปรับขึ้นเป็นอัตราตำบล</span>') : '<span class="tiny muted">—</span>') +
        (x.ok ? '<br><span class="tiny muted" title="ประวัติก่อนเปลี่ยนกฎ">เคยยืนยันยอดไฟล์ ' + num(x.ok.value) + ' · ' + esc(x.ok.by) + ' · ' + esc(thDate(x.ok.at, true)) + '</span>' : '') + '</td></tr>').join('') +
      '</tbody></table></div></div>';
    if (d.date.length) h += '<div class="clay panel"><h3>วันที่จ่ายไม่แน่ชัด · รอยืนยัน ' + num(waitN) + ' · ยืนยันแล้ว ' + num(d.date.length - waitN) + '</h3>' +
      '<p class="tiny muted" style="margin:0 0 10px">หมายจากไฟล์ 50 ที่ช่วงวันที่คร่อม 1 ต.ค. และไม่พบวันที่จ่ายในไฟล์ 42 — ส่วนใหญ่คือหมายที่จ่ายเดือน ก.ย. · จ่ายเดือน ก.ย.: หมายฟรีไม่นับ หมายมีเงินนับเมื่อไฟล์ 42 ให้วันที่ส่งตั้งแต่ 1 ต.ค. · ถ้าภายหลังไฟล์ 42 มีวันที่จ่ายของหมายนั้น ระบบใช้วันที่จริงแทนการยืนยัน</p>' +
      (waitN && d.can_date ? '<p style="margin:0 0 10px"><button type="button" class="btn btn-s" id="cbAll">ยืนยันทั้งหมดที่เหลือ: จ่ายเดือน ก.ย. (' + num(waitN) + ')</button></p>' : '') +
      '<div class="tbl-wrap"><table><thead><tr><th>เลขคดี</th><th>ประเภท</th><th class="onm">ผู้ส่ง</th><th>ผู้รับ / พื้นที่</th><th>สถานะ</th><th></th></tr></thead><tbody>' +
      d.date.map((x) => '<tr><td>' + caseCell(x) + '</td><td><span class="pill ' + (x.pay_type === 'BUDGET' ? 'b' : 'g') + '">' + esc(PAY_TH[x.pay_type] || '') + '</span>' +
        (x.pay_type === 'PAID' && x.amount !== '' ? '<br><span class="tiny">' + num(x.amount) + ' บาท</span>' : '') + '</td><td class="small onm">' + esc(x.officer) + '</td>' +
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
      const reason = await askBox('เหตุผลที่ยกเลิกการยืนยันยอด', { input: 'ระบุเหตุผล' }); if (!reason) return;
      busy(b);
      try { await api('notice_confirm_amount', { notice_uids: [b.dataset.u], undo: true, reason: reason }); toast('ยกเลิกการยืนยันแล้ว'); go('calc'); } catch (e) { toast(e.message); drawChecks(); }
    }));
    box.querySelectorAll('.cb').forEach((b) => b.addEventListener('click', async () => {
      busy(b);
      try { await api('notice_confirm_date', { notice_uids: [b.dataset.u], value: b.dataset.v }); toast('บันทึกแล้ว · คำนวณใหม่แล้ว'); go('calc'); } catch (e) { toast(e.message); drawChecks(); }
    }));
    if ($('#cbAll')) $('#cbAll').addEventListener('click', async (e) => {
      const ids = d.date.filter((x) => !x.date_ok).map((x) => x.notice_uid);
      if (!(await askBox('ยืนยันว่า ' + ids.length + ' หมายนี้จ่ายเดือน ก.ย. (ก่อนเริ่มปีงบ)?\nหมายฟรีจะไม่นับ · หมายมีเงินนับเมื่อมีวันที่ส่งตั้งแต่ 1 ต.ค.'))) return;
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
  const typeChip = (t) => t === 'PAID' ? '<span class="pchip pm">นอกงบฯ</span>' : '<span class="pchip pf">งบประมาณ</span>';
  function splitTable(sp, names, opts) {
    opts = opts || {};
    const nm = (id) => esc(oName(names, id));
    const t = opts.type, one = t === 'FREE' || t === 'PAID';
    const amt = (l) => one ? cb(t === 'FREE' ? l.budget_c : l.paid_c) + ((t === 'FREE' ? l.n_budget : l.n_paid) ? '<span class="pcnt">' + num(t === 'FREE' ? l.n_budget : l.n_paid) + ' เรื่อง</span>' : '') : '';
    return splitVisual(sp.c60,sp.pool40_c,cb)+'<div class="tbl-wrap"><table class="ptbl"><thead><tr><th class="onm">ผู้ส่งหมาย</th>' + (one ? '<th class="n">' + (t === 'FREE' ? 'หมายฟรี' : 'หมายเงิน') + '</th>' : '<th class="n">หมายมีเงิน</th><th class="n">หมายฟรี</th><th class="n">รวม</th>') + '<th class="n">เจ้าหน้าที่ส่งหมาย 60%</th><th class="n">ยอดโอนคืน 40%</th></tr></thead><tbody>' +
      (sp.lines.length ? sp.lines.map((l) => '<tr><td class="pnm"><span class="odot" style="background:' + esc((names[l.officer_id] || {}).color || '#999') + '"></span>' + nm(l.officer_id) + '</td>' +
        (one ? '<td class="n"><b>' + amt(l) + '</b></td>' : '<td class="n">' + cb(l.paid_c) + (l.n_paid ? '<span class="pcnt">' + num(l.n_paid) + ' หมาย</span>' : '') + '</td><td class="n">' + cb(l.budget_c) + (l.n_budget ? '<span class="pcnt">' + num(l.n_budget) + ' หน่วย</span>' : '') +
        '</td><td class="n"><b>' + cb(l.total_c) + '</b></td>') + '<td class="n">' + cb(l.c60) + '</td><td class="n">' + cb(l.c40) + '</td></tr>').join('')
        : '<tr><td colspan="6" class="muted small">ยังไม่ได้เลือกรายการ</td></tr>') +
      '</tbody><tfoot><tr><td><b>รวม</b></td>' + (one ? '<td class="n"><b>' + cb(sp.total_c) + '</b></td>' : '<td class="n"><b>' + cb(sp.paid_c) + '</b></td><td class="n"><b>' + cb(sp.budget_c) + '</b></td><td class="n"><b>' + cb(sp.total_c) + '</b></td>') +
      '<td class="n"><b>' + cb(sp.c60) + '</b></td><td class="n"><b>' + cb(sp.pool40_c) + '</b></td></tr></tfoot></table></div>' +
      '<div class="pool">' +
        '<div><span>ยอดโอนคืน 40%</span><b class="money40">' + cb(sp.pool40_c) + '</b></div>' +
        '<div><span>เศษยกมาจากรอบก่อน</span><b class="carry-value">' + cb(sp.carry_in_c) + '</b></div>' +
        '<div><span>รวมกองกลาง</span><b class="money40">' + cb(sp.pool_c) + '</b></div>' +
        '<div class="ps"><span>คนนั่งงาน ' + num(sp.seats) + ' คน ได้คนละ</span><b>' + cb(sp.per_seat_c) + '&nbsp;฿</b></div>' +
        (sp.extra_one_c ? '<div><span>เศษให้ 1 คน</span><b>' + cb(sp.extra_one_c) + '</b></div>' : '') +
        '<div><span>เศษยกไปรอบหน้า</span><b class="' + (sp.carry_out_c < 0 ? 'flag-r' : 'carry-value') + '"' + '>' + cb(sp.carry_out_c) + '</b></div>' +
      '</div>' + (opts.policyTh ? '<p class="tiny muted" style="margin:8px 2px 0">วิธีปัดเศษ: ' + esc(opts.policyTh) + ' · บัญชี 60:40 เป็นบัญชีคำนวณภายใน แยกจากเอกสารเบิกจ่ายทางราชการ</p>' : '');
  }

  const RTYPE_TH = { FREE: 'หมายเงินงบประมาณ', PAID: 'หมายเงินนอกงบประมาณ' };
  const rChip = (t) => t === 'PAID' ? typeChip('PAID') : (t === 'FREE' ? typeChip('BUDGET') : '');
  const oName = (names, id) => (names[id] || {}).name || String(id || '').replace(/^\?/, '') || '—';
  const oFull = (names, id) => (names[id] || {}).full_name || oName(names, id);   // เอกสารพิมพ์ใช้ชื่อ–สกุลเต็ม
  const oDot = (names, id) => '<span class="odot" style="background:' + esc((names[id] || {}).color || '#bbb') + '"></span>';

  RENDER.claim25 = m => { if(!has('NOTICE','FINANCE','ADMIN')) throw new Error('ไม่มีสิทธิ์'); return payoutClaim(m); };
  RENDER.payout = async (m, sub) => {
    sub = sub || S.payoutSub || 'list';
    S.payoutSub = 'list';
    if (/^new:/.test(sub)) return payoutNew(m, sub.split(':')[1], sub.split(':')[2]);
    if (sub === 'backlog') return payoutBacklog(m);
    if (sub === 'claim') return payoutClaim(m);
    if (/^round:/.test(sub)) return payoutRound(m, sub.slice(6));
    const d = await api('payout_list');
    const names = d.officers, bl = d.backlog;
    const T = bl.reduce((a, b) => ({ pn: a.pn + b.paid_n, p: a.p + b.paid, bn: a.bn + b.budget_n, b: a.b + b.budget, h: a.h + b.held_n }), { pn: 0, p: 0, bn: 0, b: 0, h: 0 });
    const bk = d.blocked || {}, lf = d.last_free;
    m.innerHTML = top('รอบเบิก 60/40', d.can_create ? '<div class="row" style="gap:8px"><button type="button" class="btn btn-g" id="pNewF">เตรียมเบิกหมายฟรี</button><button type="button" class="btn" id="pNewP">+ รอบหมายมีเงิน (บัญชี 30)</button><button type="button" class="btn btn-sm" id="pNewC" title="ตรวจแบบ 25 แยกต่างหาก ไม่เปลี่ยนสูตรและลำดับรอบเดิม">ตรวจแบบ 25 (ทางเลือก)</button></div>' : '') +
      '<div class="clay panel pinfo">' +
        '<div class="pinfo-r"><span class="pchip pf">งบประมาณ</span><div><b>' + (lf ? 'เบิกหมายฟรีล่าสุด ' + esc(thDate(lf.pay_date)) : 'ยังไม่เคยเบิกหมายฟรีในระบบ') + '</b>' +
          (lf ? '<span class="small muted">' + (lf.cutoff ? ' · ลงข้อมูลถึง ' + esc(thDate(lf.cutoff)) : '') + ' · ' + baht2(lf.total) + '&nbsp;฿</span>' : '') +
          '<div class="tiny muted">ราคาหมายฟรีตามบัญชีศาล: ' + (d.free18_at ? 'นำเข้าล่าสุด ' + esc(thDate(d.free18_at, true)) : '<span class="flag-r">ยังไม่นำเข้า — รอบหมายฟรีจะใช้ยอดที่ระบบคำนวณ</span>') + ' · ที่มา ' + esc(d.sources.FREE18) + '</div></div></div>' +
        '<div class="pinfo-r"><span class="pchip pm">นอกงบฯ</span><div><b>มีบัญชีจ่ายแล้ว แต่ยังไม่มีรอบแบ่งในระบบ</b>' +
          (d.pending_dates.length ? '<div class="pdates">' + d.pending_dates.map((x) => '<button type="button" class="btn btn-sm pdate" data-pd="' + esc(x.pay_date) + '"' + (d.can_create ? '' : ' disabled') + '>' + esc(thDate(x.pay_date)) + ' · ' + num(x.rows) + ' เรื่อง · ' + baht2(x.amount) + '&nbsp;฿' + (x.none ? ' <span class="flag-r">รอยืนยันการจับคู่ ' + num(x.none) + '</span>' : '') + '</button>').join('') + '</div>'
            : '<div class="small muted">ไม่มี — ดาวน์โหลดไฟล์ ' + esc(d.sources.PAY) + ' แล้วนำเข้าที่ "นำเข้าข้อมูล › บัญชีจ่ายเงินหมายมีเงิน"</div>') +
          outsideDatesHtml(d.outside, d.can_cancel) + '</div></div></div>' +
      '<div class="clay panel"><div class="row" style="justify-content:space-between;align-items:baseline"><h3 style="margin:0">รายการยังไม่เข้ารอบในระบบ</h3>' +
      '<span class="small muted">ส่งแล้ว ยังไม่เข้ารอบใด · รวม <b>' + baht2(T.p + T.b) + ' ฿</b>' + (d.can_detail ? ' <button type="button" class="btn btn-sm" id="pBl">ดูรายเรื่อง</button>' : '') + '</span></div>' +
      '<div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th class="onm">ผู้ส่งหมาย</th><th class="n">หมายเงิน (เรื่อง)</th><th class="n">บาท</th><th class="n">หมายฟรี (เรื่อง)</th><th class="n">บาท</th><th class="n">เคยเลื่อน</th><th class="n">ค้างนานสุด</th></tr></thead><tbody>' +
      (bl.length ? bl.map((b) => '<tr><td class="onm">' + oDot(names, b.officer_id) + esc(oName(names, b.officer_id)) + '</td><td class="n">' + num(b.paid_n) + '</td><td class="n">' + baht2(b.paid) +
        '</td><td class="n">' + num(b.budget_n) + '</td><td class="n">' + baht2(b.budget) + '</td><td class="n">' + (b.held_n ? '<span class="pchip ph">' + num(b.held_n) + '</span>' : '—') + '</td><td class="n">' + num(b.oldest_days) + ' วัน</td></tr>').join('')
        : '<tr><td colspan="7" class="muted small">ไม่มีรายการค้างเบิก</td></tr>') +
      '</tbody><tfoot><tr><td><b>รวม</b></td><td class="n"><b>' + num(T.pn) + '</b></td><td class="n"><b>' + baht2(T.p) + '</b></td><td class="n"><b>' + num(T.bn) + '</b></td><td class="n"><b>' + baht2(T.b) + '</b></td><td class="n"><b>' + num(T.h) + '</b></td><td></td></tr></tfoot></table></div>' +
      '<p class="tiny muted" style="margin:8px 2px 0">หมายเงิน = ส่งแล้วแต่ยังไม่อยู่ในบัญชีจ่ายเงิน · ยังไม่เข้าเกณฑ์: รอผลการส่ง ' + num(bk.wait || 0) + ' · รอตรวจ ' + num(bk.review || 0) + ' ฉบับ' + (d.closed_n ? ' · ปิด "ไม่เบิก" แล้ว ' + num(d.closed_n) + ' เรื่อง' : '') + '</p></div>' +
      '<div class="clay panel"><h3>รอบเบิกที่ผ่านมา</h3>' + roundPaySummaryHtml(d.rounds) + (d.rounds.length ? '<div class="tbl-wrap"><table><thead><tr><th>วันที่จ่าย</th><th>ประเภท</th><th class="n">รายการ</th><th class="n">ยังไม่เสนอ</th><th class="n">ยอดรวม</th><th class="n">เศษยกมา</th><th class="n">คนนั่ง</th><th class="n">ได้คนละ</th><th class="n">เศษยกไป</th><th>สถานะ</th><th></th></tr></thead><tbody>' +
        d.rounds.map((r) => '<tr' + (r.status === 'CANCELLED' ? ' class="muted"' : '') + '><td>' + esc(thDate(r.pay_date)) + '</td><td>' + rChip(r.round_type) + (r.from_claim ? ' <span class="pchip pc">ตามใบเบิก</span>' : '') +
          '</td><td class="n">' + num(r.n_items) + '</td><td class="n">' + num(r.n_excluded) + '</td><td class="n"><b>' + baht2(r.total) + '</b></td><td class="n">' + baht2(r.carry_in) + '</td><td class="n">' + num(r.seats) + '</td><td class="n">' + baht2(r.per_seat) + '</td><td class="n">' + baht2(r.carry_out) +
          '</td><td>' + roundStatusHtml(r) + '</td><td><button type="button" class="btn btn-sm" data-r="' + esc(r.round_id) + '">ดู / พิมพ์</button></td></tr>').join('') +
        '</tbody></table></div>' : '<p class="small muted" style="margin:0">ยังไม่มีรอบเบิก</p>') +
      '<p class="tiny muted" style="margin:8px 2px 0">1 รอบ = 1 ประเภท 1 วันที่จ่าย · วันเดียวกันตั้งรอบหมายฟรีก่อน แล้วเศษยกไปรอบหมายเงิน · เศษยกต่อเนื่องตามลำดับวันที่ (ตั้งรอบย้อนหลังให้เรียงจากเก่าไปใหม่)</p></div>';
    if ($('#pNewC')) $('#pNewC').addEventListener('click', () => { S.payoutSub = 'claim'; go('payout'); });
    if ($('#pNewF')) $('#pNewF').addEventListener('click', () => { S.payoutSub = 'new:FREE'; go('payout'); });
    if ($('#pNewP')) $('#pNewP').addEventListener('click', () => { S.payoutSub = 'new:PAID'; go('payout'); });
    if ($('#pBl')) $('#pBl').addEventListener('click', () => { S.payoutSub = 'backlog'; go('payout'); });
    m.querySelectorAll('[data-outundo]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await askBox('ยกเลิกการบันทึกว่าแบ่งนอกระบบ วันที่ ' + thDate(b.dataset.outundo) + ' — วันที่นี้จะกลับมาอยู่ในรายการรอตั้งรอบ'))) return;
      b.disabled = true;
      try { await api('ledger_outside', { pay_date: b.dataset.outundo, undo: true }); toast('ยกเลิกแล้ว'); go('payout'); } catch (x) { toast(x.message); b.disabled = false; }
    }));
    m.querySelectorAll('.pdate').forEach((b) => b.addEventListener('click', () => { S.payoutSub = 'new:PAID:' + b.dataset.pd; go('payout'); }));
    m.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => { S.payoutSub = 'round:' + b.dataset.r; go('payout'); }));
  };

  /* ---------- 0.7.26 รอบ 60/40 ตามใบเบิก: กรอกยอดรายคนจากใบเบิกจริง → แบ่ง 60:40 ÷ N → สะสมเป็นรอบ ---------- */
  // 0.7.29: เก็บเฉพาะร่างกรอกเองในแท็บนี้ แยกผู้ใช้และประเภท ไม่คืนร่างจากไฟล์แบบ 25
  const claimDraftKey = () => 'np_claim_draft_v2:' + String(S.user && S.user.code || '');
  const claimDraftGet = () => { try { return S.user && S.user.code ? JSON.parse(sessionStorage.getItem(claimDraftKey()) || 'null') : null; } catch (e) { return null; } };
  const claimDraftSet = (v) => { try { if (!S.user || !S.user.code) return; if (v) sessionStorage.setItem(claimDraftKey(), JSON.stringify(v)); else sessionStorage.removeItem(claimDraftKey()); } catch (e) { /* ไม่มีที่เก็บ ใช้ต่อได้ */ } };
  function claimIsoDay(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v+'T00:00:00Z')) && new Date(v+'T00:00:00Z').toISOString().slice(0,10) === v; }
  function claimRangeOverlap(from, to, ranges) { return ranges.some(r => from <= r.to && to >= r.from); }
  function normalizeClaimOfficer(x) { return String(x || '').normalize('NFKC').replace(/\s+/g, '').replace(/^(นางสาว|น\.ส\.|นาง|นาย)/, ''); }
  function exactClaimOfficer(name, officers) { const k = normalizeClaimOfficer(name); const hits = k ? officers.filter(x => normalizeClaimOfficer(x.name) === k || normalizeClaimOfficer(x.full_name) === k) : []; return hits.length === 1 ? hits[0].officer_id : ''; }
  function form25Type(receipt) {
    const v = String(receipt == null ? '' : receipt).trim();
    if (v === 'เงินนอกงบประมาณ') return 'FREE';
    if (/^(?:[A-Za-zก-ฮ.]{1,10}[-/. ]?)?[0-9๐-๙]+(?:[-/._][0-9๐-๙]+)*$/.test(v)) return 'PAID';
    // Court export also appends the receipt amount in parentheses, with several receipts comma-separated.
    const receiptPart = /^[0-9๐-๙]+\/[0-9๐-๙]+\s*\([0-9๐-๙]+(?:\.[0-9๐-๙]{1,2})?\)$/;
    return v.split(/\s*,\s*/).every(part => receiptPart.test(part.trim())) ? 'PAID' : '';
  }
  /** บาท → สตางค์ แบบเข้มงวด (ตรงกับ claimCents_ ฝั่งเซิร์ฟเวอร์) · ว่าง = 0 · ผิด = null */
  function claimCents(v) {
    const s = String(v == null ? '' : v).replace(/,/g, '').trim();
    if (s === '') return 0;
    const mm = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s);
    if (!mm) return null;
    const c = Number(mm[1]) * 100 + Number(((mm[2] || '') + '00').slice(0, 2));
    return c > 1000000000 ? null : c;
  }
  const d25 = (v) => {
    const t = String(v || '').replace(/\s+/g, ''); const mm = /^(\d{1,2})-?([ก-๙.]+?)-?(\d{2,4})$/.exec(t);
    if (!mm || !TH_MON[mm[2]]) return '';
    let y = Number(mm[3]); if (y < 100) y += 2500; if (y > 2400) y -= 543;
    const iso = y + '-' + String(TH_MON[mm[2]]).padStart(2, '0') + '-' + String(mm[1]).padStart(2, '0'); return claimIsoDay(iso) ? iso : '';
  };
  function parseClaim25Rows(aoa, officers, fileName) {
    const hi = aoa.findIndex((r) => r.some((x) => String(x).replace(/\s+/g, '') === 'ผู้ส่งหมาย'));
    if (hi < 0) throw new Error('ไม่ใช่แบบ 25 (ไม่พบหัวคอลัมน์ "ผู้ส่งหมาย")');
    const col = (name) => aoa[hi].findIndex((x) => String(x).replace(/\s+/g, '') === name);
    const uidCol = col('notice_uid');
    const evCols={case_no:col('เลขดำที่'),recipient:col('ส่งหมายให้ใคร'),notice_kind:col('หมายอะไร'),tambon:col('ตำบล'),amphoe:col('อำเภอ')};
    const ci = { d: col('วันที่ลงข้อมูล'), p: col('ราคาหมาย'), o: col('ผู้ส่งหมาย'), r: col('ใบเสร็จจ่ายออก') };
    if (Object.keys(ci).some((k) => ci[k] < 0)) throw new Error('คอลัมน์ไม่ครบ (วันที่ลงข้อมูล · ราคาหมาย · ผู้ส่งหมาย · ใบเสร็จจ่ายออก)');
    const rows = []; let foot = null, allC = 0, badDate = 0;
    for (let i = hi + 1; i < aoa.length; i++) {
      const r = aoa[i], line = r.map((x) => String(x)).join(' ');
      const fm = /รวมทั้งสิ้น\s*=?\s*([\d,]+)\s*หมาย/.exec(line);
      if (fm) { const bm = /รวม\s*([\d,]+(?:\.\d+)?)\s*บาท/.exec(line.slice(fm.index + fm[0].length)); foot = { n: Number(fm[1].replace(/,/g, '')), c: bm ? claimCents(bm[1]) : null }; continue; }
      if (!/^\d+(\.0+)?$/.test(String(r[0]).trim())) continue;
      const c = claimCents(String(r[ci.p]).replace(/,/g, ''));
      if (c === null || c <= 0) throw new Error('ราคาหมายไม่ถูกต้อง แถว ' + (i + 1));
      const rowType = form25Type(r[ci.r]); if (!rowType) throw new Error('ไม่สามารถระบุประเภทจากใบเสร็จ แถว ' + (i + 1));
      const date = d25(r[ci.d]); if (!date) badDate++;
      allC += c;
      let evidence='';
      if(typeof NoticeImportFormat!=='undefined' && NoticeImportFormat.form25Evidence && Object.values(evCols).every(i=>i>=0)){
        const ev={};Object.keys(evCols).forEach(k=>{ev[k]=r[evCols[k]];});evidence=NoticeImportFormat.form25Evidence(ev);
      }
      rows.push({ uid:uidCol>=0 && typeof r[uidCol]==='string' ? r[uidCol].trim() : '', evidence:evidence, date: date, c: c, officer: String(r[ci.o]).replace(/\s+/g, ' ').trim(), type: rowType });
    }
    if (!foot || foot.c === null) throw new Error('ไม่พบแถวรวมทั้งสิ้นท้ายไฟล์ จึงตรวจยอดไม่ได้');
    if (foot.n !== rows.length || foot.c !== allC) throw new Error('ยอดไม่ตรงท้ายไฟล์: อ่านได้ ' + num(rows.length) + ' หมาย ' + cb(allC) + ' บาท · ท้ายไฟล์ ' + num(foot.n) + ' หมาย ' + cb(foot.c) + ' บาท — ไม่นำเข้า');
    if (badDate) throw new Error('วันที่ลงข้อมูลอ่านไม่ได้ ' + num(badDate) + ' แถว — ไม่นำเข้า');
    if (!rows.length) throw new Error('ไม่พบรายการหมาย');
    const map = Object.create(null);
    Array.from(new Set(rows.map((r) => r.officer))).forEach((o) => { const id = exactClaimOfficer(o, officers); if (id) map[o] = id; });
    const dates = rows.map((r) => r.date).sort();
    return { name: fileName, rows: rows, map: map, total_n: foot.n, total_c: foot.c, min: dates[0], max: dates[dates.length - 1] };
  }
  async function payoutClaim(m) {
    const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
    const st = Object.assign({ type: 'FREE', date: today, ref: '', seats: '', amt: {}, n: {} }, claimDraftGet() || {});
    let init = null, loadSeq = 0, submitting = false, f25 = null, importBlocked = false, imported = null, readSeq = 0, matchSeq = 0;
    m.innerHTML = top('ตั้งรอบ 60/40 จากยอดจ่ายจริงแบบ 25', '<button type="button" class="btn btn-sm" id="pBack">← กลับ</button>') +
      '<div class="clay panel"><div class="pform">' +
        '<label>ประเภทใบเบิก<select class="inp" id="cType"><option value="FREE">หมายฟรี (เงินงบประมาณ)</option><option value="PAID">หมายเงิน (นอกงบประมาณ)</option></select></label>' +
        '<label>วันที่จ่าย<input type="date" class="inp" id="cDate" required></label>' +
        '<label>คนนั่งงาน (N)<input type="number" class="inp" id="cSeats" min="1" max="1000" step="1" inputmode="numeric" required></label>' +
        '<label>เลขที่ / อ้างอิงใบเบิก<input class="inp" id="cRef" maxlength="100" required placeholder="เลขที่จริง / ปี"></label>' +
      '</div><div id="cInfo" class="small" style="margin-top:10px"></div></div>' +
      '<div class="clay panel cimp"><div class="row" style="justify-content:space-between;align-items:center;gap:10px"><div><b>แบบ 25 · ยอดจ่ายจริงของหมายฟรีและหมายมีเงิน</b> <span class="pchip">ตรวจสอบก่อนยืนยัน</span>' +
        '<div class="tiny muted">แบบ 25 คือแหล่งยอดจ่ายจริงสำหรับทั้งสองประเภท · หากไฟล์เลือก “รวม” ระบบจะแยกหมายฟรีกับหมายมีเงินก่อนคิดยอด · ตรวจรหัสกับทะเบียนและรอบเดิม ป้องกันเบิกซ้ำ · ไม่ส่งชื่อผู้รับหมายขึ้นระบบ</div></div>' +
        '<button type="button" class="btn btn-sm btn-g" id="c25Btn">เลือกไฟล์แบบ 25</button><input type="file" id="c25File" accept=".xls,.xlsx" hidden></div>' +
        '<div class="row" style="gap:10px;margin-top:10px;align-items:end"><label>ลงข้อมูลตั้งแต่<input type="date" class="inp" id="c25From"></label><label>ถึง<input type="date" class="inp" id="c25To"></label><button type="button" class="btn btn-sm" id="c25Apply" disabled>คิดยอดช่วงนี้ใหม่</button></div>' +
        '<div id="c25Info" class="small" style="margin-top:8px"></div></div>' +
      '<div class="clay panel"><h3>ยอดรายคนตามใบเบิก</h3><div class="tbl-wrap"><table class="ctbl"><thead><tr><th class="onm">ผู้ส่งหมาย</th><th class="n">จำนวนเรื่อง</th><th class="n">ยอดใบเบิก (บาท)</th></tr></thead>' +
        '<tbody id="cRows"><tr><td colspan="3" class="muted small">กำลังโหลด…</td></tr></tbody><tfoot><tr><td><b>รวม</b></td><td class="n"><b id="cSumN">0</b></td><td class="n"><b id="cSum">0.00</b></td></tr></tfoot></table></div>' +
        '<p class="tiny muted" style="margin:8px 2px 0">ยอดในใบเบิกเป็นยอดจริงของรอบนี้ · คนที่ไม่มีในใบเบิกเว้นว่าง</p></div>' +
      '<div class="clay panel"><h3>ผลแบ่ง 60:40</h3><div id="cSplit"></div>' +
        '<div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap"><button type="button" class="btn btn-g" id="cGo">ยืนยันตั้งรอบ</button><button type="button" class="btn btn-sm" id="c25Bottom">เลือกไฟล์แบบ 25</button><button type="button" class="btn btn-sm" id="cClear">ล้างค่าที่กรอก</button></div>' +
        '<div id="cGoWhy" class="note small" role="status" aria-live="polite" style="margin-top:10px"></div></div>';
    $('#pBack').addEventListener('click', () => { S.payoutSub = 'list'; go('payout'); });
    $('#cType').value = st.type; $('#cDate').value = st.date; $('#cSeats').value = st.seats; $('#cRef').value = st.ref;
    const save = () => { if (f25 || imported || importBlocked) { claimDraftSet(null); return; } claimDraftSet({ type: st.type, date: st.date, ref: st.ref, seats: st.seats, amt: st.amt, n: st.n }); };
    const viewButton = $('#cGo');
    const onView = () => m.isConnected && m.querySelector('#cGo') === viewButton;
    // A disabled financial confirmation button must always explain WHICH gate is blocking it.
    // Do not bypass the official Form25 evidence, historical round order or duplicate checks.
    const syncGo = () => {
      if (!onView()) return;
      const why = [], official25 = st.date >= '2026-11-20';
      const fileInfo = ($('#c25Info') && $('#c25Info').textContent || '').replace(/\s+/g, ' ').trim();
      if (!init) why.push('ยังไม่พบข้อมูลตั้งรอบจากระบบ — ตรวจข้อความด้านบน');
      else {
        if (init.claim_integrity !== 1) why.push('ระบบตรวจสอบรายการซ้ำไม่พร้อม');
        if (!init.order_ok) why.push('วันที่ตั้งรอบอยู่ก่อนรอบล่าสุด — ต้องแก้วันให้เรียงต่อจากรอบล่าสุด');
        if (official25 && Array.isArray(init.unlinked_rounds) && init.unlinked_rounds.length)
          why.push('มีรอบ' + (st.type === 'FREE' ? 'หมายฟรี' : 'หมายมีเงิน') + 'เก่าที่ยังไม่ผูกรหัสหมาย ' + num(init.unlinked_rounds.length) + ' รอบ ต้องกระทบยอดประวัติก่อน (ห้ามลบรอบเดิม)');
      }
      if (importBlocked) why.push(f25 ? 'แบบ 25 ยังตรวจไม่ผ่าน: ' + (fileInfo || 'ตรวจช่วงวันที่ เลขหมายซ้ำหรือรายการที่จับคู่ไม่ได้') : (fileInfo || 'กำลังตรวจหรืออ่านแบบ 25 — ต้องได้ผลตรวจที่ครบก่อน'));
      else if (official25 && !imported) why.push('รอบวันที่ 20 พฤศจิกายน 2569 เป็นต้นไปต้องนำเข้าแบบ 25 ที่ตรวจจับคู่รายหมายครบ ไม่สามารถยืนยันจากยอดกรอกเอง');
      if (submitting) why.push('กำลังยืนยันรายการอยู่');
      viewButton.disabled = why.length > 0;
      const label = $('#cGoWhy');
      if (label) {
        label.innerHTML = why.length
          ? '<b>ยังยืนยันไม่ได้ เพราะ</b><div style="margin-top:4px">' + why.map(x => '• ' + esc(x)).join('<span style="display:block;margin-top:4px"></span>') + '</div>' +
            (official25 ? '<div class="tiny muted" style="margin-top:6px">วิธีดำเนินการ: เลือกไฟล์แบบ 25 ตรวจช่วงวันที่และผลจับคู่ให้ครบ แล้วจึงยืนยัน หากติดรายการเก่าให้ตรวจรอบเดิมก่อน ไม่ต้องล้างข้อมูล</div>' : '')
          : '<span class="flag-ok">✓ ผ่านเงื่อนไขเบื้องต้น พร้อมตรวจยอดและยืนยัน</span>';
      }
    };
    const read = () => {
      let bad = 0; const lines = [];
      m.querySelectorAll('#cRows tr[data-o]').forEach((tr) => {
        const id = tr.dataset.o, ia = $('.camt', tr), inn = $('.cn', tr);
        const c = claimCents(ia.value), nv = String(inn.value || '').trim(), n = nv === '' ? 0 : Number(nv);
        const okN = Number.isInteger(n) && n >= 0 && n <= 100000;
        ia.classList.toggle('bad', c === null || (c === 0 && n > 0)); inn.classList.toggle('bad', !okN);
        if (c === null || !okN || (c === 0 && n > 0)) { bad++; return; }
        if (c > 0) lines.push({ officer_id: id, c: c, n: n });
      });
      return { lines: lines, bad: bad };
    };
    const calc = () => {
      if (!init) return null;
      const r = read(), free = st.type === 'FREE';
      const sl = r.lines.map((l) => ({ officer_id: l.officer_id, paid_c: free ? 0 : l.c, budget_c: free ? l.c : 0, n_paid: free ? 0 : l.n, n_budget: free ? l.n : 0 }));
      const seats = Number(st.seats);
      const sp = splitPreview(sl, Number.isInteger(seats) && seats >= 1 ? seats : 0, init.policy, init.carry_in_c);
      $('#cSum').textContent = cb(sp.total_c); $('#cSumN').textContent = num(r.lines.reduce((a, l) => a + l.n, 0));
      $('#cSplit').innerHTML = (sp.seats ? '' : '<div class="note">กรอกจำนวนคนนั่งงาน (N) เพื่อคำนวณคนละเท่าใด</div>') + splitTable(sp, init.names, { policyTh: init.policy_th, type: st.type }) +
        (r.bad ? '<div class="note r" style="margin-top:8px">มีช่องที่กรอกไม่ถูกต้อง ' + num(r.bad) + ' ช่อง (ตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง · มีจำนวนเรื่องต้องมียอด)</div>' : '');
      return { sp: sp, bad: r.bad, lines: r.lines };
    };
    const load = async () => {
      const seq = ++loadSeq, type = st.type, date = st.date;
      init = null; syncGo();
      $('#cInfo').innerHTML = '<span class="muted">กำลังโหลด…</span>';
      try { const data = await api('claim_init', { round_type: type, pay_date: date }); if (seq !== loadSeq || !onView()) return; init = data; } catch (e) { if (seq === loadSeq && onView()) $('#cInfo').innerHTML = '<span class="flag-r">' + esc(e.message) + '</span>'; return; }
      if (st.seats === '' && init.seats) { st.seats = String(init.seats); $('#cSeats').value = st.seats; }
      const cf = init.carry_from;
      $('#cInfo').innerHTML = '<div>เศษยกมา <b>' + cb(init.carry_in_c) + ' ฿</b>' + (cf ? ' <span class="muted">จากรอบ ' + esc(cf.type === 'FREE' ? 'หมายฟรี' : 'หมายเงิน') + ' ' + esc(thDate(cf.pay_date)) + '</span>' : ' <span class="muted">(ยอดตั้งต้น)</span>') + ' · วิธีปัด ' + esc(init.policy_th) + '</div>' +
        (init.order_ok ? '' : '<div class="flag-r">วันที่นี้อยู่ก่อนรอบล่าสุด (' + esc(String(init.last_key).replace('|1', ' หมายฟรี').replace('|2', ' หมายเงิน')) + ') — ตั้งรอบได้เฉพาะต่อท้ายรอบล่าสุด</div>') +
        (init.same_date.length ? '<div class="flag-up">มีรอบ' + (st.type === 'FREE' ? 'หมายฟรี' : 'หมายเงิน') + 'วันที่นี้แล้ว ' + num(init.same_date.length) + ' รอบ (' + init.same_date.map((x) => baht2(x.total) + ' ฿').join(', ') + ') — ระวังตั้งซ้ำ</div>' : '');
      if (init.claim_integrity !== 1) $('#cInfo').innerHTML += '<div class="note r">API ยังไม่รองรับการป้องกันซ้ำรุ่น 0.7.31 — ระงับการยืนยัน</div>';
      $('#cRows').innerHTML = init.officers.map((o) => '<tr data-o="' + esc(o.officer_id) + '"><td class="onm">' + oDot(init.names, o.officer_id) + esc(o.name || o.officer_id) + '</td>' +
        '<td class="n"><input class="inp cn" inputmode="numeric" maxlength="6" value="' + esc(st.n[o.officer_id] || '') + '" aria-label="จำนวนเรื่อง ' + esc(o.name) + '"></td>' +
        '<td class="n"><input class="inp camt" inputmode="decimal" maxlength="14" value="' + esc(st.amt[o.officer_id] || '') + '" aria-label="ยอดตามใบเบิก ' + esc(o.name) + '" placeholder="0.00"></td></tr>').join('');
      m.querySelectorAll('#cRows input').forEach((inp) => inp.addEventListener('input', () => {
        const id = inp.closest('tr').dataset.o; (inp.classList.contains('camt') ? st.amt : st.n)[id] = inp.value; save(); calc();
      }));
      calc(); syncGo();
    };
    const resetImport = () => { ++readSeq; ++matchSeq; f25 = null; imported = null; importBlocked = false; $('#c25Apply').disabled = true; $('#c25From').value = ''; $('#c25To').value = ''; $('#c25Info').innerHTML = ''; };
    const resetAmounts = () => { st.amt = {}; st.n = {}; st.ref = ''; $('#cRef').value = ''; $('#cRows').innerHTML = ''; $('#cSum').textContent = '0.00'; $('#cSumN').textContent = '0'; $('#cSplit').innerHTML = ''; };
    $('#cType').addEventListener('change', (e) => { st.type = e.target.value; resetImport(); resetAmounts(); save(); load(); });
    $('#cDate').addEventListener('change', (e) => { st.date = e.target.value || today; if (f25 || imported || importBlocked) { resetImport(); resetAmounts(); } save(); load(); });
    $('#cSeats').addEventListener('input', (e) => { st.seats = e.target.value; save(); calc(); });
    $('#cRef').addEventListener('input', (e) => { st.ref = e.target.value; save(); });
    $('#c25Bottom').addEventListener('click', () => $('#c25File').click());
    $('#cClear').addEventListener('click', async () => {
      if (!(await askBox('ล้างยอดและจำนวนเรื่องที่กรอกทั้งหมด?'))) return;
      resetImport(); resetAmounts(); save(); load();
    });
    $('#cGo').addEventListener('click', async () => {
      if (submitting || importBlocked || !init || init.claim_integrity !== 1 || (f25 && !imported)) return;
      if (String(st.ref || '').length > 100) { toast('เลขอ้างอิงรวมช่วงวันที่ยาวเกิน 100 ตัวอักษร'); $('#cRef').focus(); return; }
      if (!String(st.ref || '').replace(/แบบ25:\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}/g,'').trim()) { toast('กรอกเลขที่ใบเบิกจริง'); $('#cRef').focus(); return; }
      const r = calc(); if (!r) return;
      const seats = Number(st.seats);
      if (!(Number.isInteger(seats) && seats >= 1 && seats <= 1000)) { toast('กรอกจำนวนคนนั่งงาน (N) 1–1000 คน'); $('#cSeats').focus(); return; }
      if (r.bad) { toast('แก้ช่องที่กรอกไม่ถูกต้องก่อน'); return; }
      if (!r.lines.length) { toast('ยังไม่ได้กรอกยอดตามใบเบิก'); return; }
      if (!init.order_ok) { toast('วันที่นี้อยู่ก่อนรอบล่าสุด — ตั้งรอบไม่ได้'); return; }
      const sp = r.sp, tname = st.type === 'FREE' ? 'หมายฟรี' : 'หมายเงิน';
      const snapshot = JSON.stringify([st.type, st.date, st.ref, st.seats, r.lines, imported]);
      submitting = true; syncGo();
      try {
      if (imported && (!st.ref.includes(imported.tag) || !init.form25_ranges)) { toast('ช่วงแบบ 25 เปลี่ยนหรือ API ไม่รองรับ กรุณานำเข้าใหม่'); return; }
      if (imported && JSON.stringify(r.lines.map(l => [l.officer_id,l.c,l.n]).sort()) !== imported.lines ) { toast('ยอดหรือจำนวนรายคนต่างจากแบบ 25 — กรุณาคิดยอดจากไฟล์ใหม่'); return; }
      const ok = await askBox('ยืนยันตั้งรอบ ' + tname + ' ตามใบเบิก วันที่ ' + thDate(st.date) + '\n• ผู้ส่ง ' + num(r.lines.length) + ' คน ยอดรวม ' + cb(sp.total_c) + ' บาท' +
        '\n• เจ้าหน้าที่ส่งหมาย 60% ' + cb(sp.c60) + ' · ยอดโอนคืน 40% ' + cb(sp.pool40_c) + ' + เศษยกมา ' + cb(sp.carry_in_c) +
        '\n• คนนั่งงาน ' + num(seats) + ' คน ได้คนละ ' + cb(sp.per_seat_c) + ' บาท · เศษยกไป ' + cb(sp.carry_out_c));
      if (!ok || !onView() || !init || snapshot !== JSON.stringify([st.type, st.date, st.ref, st.seats, read().lines, imported])) return;
      if (imported && !(await askBox('ยืนยันตรวจยอดตามใบเบิกจริง? ระบบจะตรวจรหัสหมายกับทะเบียนและประวัติรอบก่อนบันทึก'))) return;
      if (!imported && !(await askBox('กรอกยอดเองยังไม่ผูกรายหมาย — ตรวจเอกสารใบเบิกและรายการรายฉบับกับรอบเดิมแล้วว่าไม่ซ้ำ ใช่หรือไม่?'))) return;
      if (!onView() || !init || snapshot !== JSON.stringify([st.type, st.date, st.ref, st.seats, read().lines, imported])) return;
      const body = { round_type: st.type, pay_date: st.date, seats: seats, claim_ref: st.ref, expect_total_c: sp.total_c, expect_carry_c: init.carry_in_c,
                     lines: r.lines.map((l) => ({ officer_id: l.officer_id, amount: (l.c / 100).toFixed(2), n: l.n })) };
      if (init.same_date.length) {
        if (!(await askBox('มีรอบ' + tname + 'วันที่ ' + thDate(st.date) + ' อยู่แล้ว ' + num(init.same_date.length) + ' รอบ\nยืนยันว่าเป็นใบเบิกคนละชุด (ไม่ใช่ตั้งซ้ำ)?'))) return;
        body.allow_same_date = true;
      }
      if (!onView() || !init || importBlocked || snapshot !== JSON.stringify([st.type, st.date, st.ref, st.seats, read().lines, imported])) { toast('ข้อมูลเปลี่ยน กรุณาตรวจอีกครั้ง'); return; }
      if (imported) { body.form25_range = {from: imported.from, to: imported.to}; body.form25_rows = imported.rows; } else { body.confirm_manual_review = true; }
      try {
        const x = await api('claim_confirm', body);
        claimDraftSet(null); toast('ตั้งรอบแล้ว · คนนั่งงานได้คนละ ' + baht2(x.round.per_seat) + ' บาท');
        S.payoutSub = 'round:' + x.round.round_id; go('payout');
      } catch (e) { toast(e.message); if (/STALE|เศษยกมา/.test(String(e.code || '') + e.message)) load(); }
      } finally { submitting = false; syncGo(); }
    });
    /* 0.7.28 นำเข้าแบบ 25 ยอดสะสม → คัดช่วงวันที่ลงข้อมูลหลังรอบก่อน → เติมยอดรายคน (ไม่อ่านคอลัมน์ผู้รับหมาย) */
    const c25Info = (h) => { $('#c25Info').innerHTML = h; syncGo(); };
    let cutBasis = '';
    const lastCut = () => {
      if (!init || !Array.isArray(init.form25_ranges)) throw new Error('API ยังไม่รองรับการตรวจช่วงแบบ 25 — อัปเดตหลังบ้านก่อน');
      const best = init.form25_ranges.reduce((a,r) => r.to > a ? r.to : a, '');
      cutBasis = best ? 'ช่วงแบบ 25 ล่าสุดถึง ' + thDate(best) : 'ยังไม่พบช่วงแบบ 25 ที่บันทึกไว้ — ตรวจรายการค้างจากรอบเดิม';
      return best;
    };
    const apply25 = async () => {
      if (!f25 || !init || submitting) return;
      const seq=++matchSeq, source=f25, pd=st.date;
      const oldRef = st.ref; imported = null; importBlocked = true; syncGo(); resetAmounts();
      const from = $('#c25From').value, to = $('#c25To').value, want = st.type;
      if (!claimIsoDay(from) || !claimIsoDay(to) || from > to || from < f25.min || to > f25.max || to > st.date) { c25Info('<div class="note r">ช่วงวันที่ไม่ถูกต้องหรือเกินวันที่จ่าย</div>'); return; }
      if (!Array.isArray(init.form25_ranges) || claimRangeOverlap(from, to, init.form25_ranges)) { c25Info('<div class="note r">ช่วงนี้ทับกับรอบแบบ 25 เดิม หรือ API ไม่รองรับการตรวจช่วง — ระงับยืนยัน</div>'); return; }
      const agg = Object.create(null), miss = Object.create(null), picked = [], seen = new Set(); let n = 0, sum = 0, before = 0, missingUid = 0, repeatedUid = 0;
      f25.rows.forEach((r) => {
        if (r.type !== want) return;
        if (from && r.date < from) { before++; return; }
        if (to && r.date > to) return;
        const id = f25.map[r.officer];
        if (!id) { miss[r.officer] = (miss[r.officer] || 0) + r.c; return; }
        picked.push({notice_uid:r.uid, evidence:r.evidence||'', officer_id:id, date:r.date, amount:(r.c/100).toFixed(2)});
        agg[id] = agg[id] || { n: 0, c: 0 }; agg[id].n++; agg[id].c += r.c; n++; sum += r.c;
      });
      st.amt = {}; st.n = {};
      Object.keys(agg).forEach((id) => { st.amt[id] = (agg[id].c / 100).toFixed(2); st.n[id] = String(agg[id].n); });
      const tag = 'แบบ25:' + (from || f25.min) + '..' + (to || f25.max);
      st.ref = (tag + ' ' + String(oldRef || '').replace(/แบบ25:\S+\s*/g, '')).trim(); $('#cRef').value = st.ref;
      const mk = Object.keys(miss);
      const unresolved = init.unlinked_rounds || [];
      let matchNote='';
      // Query only rows that need registry matching. No raw names or case text are sent.
      const pending=picked.filter(r=>!r.notice_uid&&r.evidence);
      if(pending.length && init.form25_match===1){
        c25Info('<span class="spin"></span> กำลังตรวจหลักฐานกับทะเบียน (อ่านอย่างเดียว)…');
        try{
          const match=await api('claim_match25',{round_type:want,pay_date:pd,cutoff:to,rows:pending.map(r=>({evidence:r.evidence,officer_id:r.officer_id,date:r.date,amount:r.amount}))});
          if(seq!==matchSeq||source!==f25||want!==st.type||pd!==st.date||!onView())return;
          if(!Array.isArray(match.matches)||match.matches.length!==pending.length)throw new Error('ข้อมูลจับคู่ไม่ครบ');
          let linked=0;const reasons=Object.create(null);
          match.matches.forEach((x,i)=>{if(x&&x.status==='MATCHED'&&x.uid){pending[i].notice_uid=x.uid;linked++;}else{const k=x&&x.status||'UNKNOWN';reasons[k]=(reasons[k]||0)+1;}});
          const labels={NOT_FOUND:'ไม่พบในทะเบียน',AMBIGUOUS:'พบหลายฉบับ',DATE_OR_UNIT_MISMATCH:'วันที่หรือหน่วยหมายไม่ตรง',ALREADY_LINKED:'อยู่ในรอบแล้ว',AMOUNT_OR_CANDIDATE_MISMATCH:'ยอดหรือสถานะไม่ตรง',DUPLICATE_IN_FILE:'ซ้ำในไฟล์',OFFICER_MISMATCH:'ผู้ส่งไม่ตรง',TYPE_MISMATCH:'ประเภทไม่ตรง',PRIVACY_REVIEW:'ข้อมูลเดิมต้องตรวจการตัดชื่อ',MISSING_EVIDENCE:'หลักฐานไม่ครบ'};
          matchNote='<div class="note">จับคู่จากทะเบียน '+num(linked)+' / '+num(pending.length)+' รายการ'+(Object.keys(reasons).length?' · '+Object.keys(reasons).map(k=>esc(labels[k]||k)+' '+num(reasons[k])).join(' · '):'')+'</div>';
          (match.unlinked_rounds||[]).forEach(id=>{if(!unresolved.includes(id))unresolved.push(id);});
        }catch(e){if(seq!==matchSeq||!onView())return;matchNote='<div class="note r">ตรวจทะเบียนไม่สำเร็จ — ระงับยืนยัน ('+esc(e.message)+')</div>';}
      }
      if(seq!==matchSeq||source!==f25||want!==st.type||pd!==st.date||!onView())return;
      picked.forEach(r=>{if(!r.notice_uid)missingUid++;else if(seen.has(r.notice_uid))repeatedUid++;else seen.add(r.notice_uid);});
      imported = {from, to, tag, rows:picked, lines: JSON.stringify(Object.keys(agg).map(id => [id,agg[id].c,agg[id].n]).sort())};
      importBlocked = mk.length > 0 || !n || missingUid > 0 || repeatedUid > 0 || unresolved.length > 0; save(); load();
      c25Info('<div class="note">' + esc(f25.name) + ' · ตรวจยอดท้ายไฟล์ตรง (' + num(f25.total_n) + ' หมาย ' + cb(f25.total_c) + ' บาท) · ' +
        (want === 'FREE' ? 'หมายฟรี' : 'หมายเงิน') + ' ที่ลงข้อมูล ' + esc(thDate(from || f25.min)) + ' – ' + esc(thDate(to || f25.max)) + ' : <b>' + num(n) + ' เรื่อง ' + cb(sum) + ' บาท</b>' +
        (before ? ' · ข้ามรายการก่อนช่วง ' + num(before) + ' เรื่อง' : '') + (cutBasis ? '<br><span class="tiny muted">วันที่เริ่ม: ' + esc(cutBasis) + '</span>' : '') + '</div>' +
        matchNote + (missingUid || repeatedUid ? '<div class="note r">ตรวจยอดได้เท่านั้น · ขาด notice_uid '+num(missingUid)+' รายการ · รหัสซ้ำ '+num(repeatedUid)+' รายการ — ต้องใช้รหัสจากทะเบียนจริง</div>' : '') + (unresolved.length ? '<div class="note r">มีรอบเดิมยังไม่ผูกรายหมาย '+num(unresolved.length)+' รอบ — ต้องกระทบยอดก่อนยืนยัน</div>' : '') +
        (mk.length ? '<div class="note r">ไม่พบผู้ส่งในระบบ: ' + mk.map((k) => esc(k) + ' ' + cb(miss[k]) + ' บาท').join(' · ') + ' — เพิ่มที่ ตั้งค่า › ผู้ส่งหมายและอัตรา แล้วนำเข้าใหม่</div>' : ''));
    };
    const read25 = async (file) => {
      if (submitting || !init) return;
      const seq = ++readSeq, type = st.type, date = st.date, officers = init.officers; ++matchSeq;
      f25 = null; imported = null; importBlocked = true; claimDraftSet(null); resetAmounts(); syncGo(); $('#c25Apply').disabled = true;
      if (!window.XLSX) { toast('กำลังโหลดตัวอ่าน Excel กรุณาลองอีกครั้ง'); return; }
      c25Info('<span class="spin"></span> กำลังอ่านไฟล์…');
      try {
        const bytes = await file.arrayBuffer(); if (seq !== readSeq || type !== st.type || date !== st.date || !onView()) return;
        const wb = XLSX.read(bytes, { type: 'array', cellDates: false });
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
        f25 = parseClaim25Rows(aoa, officers, file.name);
        const cut = lastCut();
        const next = cut ? new Date(Date.parse(cut + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10) : f25.min;
        $('#c25From').value = next > f25.min ? next : f25.min; $('#c25To').value = f25.max < st.date ? f25.max : st.date; $('#c25Apply').disabled = false;
        apply25();
      } catch (e) { if (seq !== readSeq || !onView()) return; f25 = null; imported = null; importBlocked = true; syncGo(); c25Info('<div class="note r">' + esc(e.message) + '</div>'); }
    };
    $('#c25Btn').addEventListener('click', () => $('#c25File').click());
    $('#c25File').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) read25(f); });
    $('#c25Apply').addEventListener('click', apply25);
    ['#c25From','#c25To'].forEach(sel => $(sel).addEventListener('change', () => { if (f25) { ++matchSeq; imported = null; importBlocked = true; syncGo(); c25Info('<div class="note">ช่วงวันที่เปลี่ยน กรุณากดคิดยอดช่วงนี้ใหม่</div>'); } }));
    load();
  }

  async function payoutNew(m, type, pd) {
    const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
    const free = type === 'FREE';
    let pending = [];
    if (!free) { try { pending = (await api('payout_list')).pending_dates; } catch (e) { pending = []; } }
    m.innerHTML = top((free ? 'เตรียมเบิก' : 'ตั้งรอบ') + RTYPE_TH[free ? 'FREE' : 'PAID'], '<button type="button" class="btn btn-sm" id="pBack">← กลับ</button>') +
      '<form class="clay panel" id="pForm"><div class="pform">' +
      (free ? '<label>วันที่จ่าย (วันที่ได้รับเงิน)<input type="date" class="inp" id="pDate" value="' + today + '" required></label>' +
              '<label>หมายที่ลงข้อมูล (รายงานผล) ถึงวันที่<input type="date" class="inp" id="pCut" value="' + today + '" required></label>' +
              '<label>บัญชีขอเบิกของศาล ตั้งแต่วันที่<input type="date" class="inp" id="pFrom" value="' + today.slice(0, 8) + '01' + '" title="ใช้เทียบว่ามีเรื่องที่ศาลเบิก แต่ระบบบันทึกว่าเบิกแล้ว"></label>'
            : '<label>วันที่จ่ายตามบัญชีการจ่ายเงิน<select class="inp" id="pDate" required>' + (pending.length ? pending.map((x) => '<option value="' + esc(x.pay_date) + '"' + (x.pay_date === pd ? ' selected' : '') + '>' + esc(thDate(x.pay_date)) + ' · ' + num(x.rows) + ' เรื่อง · ' + baht2(x.amount) + ' ฿</option>').join('') : '<option value="">— ยังไม่มีบัญชีจ่ายเงินที่รอตั้งรอบ —</option>') + '</select></label>') +
      '<button class="btn btn-g" id="pLoad"' + (!free && !pending.length ? ' disabled' : '') + '>ดึงรายการ</button></div>' +
      '<p class="tiny muted" style="margin:10px 2px 0">' + (free
        ? 'ระบบเสนอหมายฟรีที่ส่งแล้ว ลงข้อมูลไม่เกินวันที่กำหนด และยังไม่เคยเบิก (ราคาตามบัญชีศาล ไฟล์ 18) · กรอก <b>ยอดรายคนจากใบแบ่งยอด</b> ได้ ระบบจะบอกคนที่ไม่ตรงและเสนอเรื่องที่ควรเอาออก · เรื่องที่เอาออก = <b>ยังไม่เสนอเบิกจ่าย</b> ยกไปรอบหน้า · เบิกได้หลายครั้งต่อเดือน'
        : 'ใช้รายการจากบัญชีการจ่ายเงินให้เจ้าพนักงานศาลของวันที่จ่ายนั้นทั้งหมด (ยอดตามไฟล์) · ถ้ายังไม่มีวันที่ต้องการ ให้นำเข้าไฟล์ที่เมนู "นำเข้าข้อมูล" ก่อน') + '</p></form><div id="pBody"></div>';
    $('#pBack').addEventListener('click', () => { S.payoutSub = 'list'; go('payout'); });
    const load = async () => {
      const body = $('#pBody'); body.innerHTML = '<div class="clay panel"><span class="spin"></span> <span class="muted">กำลังดึงรายการ…</span></div>';
      try {
        const d = await api('payout_candidates', { round_type: free ? 'FREE' : 'PAID', pay_date: $('#pDate').value, cutoff: free ? $('#pCut').value : '', claim_from: free && $('#pFrom') ? $('#pFrom').value : '' });
        drawPicker(body, d);
      } catch (x) { body.innerHTML = '<div class="clay panel"><p class="note r" style="margin:0">' + esc(x.message) + '</p></div>'; }
    };
    $('#pForm').addEventListener('submit', (e) => { e.preventDefault(); load(); });
    if (!free && pd) load();
  }

  /** หาชุดเรื่องที่เอาออกแล้วยอดเท่าส่วนต่าง (เรื่องน้อยที่สุด · ลงข้อมูลล่าสุดก่อน) */
  function suggestDrop(items, diffC) {
    const L = items.filter((it) => it.amount_c > 0).sort((a, b) => b.report_date.localeCompare(a.report_date)).slice(0, 120);
    if (diffC <= 0 || !L.length) return null;
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    const g = L.reduce((a, it) => gcd(a, it.amount_c), diffC);
    const T = diffC / g; if (T > 20000) return null;
    const best = new Array(T + 1).fill(null); best[0] = [];
    L.forEach((it) => {
      const a = it.amount_c / g;
      for (let s = T; s >= a; s--) if (best[s - a] && (!best[s] || best[s - a].length + 1 < best[s].length)) best[s] = best[s - a].concat([it.key]);
    });
    return best[T];
  }

  function matchLabel(m) { return ({OK:'จับคู่ครบ',NONE:'ยังไม่พบหมายต้นทาง',TYPE:'ประเภทหรือผู้ส่งไม่ตรง',AMBIGUOUS:'จับคู่กำกวม',PARTIAL:'จับคู่ได้บางส่วน'})[m] || 'ข้อมูลสถานะไม่ครบ'; }
  function drawPicker(box, d) {
    const names = d.officers, off = new Set(), nc = new Set(), free = d.round_type === 'FREE', targets = {};   // off = ยกไปรอบหน้า · nc = ไม่เบิก (0.7.25)
    const elsewhere = Object.fromEntries((d.elsewhere || []).map((e) => [e.officer_id, e]));
    const byOff = {};
    d.items.forEach((it) => { if (!it.adj) (byOff[it.officer_id] = byOff[it.officer_id] || []).push(it); });
    const offIds = Object.keys(byOff).sort(), adjs = d.items.filter((it) => it.adj);   // 0.7.21 ยอดปรับปรุงจากรายการที่อนุมัติ
    const adjRow = (it) => '<label class="pit padj-i" data-k="' + esc(it.key) + '"><input type="checkbox" checked data-k="' + esc(it.key) + '">' + oDot(names, it.officer_id) +
      '<span class="pcase">' + esc(oName(names, it.officer_id)) + ' · ' + esc(it.case_list || '—') + ' <span class="tiny muted">' + esc(it.adj_reason) + '</span></span>' +
      '<span class="tiny muted pdt">' + (it.source_round_id ? 'จากรอบ ' + esc(it.source_round_id) : '') + '</span>' +
      (it.held ? '<span class="pchip ph" title="รอบ ' + esc(it.held.round_id) + '">เคยเลื่อน ' + esc(thDate(it.held.pay_date)) + '</span>' : '') +
      '<span class="pnot">ยกไปรอบหน้า</span><b class="pamt' + (it.amount_c < 0 ? ' flag-r' : '') + '">' + cb(it.amount_c) + '</b></label>';
    const carry0 = Math.round((d.carry_in || 0) * 100);
    if (!d.items.length) {
      box.innerHTML = '<div class="clay panel"><p class="small muted" style="margin:0">' + (free ? 'ไม่มีหมายฟรีที่จะเตรียมเบิกตามเงื่อนไขนี้ (ยังไม่ส่ง ' + num(d.blocked.wait) + ' · ลงข้อมูลหลังวันที่กำหนด ' + num(d.blocked.late) + ' · รอตรวจ ' + num(d.blocked.review) + ')' : 'ไม่มีรายการในบัญชีจ่ายเงินของวันที่นี้ (อาจตั้งรอบไปแล้ว)') + '</p></div>';
      return;
    }
    const sameUnitZero = (it) => d.items.filter((x) => x.unit_id && x.unit_id === it.unit_id && x.key !== it.key && x.amount_c === 0);
    const row = (it) => '<label class="pit' + (it.amount_c === 0 ? ' pzero' : '') + '" data-k="' + esc(it.key) + '">' + (free ? '<input type="checkbox" checked data-k="' + esc(it.key) + '">' : '<span class="pdot' + (it.match === 'OK' ? '' : ' r') + '"></span>') +
      '<span class="pcase">' + esc(it.case_list) + (free && it.notice_kind ? ' <span class="tiny muted">' + esc(it.notice_kind) + '</span>' : '') +
        (!free && it.match !== 'OK' ? ' <span class="tiny flag-r">รอยืนยันการจับคู่' + (it.received_date ? ' (รับเงิน ' + esc(thDate(it.received_date)) + ')' : '') + '</span>' : '') + '</span>' +
      '<span class="tiny muted pdt">' + (free ? 'ลงข้อมูล ' + esc(thDate(it.report_date)) + (it.tambon ? ' · ต.' + esc(it.tambon) : '') + (it.age_days ? ' · ค้าง ' + num(it.age_days) + ' วัน' : '') : 'ใบเสร็จ ' + esc(it.receipt_no || '—')) + '</span>' +
      (it.held ? '<span class="pchip ph" title="รอบ ' + esc(it.held.round_id) + '">เคยเลื่อน ' + esc(thDate(it.held.pay_date)) + '</span>' : '') +
      (it.diff ? '<span class="tiny ' + (it.diff.dir === 'UP' ? 'flag-up' : 'flag-r') + '" title="' + esc(it.diff.text) + '">' + (it.diff.dir === 'UP' ? '▲' : '▼') + ' ระบบ ' + cb(it.amount_c + (it.diff.dir === 'UP' ? -1 : 1) * it.diff.diff * 100) + '</span>' : '') +
      (free && it.src === 'SYS' ? '<span class="tiny muted" title="ยังไม่มีราคาในบัญชีศาล (ไฟล์ 18)">ยอดระบบ</span>' : '') +
      (it.amount_c === 0 ? '<span class="tiny muted">รวมในหมายอื่น</span>' : '') +
      (free && d.can_noclaim && !it.adj ? '<button type="button" class="btn btn-xs pnc" data-nc="' + esc(it.key) + '" title="ไม่เบิกเรื่องนี้ (ต้องมีเหตุผล)">ไม่เบิก</button>' : '') +
      '<span class="pnot">ยกไปรอบหน้า</span><span class="pnot pnot-nc">ไม่เบิก</span><b class="pamt">' + cb(it.amount_c) + '</b></label>';
    const elseHtml = (id) => { const e = elsewhere[id]; if (!e) return '';
      return '<p class="note r small pelse" style="margin:6px 0">ช่วงบัญชีขอเบิกนี้ ระบบบันทึกว่า<b>เบิกแล้ว</b> ' + num(e.n) + ' ฉบับ · ' + baht2(e.amount) + ' บาท' + (e.src === 'SYS' ? ' (ยอดระบบ)' : ' (ราคาตามบัญชีศาล)') +
        ' · ' + e.rounds.map((r) => 'รอบ ' + esc(thDate(r.pay_date)) + (r.paid ? ' บันทึกจ่ายแล้ว' : ' ยังไม่บันทึกจ่าย')).join(', ') +
        '<br><span class="tiny">' + esc(e.cases.slice(0, 12).join(', ')) + (e.cases.length > 12 ? ' …' : '') + ' — ถ้าศาลเบิกเรื่องเหล่านี้อีก แปลว่าเบิกซ้ำ หรือรอบเดิมบันทึกผิด</span></p>'; };
    const unpaid = (d.unpaid || []);
    box.innerHTML = '<div class="pgrid"><div class="plist">' +
      (free ? '<div class="clay panel ptgt"><b>ตรวจกับใบแบ่งยอด</b> <span class="small muted">กรอกยอดรายคนจากใบแบ่งยอด (ถ้ามี) — ระบบบอกคนที่ไม่ตรงและเสนอเรื่องที่ควรเอาออก</span> <button type="button" class="btn btn-sm" id="pSugAll" disabled>ใช้ตามที่เสนอทั้งหมด</button></div>' : '') +
      offIds.map((id) =>
      '<section class="clay panel poff" data-o="' + esc(id) + '"><div class="poff-h"><label class="ck">' + (free ? '<input type="checkbox" checked data-all="' + esc(id) + '"> ' : '') + oDot(names, id) + '<b>' + esc(oName(names, id)) + '</b></label>' +
      '<span class="small muted" data-sum="' + esc(id) + '"></span>' +
      (free ? '<span class="ptin"><input type="text" inputmode="decimal" class="inp" placeholder="ยอดใบแบ่งยอด" data-tg="' + esc(id) + '"><span class="tiny" data-tst="' + esc(id) + '"></span></span>' : '') + '</div>' +
      (free ? elseHtml(id) + byOff[id].map(row).join('') : '<details class="pdet"><summary>ดูรายเรื่อง (' + num(byOff[id].length) + ')' + (byOff[id].some((x) => x.match !== 'OK') ? ' · <span class="flag-r">ต้องตรวจการเชื่อมโยง ' + num(byOff[id].filter((x) => x.match !== 'OK').length) + '</span>' : '') + '</summary>' + byOff[id].map(row).join('') + '</details>') + '</section>').join('') +
      (adjs.length ? '<section class="clay panel padj"><h3>ยอดปรับปรุงจากรายการที่อนุมัติ (' + num(adjs.length) + ')</h3><p class="tiny muted" style="margin:0 0 8px">แบ่ง 60:40 รวมกับยอดของผู้ส่งในรอบนี้ · ติ๊กออก = ยกไปรอบหน้า · ไม่พิมพ์ในบัญชีที่ขอเบิกทางราชการ · รอบเดิมไม่ถูกแก้</p>' + adjs.map(adjRow).join('') + '</section>' : '') +
      (!free && unpaid.length ? '<section class="clay panel"><h3>ส่งแล้วแต่ไม่อยู่ในบัญชีจ่ายวันนี้ (' + num(unpaid.length) + ')</h3><p class="tiny muted" style="margin:0 0 8px">ลงข้อมูลก่อนวันที่จ่ายนี้ แต่ศาลยังไม่จ่าย — ค้างในรายการยังไม่เข้ารอบในระบบ ไปรอบหน้า</p><details class="pdet"><summary>ดูรายเรื่อง</summary>' +
        unpaid.map((u) => '<div class="pit out-i">' + oDot(names, u.officer_id) + '<span class="pcase">' + esc(u.case_no) + ' <span class="tiny muted">' + esc(u.notice_kind) + '</span></span><span class="tiny muted pdt">' + esc(oName(names, u.officer_id)) + ' · ลงข้อมูล ' + esc(thDate(u.report_date)) + '</span><b class="pamt">' + cb(u.amount_c) + '</b></div>').join('') + '</details></section>' : '') +
      '</div><aside class="clay panel psum"><h3>สรุปรอบ ' + esc(RTYPE_TH[d.round_type]) + ' · ' + esc(thDate(d.pay_date)) + '</h3><div id="pSplit"></div>' +
      '<label class="pseat">จำนวนคนนั่งงาน (N)<input type="number" class="inp" id="pSeats" min="1" max="1000" value="' + esc(d.seats) + '"><span class="tiny muted">ค่าล่าสุดที่ใช้ · แก้ได้ รอบเก่าไม่เปลี่ยน</span></label>' +
      '<label class="pseat">เศษยกมา (บาท)<input type="number" class="inp" id="pCarry" min="0" step="0.01" value="' + esc(d.carry_in) + '"><span class="tiny muted">' + (d.carry_from ? 'จากรอบ ' + esc(thDate(d.carry_from.pay_date)) + ' ' + esc(RTYPE_TH[d.carry_from.type] || '') : 'ยอดตั้งต้น (ยังไม่มีรอบก่อนหน้า)') + '</span></label>' +
      '<label class="pseat hidden" id="pCarryNoteL">เหตุผลที่แก้เศษยกมา<input class="inp" id="pCarryNote" maxlength="200" placeholder="เช่น เศษจากใบแบ่งยอดก่อนใช้ระบบ"></label>' +
      '<label class="pseat">หมายเหตุ (ถ้ามี)<input class="inp" id="pNote" maxlength="300" placeholder="เช่น เลื่อนจ่ายจากวันศุกร์"></label>' +
      (d.order_ok ? '' : '<p class="note r small">มีรอบที่ยืนยันแล้วหลังวันที่นี้ — ตั้งรอบย้อนหลังไม่ได้ (เศษยกจะคลาดเคลื่อน)</p>') +
      (d.requires_form25 ? '<div class="note r small">ยอดนี้เป็นเพียงรายการคาดว่าจะเบิกจากแบบ 18/30 ยังไม่ใช่ยอดจ่ายจริง · สำหรับรอบใหม่นำเข้าแบบ 25 ก่อน (แยกประเภทฟรี/มีเงินและตรวจหมายทีละฉบับ)</div><button type="button" class="btn btn-g" id="pTo25" style="width:100%">ไปที่แบบ 25 · ยอดจ่ายจริง</button>' : '') +
      '<button type="button" class="btn btn-g" id="pOk" style="width:100%">ยืนยันรอบ</button>' +
      (!free && d.can_outside ? '<div class="note small" style="margin-top:10px"><b>บัญชีวันนี้แบ่ง 60:40 นอกระบบไปแล้ว?</b><br><span class="tiny">เช่น งานเดือน ก.ย. ก่อนเริ่มระบบ · บันทึกแล้ววันที่นี้จะไม่อยู่ในรายการรอตั้งรอบและรอจับคู่ ยอดบัญชีคงเดิม ไม่สร้างรอบ ไม่คิดเศษยก · ยกเลิกได้</span>' +
        '<button type="button" class="btn btn-sm" id="pOutside" style="width:100%;margin-top:8px">บันทึกว่าแบ่งจ่ายนอกระบบแล้ว</button></div>' : '') +
      (free ? '<button type="button" class="btn btn-sm" id="pDraft" style="width:100%;margin-top:8px">พิมพ์บัญชีหมายฟรีที่ขอเบิก (ร่าง)</button>' : '') +
      (free ? '<button type="button" class="btn btn-sm" id="pSaveDraft" style="width:100%;margin-top:8px">บันทึกร่าง (ยังไม่ล็อกหมาย)</button>' +
        (d.draft ? '<p class="tiny muted" style="margin:6px 2px 0" id="pDraftInfo">ใช้ร่างที่บันทึกเมื่อ ' + esc(thDate(d.draft.at, true)) + ' โดย ' + esc(d.draft.by) + ' · <a href="#" id="pClearDraft">ล้างร่าง</a></p>' : '') : '') +
      '<p class="tiny muted" style="margin:8px 2px 0">ที่มา: ' + esc(d.source) + ' · ยืนยันแล้วหมายในรอบถูกล็อก เบิกซ้ำไม่ได้ · ยกเลิกได้เฉพาะรอบล่าสุดโดยผู้ดูแลระบบ</p></aside></div>';
    const sug = {};
    const recalc = () => {
      const inc = d.items.filter((it) => !off.has(it.key));
      const by = {};
      inc.forEach((it) => { const l = by[it.officer_id] = by[it.officer_id] || { officer_id: it.officer_id, paid_c: 0, budget_c: 0, n_paid: 0, n_budget: 0 };
        if (it.type === 'PAID') { l.paid_c += it.amount_c; l.n_paid += it.n; } else { l.budget_c += it.amount_c; l.n_budget += it.n; } });
      const carryC = Math.round(Number($('#pCarry').value || 0) * 100);
      const sp = splitPreview(Object.keys(by).sort().map((k) => by[k]), $('#pSeats').value, d.policy, carryC);
      const negOff = Object.keys(by).filter((k) => by[k].paid_c + by[k].budget_c < 0);
      $('#pSplit').innerHTML = (negOff.length ? '<p class="note r small" style="margin:0 0 8px">ยอดปรับลดมากกว่ายอดของ ' + esc(negOff.map((k) => oName(names, k)).join(', ')) + ' ในรอบนี้ — ติ๊กยอดปรับปรุงออกเพื่อยกไปรอบหน้า</p>' : '') +
        splitTable(sp, names, { policyTh: d.policy_th, type: d.round_type });
      $('#pCarryNoteL').classList.toggle('hidden', carryC === carry0);
      let anySug = false;
      offIds.forEach((id) => {
        const all = byOff[id], sel = all.filter((it) => !off.has(it.key)), selC = sel.reduce((a, x) => a + x.amount_c, 0);
        const nNc = all.filter((it) => nc.has(it.key)).length;
        box.querySelector('[data-sum="' + id + '"]').textContent = (free ? 'เบิก ' + sel.length + '/' + all.length + ' เรื่อง' + (nNc ? ' · ไม่เบิก ' + nNc : '') + ' · ' : num(all.length) + ' เรื่อง · ') + cb(selC) + ' ฿';
        const ca = box.querySelector('[data-all="' + id + '"]'); if (ca) { ca.checked = sel.length === all.length; ca.indeterminate = sel.length > 0 && sel.length < all.length; }
        const st = box.querySelector('[data-tst="' + id + '"]'); delete sug[id];
        if (st) {
          const t = targets[id];
          if (t === undefined) st.innerHTML = '';
          else if (t === selC) st.innerHTML = '<span class="flag-ok">✓ ตรง</span>';
          else if (selC > t) {
            const k = suggestDrop(sel, selC - t);
            if (k) { sug[id] = k; anySug = true; st.innerHTML = '<span class="flag-r">เกิน ' + cb(selC - t) + '</span> <button type="button" class="btn btn-xs" data-sg="' + esc(id) + '">เสนอเอาออก ' + k.length + ' เรื่อง</button>'; }
            else st.innerHTML = '<span class="flag-r">เกิน ' + cb(selC - t) + ' · หาชุดที่ตรงไม่ได้ ติ๊กเอง</span>';
          } else { const e = elsewhere[id], gap = t - selC;
            st.innerHTML = '<span class="flag-r">ขาด ' + cb(gap) + (e && Math.round(e.amount * 100) === gap ? ' · <b>ตรงกับเรื่องที่ระบบบันทึกว่าเบิกแล้ว</b> (ดูหมายเหตุด้านบน)' : e ? ' · มีเรื่องที่ระบบบันทึกว่าเบิกแล้ว ' + baht2(e.amount) + ' บาท' : ' · ระบบอาจยังไม่มีหมาย/ราคาไม่ตรง') + '</span>'; }
        }
      });
      if ($('#pSugAll')) $('#pSugAll').disabled = !anySug;
      box.querySelectorAll('[data-sg]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); applySug([b.dataset.sg]); }));
      $('#pOk').disabled = !!d.requires_form25 || negOff.length > 0 || !inc.some((it) => it.amount_c > 0) || !(Number.isInteger(Number($('#pSeats').value)) && Number($('#pSeats').value) >= 1 && Number($('#pSeats').value) <= 1000) || !d.order_ok;
      $('#pOk').textContent = d.requires_form25 ? 'ต้องตรวจจ่ายจริงจากแบบ 25' : 'ยืนยันรอบ · ' + cb(sp.total_c) + ' ฿';
    };
    const setOff = (it, out, noclaim) => {
      [it].concat(it.amount_c > 0 ? sameUnitZero(it) : []).forEach((x) => {
        if (out) off.add(x.key); else off.delete(x.key);
        if (out && noclaim) nc.add(x.key); else nc.delete(x.key);
        const el = box.querySelector('.pit[data-k="' + x.key + '"]'); if (!el) return;
        el.classList.toggle('out', out); el.classList.toggle('nc', !!(out && noclaim)); const c = el.querySelector('input'); if (c) c.checked = !out;
      });
    };
    box.querySelectorAll('[data-nc]').forEach((b) => b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const it = d.items.find((x) => x.key === b.dataset.nc); setOff(it, !nc.has(it.key) || !off.has(it.key) ? true : false, !nc.has(it.key)); recalc();
    }));
    // ร่างที่บันทึกไว้ (0.7.25): ใช้ตัวเลือกเดิมกับรายการที่ยังอยู่
    if (free && d.draft && d.draft.data) {
      const dd = d.draft.data, has = (k) => d.items.some((x) => x.key === k);
      (dd.defer || []).filter(has).forEach((k) => setOff(d.items.find((x) => x.key === k), true, false));
      (dd.noclaim || []).filter(has).forEach((k) => setOff(d.items.find((x) => x.key === k), true, !!d.can_noclaim));
      Object.keys(dd.targets || {}).forEach((id) => { targets[id] = Math.round(Number(dd.targets[id]) * 100); const inp = box.querySelector('[data-tg="' + id + '"]'); if (inp) inp.value = dd.targets[id]; });
      if (dd.seats) $('#pSeats').value = dd.seats; if (dd.note) $('#pNote').value = dd.note;
    }
    const draftBody = () => ({ round_type: d.round_type, pay_date: d.pay_date, cutoff: d.cutoff, claim_from: d.claim_from || '',
      defer: Array.from(off).filter((k) => !nc.has(k)), noclaim: Array.from(nc),
      targets: Object.fromEntries(Object.keys(targets).map((k) => [k, targets[k] / 100])), seats: $('#pSeats').value, note: $('#pNote').value });
    if ($('#pSaveDraft')) $('#pSaveDraft').addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { await api('payout_draft', draftBody()); toast('บันทึกร่างแล้ว — ยังไม่ล็อกหมาย ยอดยังเป็นประมาณการ'); } catch (x) { toast(x.message); }
      b.disabled = false;
    });
    if ($('#pClearDraft')) $('#pClearDraft').addEventListener('click', async (e) => {
      e.preventDefault(); if (!(await askBox('ล้างร่างการเตรียมเบิกนี้? (ไม่กระทบยอดเงิน)'))) return;
      try { await api('payout_draft', { round_type: d.round_type, clear: true }); toast('ล้างร่างแล้ว'); $('#pDraftInfo').remove(); } catch (x) { toast(x.message); }
    });
    const applySug = (ids) => { ids.forEach((id) => (sug[id] || []).forEach((k) => setOff(d.items.find((x) => x.key === k), true))); recalc(); };
    box.querySelectorAll('.pit input[data-k]').forEach((c) => c.addEventListener('change', () => { setOff(d.items.find((x) => x.key === c.dataset.k), !c.checked); recalc(); }));
    box.querySelectorAll('[data-all]').forEach((c) => c.addEventListener('change', () => { byOff[c.dataset.all].forEach((it) => setOff(it, !c.checked)); recalc(); }));
    box.querySelectorAll('[data-tg]').forEach((inp) => inp.addEventListener('input', () => {
      const v = String(inp.value).replace(/,/g, '').trim();
      if (v === '' || !isFinite(Number(v))) delete targets[inp.dataset.tg]; else targets[inp.dataset.tg] = Math.round(Number(v) * 100);
      recalc();
    }));
    if ($('#pSugAll')) $('#pSugAll').addEventListener('click', () => applySug(Object.keys(sug)));
    ['#pSeats', '#pCarry'].forEach((s) => $(s).addEventListener('input', recalc));
    if ($('#pDraft')) $('#pDraft').addEventListener('click', () => printClaim(d.items.filter((it) => !off.has(it.key) && !it.adj), names, d, true));
    if ($('#pOutside')) $('#pOutside').addEventListener('click', async () => {
      const tot = d.items.reduce((a, x) => a + x.amount_c, 0);
      const reason = await askBox('บันทึกว่าบัญชีจ่ายวันที่ ' + thDate(d.pay_date) + ' (' + num(d.items.length) + ' เรื่อง · ' + cb(tot) + ' บาท) แบ่ง 60:40 นอกระบบแล้ว — ระบุเหตุผล', { input: 'ระบุเหตุผล', value: 'งานเดือน ก.ย. ก่อนเริ่มระบบ แบ่ง 60:40 นอกระบบแล้ว' });
      if (!reason) return;
      const b = $('#pOutside'); b.disabled = true;
      try { const r = await api('ledger_outside', { pay_date: d.pay_date, reason: reason }); toast('บันทึกแล้ว · ' + thDate(r.pay_date) + ' ' + num(r.rows) + ' เรื่อง ' + baht2(r.amount) + ' บาท แบ่งนอกระบบ'); S.payoutSub = 'list'; go('payout'); }
      catch (x) { toast(x.message); b.disabled = false; }
    });
    if ($('#pTo25')) $('#pTo25').addEventListener('click', () => go('claim25'));
    $('#pOk').addEventListener('click', async () => {
      if (d.requires_form25) { toast('กรุณาตรวจยอดจ่ายจริงจากแบบ 25 ก่อนยืนยันรอบ'); return; }
      const inc = d.items.length - off.size, carryC = Math.round(Number($('#pCarry').value || 0) * 100);
      if (carryC !== carry0 && !$('#pCarryNote').value.trim()) { toast('กรุณาใส่เหตุผลที่แก้เศษยกมา'); $('#pCarryNote').focus(); return; }
      const bad = Object.keys(targets).filter((id) => { const s = byOff[id].filter((it) => !off.has(it.key)).reduce((a, x) => a + x.amount_c, 0); return s !== targets[id]; });
      let ncReason = '';
      if (nc.size) { ncReason = await askBox('เหตุผลที่ "ไม่เบิก" ' + nc.size + ' เรื่อง (บันทึกไว้ตรวจย้อนหลัง)', { input: 'ระบุเหตุผล' }); if (!ncReason) return; }
      if (!(await askBox('ยืนยันรอบ' + RTYPE_TH[d.round_type] + ' วันที่ ' + thDate(d.pay_date) + '\n' + (free ? 'เบิก ' + inc + ' เรื่อง · ยกไปรอบหน้า ' + (off.size - nc.size) + ' เรื่อง' + (nc.size ? ' · ไม่เบิก ' + nc.size + ' เรื่อง' : '') : 'ตามบัญชีจ่ายเงิน ' + inc + ' เรื่อง') +
        '\nคนนั่งงาน ' + $('#pSeats').value + ' คน · เศษยกมา ' + baht2(carryC / 100) + (bad.length ? '\n⚠ ยอดไม่ตรงใบแบ่งยอด ' + bad.length + ' คน' : '')))) return;
      const b = $('#pOk'); b.disabled = true; b.innerHTML = '<span class="spin"></span> กำลังบันทึก…';
      try {
        const r = await api('payout_confirm', { round_type: d.round_type, pay_date: d.pay_date, cutoff: d.cutoff, seats: Number($('#pSeats').value),
          excluded: Array.from(off), expect_count: d.items.length, expect_snapshot: d.snapshot, note: $('#pNote').value,
          carry_in: Number($('#pCarry').value || 0), carry_note: $('#pCarryNote').value });
        if (nc.size) {
          const uids = [...new Set(d.items.filter((it) => nc.has(it.key)).flatMap((it) => it.notice_uids || []))];
          try { await api('payout_noclaim', { notice_uids: uids, reason: ncReason }); } catch (x) { toast('ยืนยันรอบแล้ว แต่บันทึก "ไม่เบิก" ไม่สำเร็จ: ' + x.message + ' — เรื่องเหล่านี้ยกไปรอบหน้าแทน'); }
        }
        if (free) { try { await api('payout_draft', { round_type: d.round_type, clear: true }); } catch (x) { /* ร่างค้างไม่กระทบยอด */ } }
        toast('ยืนยันรอบแล้ว'); S.payoutSub = 'round:' + r.round.round_id; go('payout');
      } catch (x) { toast(x.message); if(x.code === 'STALE') { const fresh = await api('payout_candidates',{round_type:d.round_type,pay_date:d.pay_date,cutoff:d.cutoff}); drawPicker(box,fresh); toast('ดึงยอดล่าสุดแล้ว กรุณาตรวจขาด/เกินและยืนยันอีกครั้ง'); } else { b.disabled = false; recalc(); } }
    });
    recalc();
  }

  /** รายการค้างเบิกรายเรื่อง + ปิด "ไม่เบิก" (ผู้ดูแลระบบ) */
  async function payoutBacklog(m) {
    const d = await api('payout_backlog');
    const names = d.officers;
    const sel = new Set();
    m.innerHTML = top('รายการค้างเบิกรายเรื่อง', '<button type="button" class="btn btn-sm" id="pBack">← รอบเบิก</button>') +
      '<div class="clay panel"><div class="row" style="justify-content:space-between;align-items:baseline"><h3 style="margin:0">ยังไม่ได้เบิก (' + num(d.items.length) + ')</h3>' +
      (d.can_close ? '<button type="button" class="btn btn-sm" id="pClose" disabled>ปิดเป็น "ไม่เบิก" (0)</button>' : '') + '</div>' +
      '<div class="tbl-wrap" style="margin-top:8px"><table><thead><tr>' + (d.can_close ? '<th></th>' : '') + '<th class="onm">ผู้ส่งหมาย</th><th>ประเภท</th><th>เลขคดี</th><th>ลงข้อมูล</th><th class="n">ค้าง</th><th class="n">บาท</th><th></th></tr></thead><tbody>' +
      (d.items.length ? d.items.map((x) => '<tr>' + (d.can_close ? '<td><input type="checkbox" data-u="' + esc(x.notice_uid) + '"></td>' : '') + '<td class="onm">' + oDot(names, x.officer_id) + esc(oName(names, x.officer_id)) + '</td><td>' + typeChip(x.type) + '</td><td>' + esc(x.case_no) + ' <span class="tiny muted">' + esc(x.notice_kind || '') + '</span></td><td>' + esc(thDate(x.report_date)) +
        '</td><td class="n">' + num(x.age_days) + ' วัน</td><td class="n">' + baht2(x.amount) + '</td><td>' + (x.held ? '<span class="pchip ph">เคยเลื่อน ' + esc(thDate(x.held.pay_date)) + '</span>' : (x.type === 'PAID' ? '<span class="tiny muted">ไม่อยู่ในบัญชีจ่าย</span>' : '')) + '</td></tr>').join('')
        : '<tr><td colspan="8" class="muted small">ไม่มีรายการค้างเบิก</td></tr>') + '</tbody></table></div></div>' +
      '<div class="clay panel"><h3>ปิด "ไม่เบิก" แล้ว (' + num(d.closed.length) + ')</h3>' + (d.closed.length ? '<div class="tbl-wrap"><table><thead><tr><th class="onm">ผู้ส่งหมาย</th><th>ประเภท</th><th>เลขคดี</th><th class="n">บาท</th><th>เหตุผล</th><th>โดย</th><th></th></tr></thead><tbody>' +
        d.closed.map((x) => '<tr><td class="onm">' + esc(oName(names, x.officer_id)) + '</td><td>' + typeChip(x.type) + '</td><td>' + esc(x.case_no) + '</td><td class="n">' + baht2(x.amount) + '</td><td class="small">' + esc(x.reason) + '</td><td class="tiny">' + esc(x.by) + '<br>' + esc(thDate(x.at, true)) + '</td><td>' +
          (d.can_close ? '<button type="button" class="btn btn-sm" data-re="' + esc(x.notice_uid) + '">เปิดคืน</button>' : '') + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="small muted" style="margin:0">ยังไม่มี</p>') + '</div>';
    $('#pBack').addEventListener('click', () => { S.payoutSub = 'list'; go('payout'); });
    m.querySelectorAll('[data-u]').forEach((c) => c.addEventListener('change', () => {
      if (c.checked) sel.add(c.dataset.u); else sel.delete(c.dataset.u);
      const b = $('#pClose'); b.disabled = !sel.size; b.textContent = 'ปิดเป็น "ไม่เบิก" (' + sel.size + ')';
    }));
    if ($('#pClose')) $('#pClose').addEventListener('click', async () => {
      const reason = await askBox('เหตุผลที่ไม่เบิก ' + sel.size + ' เรื่อง (บันทึกไว้ตรวจย้อนหลัง)', { input: 'ระบุเหตุผล' }); if (!reason) return;
      try { await api('payout_noclaim', { notice_uids: Array.from(sel), reason: reason }); toast('ปิดเป็น "ไม่เบิก" แล้ว'); S.payoutSub = 'backlog'; go('payout'); } catch (x) { toast(x.message); }
    });
    m.querySelectorAll('[data-re]').forEach((b) => b.addEventListener('click', async () => {
      try { await api('payout_noclaim', { notice_uids: [b.dataset.re], undo: true }); toast('เปิดคืนแล้ว'); S.payoutSub = 'backlog'; go('payout'); } catch (x) { toast(x.message); }
    }));
  }

  async function payoutRound(m, rid) {
    const d = await api('payout_get', { round_id: rid });
    const r = d.round, names = d.officers, free = r.round_type === 'FREE';
    const sp = { lines: d.lines.map((l) => ({ officer_id: l.officer_id, paid_c: Math.round(l.paid * 100), budget_c: Math.round(l.budget * 100), total_c: Math.round(l.total * 100), c60: Math.round(l.c60 * 100), c40: Math.round(l.c40 * 100), n_paid: l.n_paid, n_budget: l.n_budget })),
      paid_c: Math.round(r.total_paid * 100), budget_c: Math.round(r.total_budget * 100), total_c: Math.round(r.total * 100), c60: Math.round(r.courier60 * 100), pool40_c: Math.round(r.pool40 * 100), carry_in_c: Math.round(r.carry_in * 100), pool_c: Math.round(r.pool_total * 100),
      per_seat_c: Math.round(r.per_seat * 100), extra_one_c: Math.round(r.extra_one * 100), carry_out_c: Math.round(r.carry_out * 100), seats: r.seats };
    const inc = d.items.filter((x) => x.included), exc = d.items.filter((x) => !x.included);
    const itemRows = (L) => L.map((it) => '<tr><td class="onm">' + esc(oName(names, it.officer_id)) + '</td><td>' + esc(it.case_list) + (it.n > 1 ? ' <span class="tiny muted">(' + num(it.n) + ' ฉบับ)</span>' : '') +
      (it.reason && it.reason !== 'ยังไม่เสนอเบิกจ่าย' ? '<br><span class="tiny ' + (/ไม่พบ|▼/.test(it.reason) ? 'flag-r' : 'flag-up') + '">' + esc(String(it.reason).replace(/^ยังไม่เสนอเบิกจ่าย · /, '')) + '</span>' : '') +
      '</td><td>' + esc(thDate(it.delivered_date)) + '</td><td class="n">' + baht2(it.amount) + '</td></tr>').join('');
    m.innerHTML = top('รอบ' + (RTYPE_TH[r.round_type] || '') + ' วันที่ ' + thDate(r.pay_date), '<div class="row" style="gap:8px"><button type="button" class="btn btn-sm" id="pBack">← รายการรอบ</button><button type="button" class="btn btn-g btn-sm" id="pPrint">พิมพ์ใบแบ่งยอด 60:40</button>' +
      (free && inc.length && !r.from_claim ? '<button type="button" class="btn btn-sm" id="pClaim">พิมพ์บัญชีหมายฟรีที่เบิก</button>' : '') +
      (d.can_cancel ? '<button type="button" class="btn btn-sm" id="pCancel">ยกเลิกรอบ</button>' : '') +
      (d.can_cancel_paid ? '<button type="button" class="btn btn-sm btn-danger" id="pCancelPaid" title="ใช้เมื่อบันทึกว่าจ่ายแล้วแต่ความจริงยังไม่ได้จ่าย">ยกเลิกรอบ (บันทึกจ่ายผิด)</button>' : '') + '</div>') +
      (r.payment_status === 'PAID' ? '<div class="note g">บันทึกหลักฐานจ่ายส่วนแบ่งแล้ว '+esc(thDate(r.payment_date))+' · หลักฐาน '+esc(r.payment_ref)+'</div>' :
        (r.from_form25 ? '<div class="note g">แบบ 25 คือยอดจ่ายจริงจากระบบงานหมาย (ตรวจตรงรายหมายแล้ว) · รอบแบ่ง 60:40 นี้ยังไม่ได้บันทึกหลักฐานส่วนแบ่งในระบบ</div>' :
          '<div class="note">อยู่ในรอบยืนยันแล้ว · รอบเก่าคงยอดเดิม · ยังไม่บันทึกหลักฐานจ่ายจริงในระบบ (ถ้าจ่ายแล้วให้กด “บันทึกหลักฐานจ่ายจริง”)</div>')) +
      (r.from_claim ? '<div class="note">รอบนี้ตั้งตามใบเบิก · ตรวจรายการที่ผูกทะเบียนในรายละเอียดด้านล่าง หากยังไม่มีรายการรายหมาย ต้องกระทบยอดประวัติก่อนเบิกซ้ำ</div>' : '') +
      (r.status === 'CANCELLED' ? '<div class="note r">รอบนี้ถูกยกเลิกโดย ' + esc(r.cancelled_by) + ' เมื่อ ' + esc(thDate(r.cancelled_at, true)) + ' · เหตุผล: ' + esc(r.cancel_reason) + '</div>' : '') +
      '<div class="bn4"><div class="kpi clay kt k-all"><span>ยอดรวม' + esc(free ? 'หมายฟรี' : 'หมายเงิน') + '</span><b>' + baht2(r.total) + '&nbsp;฿</b><small>' + num(d.lines.length) + ' คน · ' + num(inc.length) + ' เรื่อง</small></div>' +
      '<div class="kpi clay kt k-paid"><span>เจ้าหน้าที่ส่งหมาย 60%</span><b>' + baht2(r.courier60) + '&nbsp;฿</b><small>ยอดโอนคืน 40% ' + baht2(r.pool40) + '</small></div>' +
      '<div class="kpi clay kt k-free"><span>กองกลาง + เศษยกมา</span><b>' + baht2(r.pool_total) + '&nbsp;฿</b><small>เศษยกมา ' + baht2(r.carry_in) + '</small></div>' +
      '<div class="kpi clay kt k-done"><span>คนนั่งงาน ' + num(r.seats) + ' คน ได้คนละ</span><b>' + baht2(r.per_seat) + '&nbsp;฿</b><small>เศษยกไป ' + baht2(r.carry_out) + '</small></div></div>' +
      '<div class="clay panel"><h3>ใบแบ่งยอด 60:40 รายผู้ส่ง</h3>' + splitTable(sp, names, { policyTh: r.policy_th, type: r.round_type }) +
      '<p class="tiny muted" style="margin:6px 2px 0">' + (free && r.cutoff_date ? 'หมายที่ลงข้อมูลถึง ' + esc(thDate(r.cutoff_date)) + ' · ' : '') + 'ที่มา: ' + esc(r.source_label || '—') + ' · บันทึกโดย ' + esc(r.created_by) + ' เมื่อ ' + esc(thDate(r.created_at, true)) +
        (r.carry_note ? ' · ' + esc(r.carry_note) : '') + (r.note ? ' · หมายเหตุ: ' + esc(r.note) : '') + '</p></div>' +
      (d.items.length ? '<div class="clay panel"><h3>รายการที่เบิกในรอบนี้ (' + num(inc.length) + ')</h3><div class="tbl-wrap"><table><thead><tr><th class="onm">ผู้ส่งหมาย</th><th>เลขคดี</th><th>วันที่</th><th class="n">บาท</th></tr></thead><tbody>' + itemRows(inc) + '</tbody></table></div></div>' +
        (exc.length ? '<div class="clay panel"><h3>ยังไม่เสนอเบิกจ่าย (' + num(exc.length) + ') — ยกไปรอบหน้า</h3><div class="tbl-wrap"><table><thead><tr><th class="onm">ผู้ส่งหมาย</th><th>เลขคดี</th><th>วันที่</th><th class="n">บาท</th></tr></thead><tbody>' + itemRows(exc) + '</tbody></table></div></div>' : '') : '');
    $('#pBack').addEventListener('click', () => { S.payoutSub = 'list'; go('payout'); });
    if (d.can_payment) { const pay = document.createElement('button'); pay.className='btn btn-sm'; pay.type='button'; pay.textContent='บันทึกหลักฐานจ่ายจริง'; $('.top .row',m).appendChild(pay); pay.onclick=()=>paymentForm(m,r); }
    $('#pPrint').addEventListener('click', () => printPayout(d));
    { const img = document.createElement('button'); img.className = 'btn btn-sm'; img.type = 'button'; img.id = 'pImage'; img.textContent = 'บันทึกเป็นรูป';
      $('#pPrint').after(img); img.onclick = async () => { img.disabled = true; try { await saveRoundImage(d); } catch (e) { toast(e.message || 'สร้างรูปไม่สำเร็จ'); } img.disabled = false; }; }
    if ($('#pClaim')) $('#pClaim').addEventListener('click', () => printClaim(inc.filter((it) => !/^A:/.test(String(it.key))).map((it) => ({ officer_id: it.officer_id, case_list: it.case_list, notice_kind:it.notice_kind, tambon:it.tambon, report_date: it.reported_date || '', amount_c: Math.round(it.amount * 100) })), names, { pay_date: r.pay_date, cutoff: r.cutoff_date, source: r.source_label, round_id: r.round_id }, false));
    if ($('#pCancelPaid')) $('#pCancelPaid').addEventListener('click', async () => {
      const n = inc.filter((it) => !/^A:/.test(String(it.key))).length;
      const reason = await askBox('ยกเลิกรอบที่บันทึกว่า "จ่ายจริงแล้ว" — ใช้เมื่อความจริงยังไม่ได้จ่ายเงิน\nระบุเหตุผล (อย่างน้อย 10 ตัวอักษร)', { input: 'เช่น ศาลยังไม่ได้จ่ายรอบนี้ บันทึกยอดตั้งต้นผิด' });
      if (!reason) return;
      if (reason.trim().length < 10) { toast('ระบุเหตุผลให้ชัดเจน (อย่างน้อย 10 ตัวอักษร)'); return; }
      const ok = await askBox('ยืนยันยกเลิกรอบ ' + (free ? 'หมายฟรี' : 'หมายเงิน') + ' ' + thDate(r.pay_date) + '\n• ' + num(n) + ' รายการ ยอด ' + baht2(r.total) + ' บาท จะกลับเป็น "ยอดประมาณการก่อนการเบิก"\n• สถานะ "จ่ายจริง" ของรอบนี้ถูกยกเลิก (เก็บประวัติไว้)\n• รอบอื่นไม่เปลี่ยน');
      if (!ok) return;
      try { const x = await api('payout_cancel', { round_id: rid, reason: reason.trim(), force_paid: true }); toast('ยกเลิกรอบแล้ว · ' + num(x.released) + ' รายการกลับเป็นยอดประมาณการก่อนการเบิก'); S.payoutSub = 'round:' + rid; go('payout'); } catch (x) { toast(x.message); }
    });
    if ($('#pCancel')) $('#pCancel').addEventListener('click', async () => {
      const reason = await askBox('เหตุผลที่ยกเลิกรอบนี้ (หมายในรอบจะกลับเป็นยอดประมาณการก่อนการเบิก)', { input: 'ระบุเหตุผล' }); if (!reason) return;
      try { await api('payout_cancel', { round_id: rid, reason: reason }); toast('ยกเลิกรอบแล้ว'); S.payoutSub = 'round:' + rid; go('payout'); } catch (x) { toast(x.message); }
    });
  }

  /**
   * 0.7.13 ใบแบ่งยอด 60:40 เป็นรูป PNG (แชร์/บันทึกจากมือถือได้) — ครบรายผู้ส่ง ยอด 60% ยอดโอนคืน 40% กองกลาง เศษยกมา ได้คนละ เศษยกไป
   * วาดด้วย canvas จากข้อมูลรอบ (ไม่ถ่ายหน้าจอ) จึงได้ทุกแถวแม้หน้าจอเลื่อน
   */
  async function saveRoundImage(d) {
    loadSarabun();
    try { await Promise.race([Promise.all([document.fonts.load('400 28px Sarabun'), document.fonts.load('700 28px Sarabun')]), new Promise((res) => setTimeout(res, 2000))]); } catch (e) { /* ใช้ฟอนต์สำรอง */ }
    const r = d.round, names = d.officers, free = r.round_type === 'FREE';
    const amtOf = (l) => free ? l.budget : (r.round_type === 'PAID' ? l.paid : l.total);
    const cntOf = (l) => free ? l.n_budget : (r.round_type === 'PAID' ? l.n_paid : (l.n_paid || 0) + (l.n_budget || 0));
    const W = 1080, P = 48, RH = 56, F = '"Sarabun","TH Sarabun New","Noto Sans Thai",sans-serif';
    const pool = [['ยอดโอนคืน 40%', baht2(r.pool40)], ['เศษยกมาจากรอบก่อน', baht2(r.carry_in)], ['รวมกองกลาง', baht2(r.pool_total)],
      ['คนนั่งงาน ' + num(r.seats) + ' คน ได้คนละ', baht2(r.per_seat) + ' ฿', 1], ['จ่ายรวม (' + num(r.seats) + ' × ' + baht2(r.per_seat) + ')', baht2(r.paid_out)]]
      .concat(r.extra_one ? [['เศษให้ 1 คน', baht2(r.extra_one)]] : []).concat([['เศษยกไปรอบหน้า', baht2(r.carry_out)]]);
    const H = 250 + RH * (d.lines.length + 2) + 40 + pool.length * 50 + 40 + 185;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const txt = (t, x, y, o) => { o = o || {}; g.font = (o.b ? '700 ' : '400 ') + (o.s || 26) + 'px ' + F; g.fillStyle = o.c || '#1d2b24'; g.textAlign = o.a || 'left'; g.fillText(String(t), x, y); };
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#e7f2ea'; g.fillRect(0, 0, W, 190);
    const seal = await new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = C.SEAL_URL || 'court-seal.webp'; setTimeout(() => res(null), 1500); });
    if (seal) { try { const scale = Math.min(110 / seal.naturalWidth, 110 / seal.naturalHeight); const w = seal.naturalWidth * scale, h = seal.naturalHeight * scale; g.drawImage(seal, P + (110 - w) / 2, 36 + (110 - h) / 2, w, h); } catch (e) { /* ข้ามตรา */ } }
    const tx = seal ? P + 130 : P;
    txt('ศาลจังหวัดลพบุรี', tx, 70, { s: 28, b: 1, c: '#2f6b4a' });
    txt('ใบแบ่งยอดค่าหมาย 60 : 40 · ' + (RTYPE_TH[r.round_type] || ''), tx, 112, { s: 34, b: 1 });
    txt('วันที่จ่าย ' + dLong(r.pay_date) + ' · รอบ ' + r.round_id + (free && r.cutoff_date ? ' · ลงข้อมูลถึง ' + thDate(r.cutoff_date) : ''), tx, 152, { s: 22, c: '#4b5d53' });
    if (r.status === 'CANCELLED') txt('ยกเลิกแล้ว', W - P, 70, { s: 30, b: 1, c: '#b3261e', a: 'right' });
    const cols = [{ t: 'ที่', x: P + 10, a: 'left' }, { t: 'ผู้ส่งหมาย', x: P + 70, a: 'left' }, { t: 'เรื่อง', x: 540, a: 'right' },
      { t: 'ยอดเงิน', x: 720, a: 'right' }, { t: 'เจ้าหน้าที่ส่งหมาย', x: 868, a: 'right', sub: '60%' }, { t: 'ยอดโอนคืน', x: W - P - 10, a: 'right', sub: '40%' }];
    let y = 230;
    g.fillStyle = '#f1f5f2'; g.fillRect(P, y - 36, W - 2 * P, RH);
    cols.forEach((c) => { txt(c.t, c.x, y-(c.sub?9:0), { s: c.sub?18:22, b: 1, a: c.a, c: '#4b5d53' }); if(c.sub)txt(c.sub,c.x,y+12,{s:18,b:1,a:c.a,c:'#4b5d53'}); });
    d.lines.forEach((l, i) => {
      y += RH; if (i % 2) { g.fillStyle = '#fafcfb'; g.fillRect(P, y - 36, W - 2 * P, RH); }
      txt(i + 1, cols[0].x, y, { s: 24 }); txt(oFull(names, l.officer_id), cols[1].x, y, { s: 24 });
      txt(num(cntOf(l) || 0), cols[2].x, y, { s: 24, a: 'right' }); txt(baht2(amtOf(l)), cols[3].x, y, { s: 24, a: 'right' });
      txt(baht2(l.c60), cols[4].x, y, { s: 24, a: 'right' }); txt(baht2(l.c40), cols[5].x, y, { s: 24, b: 1, a: 'right' });
    });
    y += RH; g.fillStyle = '#d6e6dc'; g.fillRect(P, y - 40, W - 2 * P, 2);
    txt('รวม', cols[1].x, y, { s: 26, b: 1 }); txt(num(d.lines.reduce((a, l) => a + (cntOf(l) || 0), 0)), cols[2].x, y, { s: 26, b: 1, a: 'right' });
    txt(baht2(r.total), cols[3].x, y, { s: 26, b: 1, a: 'right' }); txt(baht2(r.courier60), cols[4].x, y, { s: 26, b: 1, a: 'right' }); txt(baht2(r.pool40), cols[5].x, y, { s: 26, b: 1, a: 'right' });
    y += 50; g.fillStyle = '#eef4f0'; g.fillRect(P, y, W - 2 * P, pool.length * 50 + 24);
    y += 12;
    pool.forEach((p) => { y += 50; txt(p[0], P + 24, y - 14, { s: p[2] ? 28 : 24, b: p[2] }); txt(p[1], W - P - 24, y - 14, { s: p[2] ? 34 : 24, b: 1, a: 'right', c: p[2] ? '#1f5a3c' : '#24507a' }); });
    y += 60;
    txt(r.payment_status === 'PAID' ? 'จ่ายเงินจริง ' + thDate(r.payment_date) + ' · หลักฐาน ' + (r.payment_ref || '') : 'สถานะ: ยืนยันรอบแล้ว · ยังไม่บันทึกหลักฐานจ่ายในระบบ', P, y, { s: 22, c: r.payment_status === 'PAID' ? '#2f7a4f' : '#8a5a00' });
    txt('วิธีปัดเศษ: ' + (r.policy_th || '—') + ' · ที่มา: ' + (r.source_label || '—'), P, y + 36, { s: 20, c: '#4b5d53' });
    txt('บัญชีคำนวณภายใน (ข้อตกลง 60:40) แยกจากเอกสารเบิกจ่ายทางราชการ · สร้างรูปเมื่อ ' + new Date().toLocaleString('th-TH'), P, y + 70, { s: 20, c: '#6b7b72' });
    txt(PRIVACY_TH, P, y + 104, { s: 20, b: 1, c: '#2f6b4a' });
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    if (!blob) throw new Error('สร้างรูปไม่สำเร็จ');
    const name = 'ใบแบ่งยอด-' + String(r.pay_date).slice(0, 10) + '-' + (free ? 'หมายฟรี' : 'หมายเงิน') + '.png';
    const file = typeof File === 'function' ? new File([blob], name, { type: 'image/png' }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast('บันทึกรูปใบแบ่งยอดแล้ว');
  }

  function loadSarabun() {
    if (document.getElementById('fSarabun')) return;
    const l = document.createElement('link'); l.id = 'fSarabun'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap'; document.head.appendChild(l);
  }
  async function printArea(html) {
    let pa = document.getElementById('printArea');
    if (!pa) { pa = document.createElement('div'); pa.id = 'printArea'; document.body.appendChild(pa); }
    pa.innerHTML = html + '<p class="pr-privacy">' + PRIVACY_TH + '</p>';
    try { await Promise.race([document.fonts.load('16pt Sarabun'), new Promise((res) => setTimeout(res, 1500))]); } catch (e) { /* ฟอนต์สำรอง */ }
    const img = pa.querySelector('img');
    if (img && !img.complete) await new Promise((res) => { img.onload = img.onerror = res; setTimeout(res, 1500); });
    window.print();
  }
  const dLong = (iso) => iso ? new Date(String(iso).slice(0, 10) + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

  /** ใบแบ่งยอดแบบศาล: เจ้าหน้าที่ส่งหมาย 60% · ยอดโอนคืน 40% · เศษยกมา/ยกไป · ได้คนละ */
  async function printPayout(d) {
    loadSarabun();
    const r = d.round, names = d.officers, free = r.round_type === 'FREE';
    const amtOf = (l) => free ? l.budget : (r.round_type === 'PAID' ? l.paid : l.total);
    const rows = d.lines.map((l, i) => '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(oFull(names, l.officer_id)) + '</td><td class="n">' + baht2(amtOf(l)) +
      '</td><td class="n">' + baht2(l.c60) + '</td><td class="n"><b>' + baht2(l.c40) + '</b></td><td class="c">☐</td></tr>').join('');
    await printArea('<div class="pr-head"><img src="court-seal.webp" alt=""><div class="pr-court">ศาลจังหวัดลพบุรี</div>' +
      '<div class="pr-title">ใบแบ่งยอดค่าหมาย ๖๐ : ๔๐ วันที่ ' + esc(dLong(r.pay_date)) + ' (' + esc(free ? 'หมายศาล' : 'หมายเงิน') + ')</div>' +
      '<div class="pr-sub">รอบ ' + esc(r.round_id) + (free ? ' · หมายที่ลงข้อมูลถึงวันที่ ' + esc(dLong(r.cutoff_date)) : '') + (r.status === 'CANCELLED' ? ' · <b>ยกเลิกแล้ว</b>' : '') + '</div></div>' +
      '<table class="pr-tbl"><thead><tr><th>ที่</th><th>ชื่อ – สกุล</th><th>ยอดเงิน (บาท)</th><th>เจ้าหน้าที่ส่งหมาย ๖๐%</th><th>ยอดโอนคืน ๔๐%</th><th>ตรวจสอบการโอนคืน</th></tr></thead><tbody>' + rows +
      '<tr class="pr-sum"><td></td><td><b>รวม</b></td><td class="n"><b>' + baht2(r.total) + '</b></td><td class="n"><b>' + baht2(r.courier60) + '</b></td><td class="n"><b>' + baht2(r.pool40) + '</b></td><td></td></tr></tbody></table>' +
      '<table class="pr-tbl" style="width:60%;margin-top:10px"><tbody><tr><td>ยอดโอนคืน ๔๐%</td><td class="n">' + baht2(r.pool40) + '</td></tr><tr><td>ยอดยกมา</td><td class="n">' + baht2(r.carry_in) + '</td></tr>' +
      '<tr><td>จ่ายสัปดาห์ (' + num(r.seats) + ' คน × ' + baht2(r.per_seat) + ')</td><td class="n"><b>' + baht2(r.paid_out) + '</b></td></tr>' + (r.extra_one ? '<tr><td>เศษให้ 1 คน</td><td class="n">' + baht2(r.extra_one) + '</td></tr>' : '') +
      '<tr><td>ยอดยกไป</td><td class="n">' + baht2(r.carry_out) + '</td></tr><tr><td><b>รวมยอดเงิน</b></td><td class="n"><b>' + baht2(r.pool_total) + '</b></td></tr></tbody></table>' +
      '<div class="pr-note"><b>หมายเหตุ</b> ๑. วิธีปัดเศษ: ' + esc(r.policy_th) + ' ๒. ที่มาของยอด: ' + esc(r.source_label || '—') + ' ' +
      (free ? '๓. รายการที่ยังไม่เสนอเบิกจ่าย ' + num(r.n_excluded) + ' รายการ ยกไปรอบหน้า ' : '') + (r.carry_note ? '(' + esc(r.carry_note) + ') ' : '') +
      (free ? '๔.' : '๓.') + ' บัญชีแบ่งยอด ๖๐ : ๔๐ เป็นบัญชีคำนวณภายใน แยกจากเอกสารเบิกจ่ายทางราชการ</div>' +
      '<div class="pr-sign"><div>ลงชื่อ ......................................................... ผู้จัดทำ<br>(' + esc(S.user ? S.user.name : '') + ')<br>ตำแหน่ง .........................................................</div>' +
      '<div>ลงชื่อ ......................................................... ผู้ตรวจสอบ<br>(.........................................................)<br>ตำแหน่ง .........................................................</div></div>');
  }

  /** บัญชีหมายฟรีที่ขอเบิก (รายคน รายเรื่อง) — ร่างก่อนยืนยัน หรือของรอบที่ยืนยันแล้ว */
  async function printClaim(items, names, d, draft) {
    loadSarabun();
    const by = {}; items.filter((it) => it.amount_c > 0 || !draft).forEach((it) => { (by[it.officer_id] = by[it.officer_id] || []).push(it); });
    let i = 0, grand = 0;
    const body = Object.keys(by).sort().map((id) => {
      const L = by[id], s = L.reduce((a, x) => a + x.amount_c, 0); grand += s;
      return '<tr class="pr-grp"><td colspan="5"><b>' + esc(oFull(names, id)) + '</b> · ' + num(L.length) + ' เรื่อง</td></tr>' +
        L.map((it) => '<tr><td class="c">' + (++i) + '</td><td>' + esc(it.case_list) + '</td><td>' + esc(it.notice_kind || '') + (it.tambon ? ' · ต.' + esc(it.tambon) : '') + '</td><td>' + esc(thDate(it.report_date)) + '</td><td class="n">' + cb(it.amount_c) + '</td></tr>').join('') +
        '<tr class="pr-sum"><td></td><td colspan="3">รวม ' + esc(oFull(names, id)) + '</td><td class="n"><b>' + cb(s) + '</b></td></tr>';
    }).join('');
    await printArea('<div class="pr-head"><img src="court-seal.webp" alt=""><div class="pr-court">ศาลจังหวัดลพบุรี</div>' +
      '<div class="pr-title">บัญชีหมายฟรีที่ขอเบิก วันที่ ' + esc(dLong(d.pay_date)) + (draft ? ' (ร่าง)' : '') + '</div>' +
      '<div class="pr-sub">หมายที่ลงข้อมูลถึงวันที่ ' + esc(dLong(d.cutoff)) + (d.round_id ? ' · รอบ ' + esc(d.round_id) : '') + ' · ราคาตาม ' + esc(d.source || '') + '</div></div>' +
      '<table class="pr-tbl"><thead><tr><th>ที่</th><th>เลขคดี</th><th>หมาย / ตำบล</th><th>ลงข้อมูล</th><th>บาท</th></tr></thead><tbody>' + body +
      '<tr class="pr-sum"><td></td><td colspan="3"><b>รวมทั้งสิ้น ' + num(i) + ' เรื่อง</b></td><td class="n"><b>' + cb(grand) + '</b></td></tr></tbody></table>' +
      '<div class="pr-sign"><div>ลงชื่อ ......................................................... ผู้จัดทำ<br>(' + esc(S.user ? S.user.name : '') + ')</div><div>ลงชื่อ ......................................................... ผู้ตรวจสอบ<br>(.........................................................)</div></div>');
  }

  RENDER.officers = async (m) => {
    const [o, r] = await Promise.all([api('officers_list'), api('rates_list')]);
    const admin = has('ADMIN');
    const groups = {};
    r.areas.forEach((a) => { (groups[a.amphoe_name] = groups[a.amphoe_name] || []).push(a); });
    const mapUrl = /^https:\/\//.test(String(C.AREA_MAP_URL || '')) ? String(C.AREA_MAP_URL) : '';
    m.innerHTML = top('ผู้ส่งหมายและอัตรา') +
      (mapUrl ? '<div class="clay panel area-map-link"><div><b>🗺 แผนที่เขตพื้นที่ส่งหมาย</b><div class="small muted">ระบบบริหารเขตพื้นที่งานส่งหมาย · ดูว่าผู้ส่งหมายแต่ละคนรับผิดชอบตำบลใด (หน้าแสดงผล อ่านอย่างเดียว)</div></div>' +
        '<a class="btn btn-g" href="' + esc(mapUrl) + '" target="_blank" rel="noopener noreferrer">เปิดแผนที่เขตหมาย ↗</a></div>' : '') +
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
        '<div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th>รหัส</th><th>ตำบล</th><th class="onm">ผู้ส่ง</th><th class="n">บาท/หมาย</th></tr></thead><tbody>' +
        groups[g].map((a) => '<tr><td>' + esc(a.area_id) + '</td><td>' + esc(a.tambon_name) + '</td><td class="onm">' + esc(a.officer) + '</td><td class="n">' + num(a.rate) + '</td></tr>').join('') + '</tbody></table></div></details>').join('') + '</div>';
    m.querySelectorAll('.sv').forEach((b) => b.addEventListener('click', async () => {
      const tr = b.closest('tr'); b.disabled = true;
      try {
        await api('officer_save', { officer_id: tr.dataset.id, last_name: $('.f-ln', tr).value, name_aliases: $('.f-al', tr).value, printhub_code: $('.f-ph', tr).value });
        toast('บันทึกแล้ว');
      } catch (e) { toast(e.message); } finally { b.disabled = false; }
    }));
  };

  /* ---------------------------------------------------------------- ผู้ใช้และสิทธิ์ */
  /* 0.7.17 ประวัติการใช้งาน (ผู้ดูแล) */
  RENDER.audit = async (m, f) => {
    f = f || S.auditF || {};
    m.innerHTML = top('ประวัติการใช้งาน') + '<div class="clay panel"><p class="muted">กำลังโหลด…</p></div>';
    let d; try { d = await api('audit_list', f); } catch (x) { m.innerHTML = top('ประวัติการใช้งาน') + '<div class="clay panel"><p class="note r">' + esc(x.message) + '</p></div>'; return; }
    S.auditF = { from: d.from, to: d.to, group: d.group, user: d.user, q: f.q || '' };
    const gName = {}; d.groups.forEach((g) => { gName[g.id] = g.th; });
    const ts = (s) => { const v = String(s || ''); return v ? thDate(v.slice(0, 10)) + ' ' + v.slice(11, 16) + ' น.' : '—'; };
    m.innerHTML = top('ประวัติการใช้งาน') +
      '<div class="clay panel"><p class="small muted" style="margin:0 0 10px">บันทึกการกระทำสำคัญในระบบ (เข้าระบบ นำเข้าไฟล์ รอบเบิก บันทึกจ่าย แก้สิทธิ์ ข้อผิดพลาด) · ไม่บันทึกการเปิดดูหน้า · บันทึกเข้า/ออกระบบเก็บ ' + num(d.keep_days) + ' วัน รายการอื่นเก็บถาวร' + (d.purged ? ' · ล้างบันทึกเข้าระบบเก่า ' + num(d.purged) + ' รายการ' : '') + '</p>' +
      '<form id="auF" class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end">' +
      '<label class="small">ตั้งแต่<br><input type="date" class="inp" name="from" value="' + esc(d.from) + '"></label>' +
      '<label class="small">ถึง<br><input type="date" class="inp" name="to" value="' + esc(d.to) + '"></label>' +
      '<label class="small">ผู้ใช้<br><select class="inp" name="user"><option value="">ทุกคน</option>' + d.users.map((u) => '<option value="' + esc(u.code) + '"' + (u.code === d.user ? ' selected' : '') + '>' + esc(u.name || u.code) + '</option>').join('') + '</select></label>' +
      '<label class="small">ประเภท<br><select class="inp" name="group"><option value="ALL">ทั้งหมด</option>' + d.groups.map((g) => '<option value="' + esc(g.id) + '"' + (g.id === d.group ? ' selected' : '') + '>' + esc(g.th) + '</option>').join('') + '</select></label>' +
      '<label class="small">ค้นคำ<br><input class="inp" name="q" maxlength="60" value="' + esc(S.auditF.q) + '" placeholder="เช่น เลขรอบ ชื่อไฟล์"></label>' +
      '<button class="btn btn-g" type="submit">แสดง</button></form>' +
      '<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:12px">' + d.groups.filter((g) => d.counts[g.id]).map((g) => '<button type="button" class="pchip' + (g.id === 'ERROR' ? ' pcx' : ' pok') + '" data-aug="' + esc(g.id) + '">' + esc(g.th) + ' ' + num(d.counts[g.id]) + '</button>').join('') + '</div></div>' +
      (d.per_user.length ? '<div class="clay panel"><h3>การเข้าระบบรายคน · ช่วงที่เลือก</h3><div class="tbl-wrap"><table><thead><tr><th>ผู้ใช้</th><th class="n">เข้าสำเร็จ</th><th class="n">ไม่สำเร็จ</th><th>เข้าล่าสุด</th></tr></thead><tbody>' +
        d.per_user.map((p) => '<tr><td>' + esc(p.name || p.user_code) + '</td><td class="n">' + num(p.ok) + '</td><td class="n' + (p.fail ? ' flag-r' : '') + '">' + num(p.fail) + '</td><td>' + esc(ts(p.last_ok)) + '</td></tr>').join('') + '</tbody></table></div></div>' : '') +
      '<div class="clay panel"><h3>รายการ ' + num(d.total) + (d.truncated ? ' <span class="small muted">(แสดงล่าสุด ' + num(d.rows.length) + ')</span>' : '') + '</h3>' +
      (d.rows.length ? '<div class="tbl-wrap"><table class="wide-tbl"><thead><tr><th>วันเวลา</th><th>ผู้ใช้</th><th>ประเภท</th><th>การกระทำ</th><th>เป้าหมาย</th><th>รายละเอียด</th></tr></thead><tbody>' +
        d.rows.map((r) => '<tr><td style="white-space:nowrap">' + esc(ts(r.at)) + '</td><td>' + esc(r.user_name || r.user_code || '—') + '</td><td class="small">' + esc(gName[r.group] || '') + '</td><td' + (r.group === 'ERROR' ? ' class="flag-r"' : '') + '>' + esc(r.action_th) + '</td><td class="small">' + esc(r.target) + '</td><td class="small">' + esc(r.detail) + '</td></tr>').join('') + '</tbody></table></div>'
        : '<p class="muted">ไม่มีรายการตามตัวกรอง</p>') + '</div>';
    const fm = $('#auF');
    fm.addEventListener('submit', (e) => { e.preventDefault(); const x = Object.fromEntries(new FormData(fm).entries()); S.auditF = x; RENDER.audit(m, x); });
    m.querySelectorAll('[data-aug]').forEach((b) => b.addEventListener('click', () => { const x = Object.assign({}, S.auditF, { group: b.dataset.aug }); RENDER.audit(m, x); }));
  };

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

  /* 0.7.0: workflow navigation and tracing, using the original clay cards and colors. */
  const differenceHtml = (v) => v === null ? '<span class="tiny muted">ยังไม่มียอดอ้างอิง</span>' : v > 0 ? '<span class="flag-up">เกิน '+baht2(v)+' ฿</span>' : v < 0 ? '<span class="flag-r">ขาด '+baht2(-v)+' ฿</span>' : '<span class="flag-ok">ยอดตรงกัน</span>';
  const statusHtml = (r) => '<span class="pill '+(r.status==='PAID'?'g':r.status==='REVIEW'?'r':r.status==='READY'?'est':'a')+'">'+esc(r.status_th)+'</span>';
  const latestHtml = (last) => '<div class="note small">'+[['ISSUE','50 ทะเบียนหมาย'],['RESULT','42 ผลส่ง'],['FREE18','18 ราคาหมายฟรี'],['PAY','30 บัญชีจ่ายเงิน']].map(([k,lab])=>{const x=last[k];return '<span class="nb">'+lab+': '+esc(x?thDate(x.at,true):'ยังไม่พบการนำเข้า')+'</span>';}).join(' · ')+'</div>';
  RENDER.tracking = async (m, options) => {
    options=options||{};
    const own=has('COURIER')&&!has('NOTICE','FINANCE','ADMIN','CASE');
    const preset=options.pay_type||'',fixed=!!options.pay_type;
    m.innerHTML=top(options.title||(own?'รายการค่าส่งคำคู่ความของฉัน':'ค้นรายการทั้ง 2 ประเภท'))+
      '<p class="page-description">'+esc(options.description||'ค้นรายหมาย เลือกผู้ส่ง พื้นที่ และสถานะ เพื่อดูยอดตามบัญชีเทียบกับยอดอ้างอิง')+'</p>'+
      '<form class="clay panel" id="trackForm"><div class="row">'+
      '<label>แหล่งเงิน<select class="sel" id="trType"'+(fixed?' disabled':'')+'><option value="">ทั้ง 2 ประเภท</option><option value="PAID">เงินนอกงบประมาณ</option><option value="BUDGET">เงินงบประมาณ (หมายฟรี)</option></select></label>'+
      '<label>เลขคดี / เลขหมาย<input class="inp" id="trQ" placeholder="พิมพ์เลขคดีหรือเลขหมาย"></label>'+
      '<label>ปีงบประมาณ<input class="inp year-input" id="trFy" inputmode="numeric" placeholder="ทั้งหมด" value="'+esc(S.fy)+'"></label>'+
      '<label>ผู้ส่ง<select class="sel" id="trOfficer"><option value="">'+(own?'ของฉัน':'ทุกคน')+'</option></select></label>'+
      '<label>พื้นที่ส่งหมาย<select class="sel" id="trArea"><option value="">ทุกพื้นที่</option></select></label>'+
      '<label>สถานะ<select class="sel" id="trStatus"><option value="">ทุกสถานะ</option></select></label>'+
      '<label>ตั้งแต่<input type="date" class="inp" id="trFrom"></label><label>ถึง<input type="date" class="inp" id="trTo"></label>'+
      '<button class="btn btn-g">ค้นหา</button></div></form><div id="trackResult"></div><div id="trackDetail"></div>';
    let page=1,unit='',busy=false,seq=0,seeded=false;
    const run=async()=>{
      const ticket=++seq;busy=true;const box=$('#trackResult');box.innerHTML='<div class="clay panel"><span class="spin"></span> กำลังตรวจข้อมูล…</div>';
      try {
        const d=await api('tracking',{q:$('#trQ').value,fy:$('#trFy').value,pay_type:fixed?preset:$('#trType').value,officer_id:$('#trOfficer').value,area_id:$('#trArea').value,status:$('#trStatus').value,from:$('#trFrom').value,to:$('#trTo').value,page:page,unit_id:unit});
        if(ticket!==seq)return;
        if(!seeded){seeded=true;Object.keys(d.officers).filter(id=>!d.scope_officer||id===d.scope_officer).forEach(id=>$('#trOfficer').insertAdjacentHTML('beforeend','<option value="'+esc(id)+'">'+esc(d.officers[id].name)+'</option>'));(d.areas||[]).forEach(a=>$('#trArea').insertAdjacentHTML('beforeend','<option value="'+esc(a.area_id)+'">ต.'+esc(a.tambon)+' · อ.'+esc(a.amphoe)+'</option>'));Object.keys(d.statuses).forEach(k=>$('#trStatus').insertAdjacentHTML('beforeend','<option value="'+k+'">'+esc(d.statuses[k])+'</option>'));}
        box.innerHTML=latestHtml(d.last_imports)+budgetPendingHtml(d)+(d.totals.ready_amount!==undefined?'<p class="note">ยอดพร้อมเสนอตามตัวกรอง '+baht2(d.totals.ready_amount)+' บาท · ราคาต้นทางเป็นข้อมูลอ้างอิง การรวมหน่วยและรายการรอผลส่งอาจทำให้ยอดพร้อมเสนอต่างกัน</p>':'')+'<div class="chips"><span class="chip">พบ '+num(d.total_rows)+' รายการ</span><span class="chip">'+(d.budget_pending?'ยอดในทะเบียน (รวมที่เบิกแล้ว) ':'ยอดที่แสดง ')+baht2(d.totals.amount)+' ฿</span>'+statusAmountChips(d)+'<span class="chip flag-r">เทียบอ้างอิง: ขาด '+baht2(d.totals.shortage)+' ฿ · '+num(d.totals.shortage_n)+' รายการ</span><span class="chip flag-up">เทียบอ้างอิง: เกิน '+baht2(d.totals.excess)+' ฿ · '+num(d.totals.excess_n)+' รายการ</span></div><p class="tiny muted">ส่วนต่างเป็นข้อมูลเปรียบเทียบรายหมายตามพื้นที่ ต้องตรวจยอดใบเบิกทั้งใบประกอบด้วย</p>'+
        '<div class="clay panel"><div class="tbl-wrap"><table class="wide-tbl track-tbl"><thead><tr><th>เลขคดี / หมาย</th><th class="onm">ผู้ส่ง</th><th>วันที่ส่ง / รายงาน</th><th class="n">ยอดอ้างอิงระบบ</th><th class="n">ยอดบัญชี / ยอดที่ใช้</th><th>เทียบอ้างอิง</th><th class="n">ราคาต้นทาง</th><th class="n">ปรับรวมหน่วย</th><th class="n">ยอดพร้อมเสนอ</th><th>สถานะ</th><th>รอบ / หลักฐาน</th><th></th></tr></thead><tbody>'+
        (d.rows.length?d.rows.map((r,i)=>'<tr><td><b>'+esc(r.case_no)+'</b><br><span class="tiny">'+esc(r.notice_kind)+'</span><br><span class="tiny muted">ต.'+esc(r.tambon||'ไม่ระบุ')+' · อ.'+esc(r.amphoe||'ไม่ระบุ')+'</span></td><td class="onm">'+esc(r.officer)+'</td><td class="small">'+esc(thDate(r.delivered_date)||'รอผล')+'<br>'+esc(thDate(r.reported_date)||'—')+'</td><td class="n">'+(r.reference===null?'—':baht2(r.reference))+'</td><td class="n"><b>'+baht2(r.amount)+'</b><br><span class="tiny">'+esc(r.source)+'</span></td><td>'+differenceHtml(r.difference)+'</td><td class="n">'+(r.pay_type==='BUDGET'?baht2(r.source_amount):'—')+'</td><td class="n">'+(r.pay_type==='BUDGET'?baht2(r.unit_adjustment):'—')+'</td><td class="n"><b>'+ (r.pay_type==='BUDGET'?baht2(r.ready_amount):'—')+'</b>'+(r.pay_type==='BUDGET'?'<br><span class="tiny muted">'+esc(r.ready_reason)+'</span>':'')+'</td><td>'+statusHtml(r)+'</td><td class="small">'+esc(r.round_id||'ยังไม่พบประวัติรอบ')+'<br>'+esc(r.payment_date?thDate(r.payment_date)+' · '+r.payment_ref: r.round_id?'ยังไม่บันทึกหลักฐานจ่ายในระบบ':'')+'</td><td><button class="btn btn-sm" data-tr="'+i+'">รายละเอียด</button></td></tr>').join(''):'<tr><td colspan="12">ไม่พบรายการตามตัวกรอง</td></tr>')+'</tbody></table></div>'+
        '<div class="row" style="margin-top:12px"><button class="btn btn-sm" id="trPrev" '+(page<=1?'disabled':'')+'>← ก่อนหน้า</button><span>หน้า '+num(page)+'</span><button class="btn btn-sm" id="trNext" '+(page*100>=d.total_rows?'disabled':'')+'>ถัดไป →</button>'+(unit?'<button class="btn btn-sm" id="trClearUnit">กลับทุกรายการ</button>':'')+'</div><p class="tiny muted">ยังไม่พบประวัติในระบบไม่ได้แปลว่าไม่เคยเบิก · ยอดศูนย์อาจรวมในหมายอื่น · ประวัติรอบเก่าคงยอดเดิม</p></div>';
        if(S.page==='overview'){
          const summary=document.createElement('section');summary.className='clay panel';
          const group=(id,label,rows,key,name)=>'<details><summary><b>'+label+'</b> · แตะชื่อเพื่อกรองรายการด้านล่าง</summary><div class="tbl-wrap"><table id="'+id+'"><thead><tr><th>'+label+'</th><th class="n">จำนวน (ฉบับ)</th><th class="n" data-sort>รวม (บาท)</th></tr></thead><tbody>'+rows.map(r=>'<tr><td class="onm"><button class="close-person" type="button" data-summary-key="'+key+'" data-summary-value="'+esc(r[key])+'">'+esc(name(r))+'</button></td><td class="n">'+num(r.count)+'</td><td class="n">'+baht2(r.amount)+'</td></tr>').join('')+'</tbody></table></div></details>';
          summary.innerHTML='<h3>สรุปตามตัวกรอง</h3><p class="tiny muted">รวมทุกรายการที่ค้นพบ ยอดรวมก่อนแบ่ง 60/40</p>'+group('trPeople','รายผู้ส่งหมาย',d.per_officer,'officer_id',r=>r.officer)+group('trAreas','รายพื้นที่',d.per_area||[],'area_id',r=>'ต.'+r.tambon+' · อ.'+r.amphoe);
          box.querySelector('.chips').insertAdjacentElement('afterend',summary);sortable($('#trPeople'));sortable($('#trAreas'));
          summary.querySelectorAll('[data-summary-key]').forEach(b=>b.onclick=()=>{if(!b.dataset.summaryValue)return;$(b.dataset.summaryKey==='area_id'?'#trArea':'#trOfficer').value=b.dataset.summaryValue;page=1;unit='';run();});
        }
        $('#trPrev').onclick=()=>{page--;run();};$('#trNext').onclick=()=>{page++;run();};if($('#trClearUnit'))$('#trClearUnit').onclick=()=>{unit='';page=1;run();};
        box.querySelectorAll('[data-tr]').forEach(b=>b.onclick=()=>{
          const r=d.rows[+b.dataset.tr],detail=$('#trackDetail');detail.innerHTML='<div class="clay panel"><h3>'+esc(r.case_no)+' · '+esc(r.notice_kind)+'</h3><p>'+esc(r.recipient)+' · '+esc(r.officer)+' · ต.'+esc(r.tambon)+'</p><p>'+statusHtml(r)+' · '+differenceHtml(r.difference)+'</p><p class="small">หน่วยเบิก '+esc(r.unit_id||'แยกฉบับ')+' · '+num(r.grouped_count)+' ฉบับ'+(r.amount===0&&r.grouped_count>1?' · ยอดอาจรวมอยู่ในหมายอื่น':'')+'</p>'+ (r.unit_id?'<button class="btn btn-sm" id="trGroup">ดูหมายในหน่วยเดียวกัน</button>':'')+(r.can_split?'<button class="btn btn-sm" id="trSplit" type="button">แยกฉบับ</button><p class="tiny muted">กลุ่มต้นทางนี้มี '+num(r.split_count||1)+' ฉบับ · เพิ่มเฉพาะจำนวนทะเบียน ไม่เพิ่มเงินหรือเปลี่ยนรอบเดิม</p>':r.split_parent_uid?'<p class="note">ฉบับแยกนับจำนวน ร่วมยอดกับฉบับต้นทาง ไม่คิดเงินเพิ่ม</p>':'')+'<h3 style="margin-top:14px">ประวัติรอบที่พบ</h3>'+(r.history.length?r.history.map(h=>'<p class="small">'+esc(h.round_id)+' · '+esc(thDate(h.pay_date))+' · '+baht2(h.amount)+' ฿ · '+esc(h.payment_date?'จ่ายจริง '+thDate(h.payment_date)+' '+h.payment_ref:'อยู่ในรอบยืนยันแล้ว')+'</p>').join(''):'<p>ยังไม่พบประวัติรอบในระบบ</p>')+(r.round_id?'<button class="btn btn-g btn-sm" id="trRound">เปิดรอบ / พิมพ์</button>':'')+'</div>';
          if($('#trSplit'))$('#trSplit').onclick=async()=>{
            const reason=await askBox('ยืนยันแยก '+r.case_no+' เพิ่มอีก 1 ฉบับ จาก '+num(r.split_count||1)+' เป็น '+num((r.split_count||1)+1)+' ฉบับ โดยไม่เพิ่มเงินและไม่เปลี่ยนรอบเดิม',{input:'ระบุเหตุผลหรือหลักฐานยืนยันจำนวนฉบับ'});
            if(!reason)return;const button=$('#trSplit');button.disabled=true;
            try{const out=await api('notice_split',{notice_uid:r.notice_uid,expected_snapshot:r.split_snapshot,reason:reason});toast('แยกฉบับแล้ว รวม '+num(out.physical_count)+' ฉบับ · ยอดเงินเดิม');detail.innerHTML='';await run();}catch(e){toast(e.message);button.disabled=false;}
          };
          if($('#trGroup'))$('#trGroup').onclick=()=>{unit=r.unit_id;$('#trQ').value='';page=1;run();};if($('#trRound'))$('#trRound').onclick=()=>{S.payoutSub='round:'+r.round_id;go('payout');};detail.scrollIntoView({behavior:'smooth',block:'start'});
        });
      }catch(e){if(ticket!==seq)return;box.innerHTML='<div class="note r">'+esc(e.message)+'</div>';if(e.code==='RECOVERY_REQUIRED'){const b=document.createElement('button');b.className='btn';b.textContent='ตรวจและกู้คืนงานบันทึก';b.onclick=recoverWork;box.appendChild(b);}}
      finally{busy=false;}
    };
    $('#trType').value=preset;
    $('#trackForm').onsubmit=e=>{e.preventDefault();unit='';page=1;run();};await run();
  };
  RENDER.paid=m=>RENDER.tracking(m,{pay_type:'PAID',title:'หมายเงินนอกงบประมาณ',description:'ตรวจรายหมาย ยอดตามบัญชีจ่าย ผู้ส่งและพื้นที่ พร้อมดูรอบยืนยันและหลักฐานที่เกี่ยวข้อง'});
  RENDER.budget=async m=>{const box=document.createElement('div');await RENDER.tracking(m,{pay_type:'BUDGET',title:'หมายเงินงบประมาณ',description:'ทะเบียนหมายฟรี แยกส่งแล้ว รอผล รอตรวจ และสถานะการเบิก เลือกพื้นที่หรือผู้ส่งเพื่อดูรายการของตน'});const desc=m.querySelector('.page-description');if(desc)desc.after(box);else m.prepend(box);loadFreeClaim(box,S.fy);};
  RENDER.overview=m=>viewerOnly()?RENDER.calc(m):RENDER.tracking(m,{title:'ภาพรวม 2 ประเภท',description:'รวมเงินนอกงบประมาณและเงินงบประมาณ กรองรายคน รายพื้นที่ และสถานะ แล้วตรวจรายละเอียดรายหมายได้ด้านล่าง'});
  RENDER.search = RENDER.tracking;
  RENDER.reports = async(m)=>{
    const canCloseout=has('FINANCE','NOTICE','ADMIN');
    m.innerHTML=top(S.page==='finance'?'ตรวจเงินงบประมาณ · รายงาน':'รายงานการเบิกจ่าย')+'<p class="page-description">ตรวจยอดตามบัญชี ประวัติรอบ และรายการคงค้าง ก่อนจัดรอบเบิก 60/40</p>'+(canCloseout?ledgerPendingPanel()+'<section class="clay panel closeout"><h3>เงินงบประมาณ · ตรวจรายการยังไม่เบิก</h3><p class="small muted">กดตรวจสอบเพื่ออ่านข้อมูลปัจจุบัน ตั้งแต่ 1 ตุลาคมของปีงบที่เลือกถึงวันที่กด (ไม่เกิน 30 กันยายน) รายการที่เบิกแล้วจะไม่แสดงในรายงานคงค้าง</p><form id="closeForm" class="row"><label>ปีงบประมาณ พ.ศ.<input class="inp year-input" id="closeFy" inputmode="numeric" maxlength="4" value="'+esc(S.fy)+'" required></label><label>งบคงเหลือที่ใช้จ่ายได้ (บาท)<input class="inp" id="closeBalance" inputmode="decimal" placeholder="กรอกเพื่อเทียบเงินพอ / ไม่พอ"></label><button class="btn btn-g" id="closeRun">ตรวจสอบข้อมูลปัจจุบัน</button></form><p class="tiny muted">ยอดประเมินเป็นยอดเต็มก่อนแบ่ง 60/40 · หลายฉบับอาจรวมเป็นหนึ่งหน่วยเบิก · ยังไม่มีผลส่งหรือรอตรวจจะไม่รวมในยอดประมาณการก่อนการเบิก</p><div id="closeBody" aria-live="polite"></div></section>':'')+'<details class="clay panel"><summary><b>รายงานการเบิกจ่าย</b></summary><form class="row" id="repForm" style="margin-top:14px"><label>ปีงบประมาณ<input id="repFy" class="inp year-input" inputmode="numeric" value="'+esc(S.fy)+'" placeholder="ทั้งหมด"></label><label>แหล่งเงิน<select id="repType" class="sel"><option value="BUDGET">เงินงบประมาณ</option><option value="PAID">เงินนอกงบประมาณ</option><option value="">ทั้ง 2 ประเภท</option></select></label><button class="btn btn-g">แสดงรายงาน</button></form><div id="repBody"></div></details>';
    if(canCloseout) { bindCloseout(m); bindLedgerPending(m); }
    const run=async()=>{const d=await api('reports',{fy:$('#repFy').value,pay_type:$('#repType').value}),box=$('#repBody');box.innerHTML=latestHtml(d.last_imports)+'<div class="clay panel"><h3>สรุปรายผู้ส่งตามตัวกรอง</h3><p class="tiny muted">ส่วนต่างเทียบยอดอ้างอิง อาจเกิดจากการรวมหน่วยเบิก ให้ตรวจรายละเอียดก่อนสรุปว่าเงินขาดหรือจ่ายเกิน</p><div class="tbl-wrap"><table class="report-officers"><thead><tr><th class="onm">ผู้ส่ง</th><th class="n">รายการ</th><th class="n">ยอดที่ใช้</th><th class="n">ขาดจากยอดอ้างอิง</th><th class="n">เกินยอดอ้างอิง</th></tr></thead><tbody>'+d.per_officer.map(r=>'<tr><td class="onm">'+esc(r.officer)+'</td><td class="n">'+num(r.count)+'</td><td class="n">'+baht2(r.amount)+'</td><td class="n '+(r.shortage?'flag-r':'muted')+'">'+baht2(r.shortage)+'</td><td class="n '+(r.excess?'flag-up':'muted')+'">'+baht2(r.excess)+'</td></tr>').join('')+'</tbody></table></div><div class="row" style="margin-top:14px"><button class="btn btn-sm" id="repCsv">ดาวน์โหลด CSV</button><button class="btn btn-sm" id="repPrint">พิมพ์รายงาน</button></div></div>'+
      '<div class="clay panel"><h3>จำนวนตามสถานะ</h3>'+Object.keys(d.totals.statuses).map(k=>'<p>'+esc(d.statuses[k])+' <b>'+num(d.totals.statuses[k])+'</b> รายการ</p>').join('')+'<p class="tiny muted">สรุปจากหมายที่มีในทะเบียนตามตัวกรอง ส่วนยอดบัญชีและรอบด้านล่างใช้เป็นข้อมูลควบคุมแยกกัน</p></div>'+ledgerControlHtml(d);
      $('#repCsv').onclick=()=>{const rows=[['ผู้ส่ง','รายการ','ยอดที่ใช้','ขาด','เกิน']].concat(d.per_officer.map(r=>[r.officer,r.count,r.amount,r.shortage,r.excess]));const csv='\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"').join(',')).join('\r\n');const u=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=u;a.download='notice-pay-report.csv';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
      $('#repPrint').onclick=()=>{loadSarabun();printArea('<div class="pr-head"><div class="pr-court">ศาลจังหวัดลพบุรี</div><div class="pr-title">รายงานการเบิกจ่าย · ปีงบ '+esc($('#repFy').value||'ทั้งหมด')+'</div><div>'+esc($('#repType').selectedOptions[0].textContent)+'</div></div>'+box.querySelector('.tbl-wrap').innerHTML+'<p>ขาดรวม '+baht2(d.totals.shortage)+' · เกินรวม '+baht2(d.totals.excess)+' บาท</p>');};
    };$('#repForm').onsubmit=e=>{e.preventDefault();run().catch(e=>toast(e.message));};await run();
  };
  function pendingBreakdownHtml(b){if(!b)return '';return '<div class="note"><b>รอยืนยันการจับคู่ ไม่ใช่ยอดค้างจ่าย</b><br>มีบัญชีจ่ายแล้ว ยังไม่มีรอบแบ่งในระบบ '+num(b.no_round_n)+' รายการ · '+baht2(b.no_round_amount)+' บาท<br>มีบัญชีจ่ายและรอบแบ่งแล้ว ยังไม่ผูกทะเบียน '+num(b.confirmed_round_n)+' รายการ · '+baht2(b.confirmed_round_amount)+' บาท<p class="tiny muted">ตรวจแยกวันที่ได้ที่ตาราง “บัญชีจ่ายแยกตามวันที่จ่าย” การจับคู่ไม่ได้ไม่ทำให้ยอดบัญชีหรือยอดแบ่งเดิมหายไป สถานะรับเงินจริงให้ดูหลักฐานจ่ายของรอบ</p></div>';}
  function ledgerPendingPanel() {
    return '<section class="clay panel"><h3>บัญชีจ่ายเงิน · รอยืนยันการจับคู่</h3><p class="small muted">แสดงรายการที่ยังเชื่อมกับหมายไม่ได้ หรือหลักฐานขัดกัน รอยืนยันการจับคู่ไม่ได้แปลว่ายังไม่จ่ายเงิน ยอดตามบัญชีและรอบเดิมคงเดิม · ระบบตรวจให้อัตโนมัติทุกครั้งที่นำเข้าไฟล์หมาย หรือกด “ตรวจจับคู่และบันทึกใหม่” เพื่อตรวจเอง</p>'+
      '<form id="lpForm" class="row"><label>ปีงบประมาณ<input id="lpFy" class="inp year-input" inputmode="numeric" placeholder="ทั้งหมด" value="'+esc(S.fy)+'"></label><label>เลขคดี<input id="lpQ" class="inp" placeholder="ค้นหาเลขคดี"></label><label>ผู้ส่งหมาย<select id="lpOfficer" class="sel"><option value="">ทุกคน</option></select></label><button class="btn btn-g">ตรวจรายการรอยืนยัน</button></form><div id="lpResult" aria-live="polite"></div></section>';
  }
  function bindLedgerPending(m) {
    let page=1,seq=0,hash='',seeded=false;
    const run=async()=>{
      const ticket=++seq,box=$('#lpResult');hash='';box.innerHTML='<p><span class="spin"></span> กำลังตรวจการจับคู่…</p>';
      try {
        const d=await api('ledger_pending',{fy:$('#lpFy').value,q:$('#lpQ').value,officer_id:$('#lpOfficer').value,page:page});
        if(ticket!==seq||!m.isConnected)return;
        hash=d.reconcile_hash;
        if(!seeded){seeded=true;Object.keys(d.officers).forEach(id=>$('#lpOfficer').insertAdjacentHTML('beforeend','<option value="'+esc(id)+'">'+esc(d.officers[id].name)+'</option>'));}
        box.innerHTML=pendingBreakdownHtml(d.pending_breakdown)+(d.outside&&d.outside.n?'<p class="tiny muted">ไม่นับบัญชีที่แบ่ง 60:40 นอกระบบแล้ว '+num(d.outside.n)+' รายการ · '+baht2(d.outside.amount)+' บาท ('+d.outside.dates.map(x=>esc(thDate(x.pay_date))).join(', ')+')</p>':'')+'<p class="note"><b>รอยืนยัน '+num(d.total_rows)+' รายการ · '+baht2(d.amount)+' บาท</b><br><span class="tiny">ยอดนี้คือยอดรายการที่รอยืนยันการจับคู่ อาจมีรอบแบ่งหรือจ่ายเงินไปแล้ว ห้ามนำไปบวกเป็นยอดค้างจ่าย</span></p>'+
          '<div class="tbl-wrap"><table style="min-width:900px"><thead><tr><th>วันที่จ่าย / รับเงิน</th><th>เลขคดี / ใบเสร็จ</th><th class="onm">ผู้ส่งหมาย</th><th class="n">ยอดบัญชี (บาท)</th><th>ผลตรวจ</th><th>รอบเดิม</th></tr></thead><tbody>'+d.rows.map(r=>'<tr><td class="small">จ่าย '+esc(thDate(r.pay_date))+'<br>รับ '+esc(thDate(r.received_date)||'ไม่ระบุ')+'</td><td><b>'+esc(r.case_no)+'</b><br><span class="tiny">ใบเสร็จ '+esc(r.receipt_no||'ไม่ระบุ')+'</span></td><td class="onm">'+esc(r.officer)+'</td><td class="n">'+baht2(r.amount)+'</td><td><b class="flag-a">รอยืนยัน</b><br><span class="small">'+esc(r.reason)+'</span></td><td class="small">'+esc(r.round_id||'ยังไม่มีรอบแบ่งในระบบ')+(r.round_id?'<br><span class="tiny muted">คงยอดรอบเดิม</span>':'')+'</td></tr>').join('')+(d.rows.length?'':'<tr><td colspan="6">ไม่มีรายการรอยืนยันตามตัวกรอง</td></tr>')+'</tbody></table></div>'+
          '<div class="row" style="margin-top:12px"><button type="button" class="btn btn-sm" id="lpPrev" '+(page<=1?'disabled':'')+'>← ก่อนหน้า</button><span>หน้า '+num(page)+'</span><button type="button" class="btn btn-sm" id="lpNext" '+(page*d.page_size>=d.total_rows?'disabled':'')+'>ถัดไป →</button><button type="button" class="btn btn-sm" id="lpReconcile">ตรวจจับคู่และบันทึกใหม่</button></div><p class="tiny muted">บันทึกเฉพาะการจับคู่ของวันที่ยังไม่เข้ารอบ เมื่อข้อมูลตรงกันจึงเชื่อมทะเบียน รายการที่ยังไม่ชัดเจนคงเป็นรอยืนยัน ไม่แก้ยอดเงินหรือรอบเดิม</p>';
        $('#lpPrev').onclick=()=>{page--;run();};$('#lpNext').onclick=()=>{page++;run();};
        $('#lpReconcile').onclick=async()=>{const b=$('#lpReconcile');b.disabled=true;try{const r=await api('ledger_reconcile',{expected_hash:hash});toast('ตรวจจับคู่แล้ว · เชื่อมเพิ่ม '+num(r.newly_matched||0)+' · เหลือรอยืนยัน '+num(r.pending)+' รายการ · ยอดเงินเดิม');await run();}catch(e){toast(e.message);b.disabled=false;}};
      }catch(e){if(ticket!==seq||!m.isConnected)return;box.innerHTML='<p class="note r">'+esc(e.message)+'</p>';}
    };
    $('#lpForm').onsubmit=e=>{e.preventDefault();page=1;run();};run();
  }
  function closeTable(rows) {
    return '<table class="close-table"><thead><tr><th>เลขคดี / เลขหมาย / ชนิด</th><th class="onm">ผู้ส่งหมาย</th><th>ผู้รับ / สถานที่ส่ง</th><th>จ่ายหมาย / ส่ง / รายงาน</th><th>หน่วยเบิก</th><th class="n">ยอดประมาณการก่อนการเบิก (บาท)</th><th>ผลตรวจ</th></tr></thead><tbody>'+
      (rows.length?rows.map(r=>'<tr><td><b>'+esc(r.case_no)+'</b><br>'+esc(r.notice_no||'—')+'<br><span class="tiny">'+esc(r.notice_kind)+'</span></td><td class="onm">'+esc(r.officer)+'</td><td>'+esc(r.recipient)+'<br>'+esc(r.place||'ยังไม่ระบุสถานที่')+'</td><td class="small">จ่าย '+esc(thDate(r.issued_date)||'ไม่ระบุ')+'<br>ส่ง '+esc(thDate(r.delivered_date)||'รอผล')+'<br>รายงาน '+esc(thDate(r.report_date)||'ไม่ระบุ')+'</td><td class="tiny">'+esc(r.unit_id)+'</td><td class="n '+(r.status==='READY'?'flag-ok':'muted')+'"><b>'+(r.status==='WAIT'||r.status==='REVIEW'?'รอตรวจ':baht2(r.amount))+'</b></td><td class="small '+(r.status==='NOCLAIM'?'flag-r':r.status==='READY'?'flag-ok':'flag-a')+'">'+esc(r.reason)+(r.status==='READY'?'<br><span class="tiny muted">'+esc(r.source)+'</span>':'')+'</td></tr>').join(''):'<tr><td colspan="7" class="muted">ไม่พบรายการตามผลตรวจที่เลือก</td></tr>')+'</tbody></table>';
  }
  function closeOfficerTable(people, t) {
    const cols=[['count','ทั้งหมดที่ยังไม่เบิก (ฉบับ)'],['ready_n','ส่งแล้ว ยังไม่เบิก (ฉบับ)'],['ready_units','หน่วยเบิก'],['wait_n','รอผลส่ง (ฉบับ)'],['review_n','รอตรวจ (ฉบับ)'],['noclaim_n','ไม่เบิกจ่าย (ฉบับ)'],['ready_amount','เงินที่ต้องใช้ (บาท)']];
    const values=o=>cols.map((c,i)=>'<td class="n" data-v="'+Number(o[c[0]]||0)+'">'+(i===cols.length-1?'<b>'+baht2(o[c[0]])+'</b>':num(o[c[0]]))+'</td>').join('');
    return '<div class="tbl-wrap"><table id="closeOfficers" class="report-officers"><thead><tr><th class="onm">ผู้ส่งหมาย · แตะเพื่อดู</th>'+cols.map((c,i)=>'<th class="n"'+(i===cols.length-1?' data-sort':'')+'>'+esc(c[1])+'</th>').join('')+'</tr></thead><tbody>'+people.map(r=>'<tr data-close-officer="'+esc(r.officer_id)+'"><td class="onm"><button type="button" class="close-person" aria-pressed="false" aria-controls="closeDetail">'+esc(r.officer)+'</button></td>'+values(r)+'</tr>').join('')+'</tbody><tfoot><tr><td><b>รวมทุกคน</b></td>'+values(t)+'</tr></tfoot></table></div>';
  }
  function bindCloseout(m) {
    let seq=0, report=null;
    const box=$('#closeBody'),form=$('#closeForm');
    $('#closeFy').oninput=()=>{seq++;report=null;box.innerHTML='<p class="note">ปีงบเปลี่ยนแล้ว กดตรวจสอบข้อมูลปัจจุบันอีกครั้ง</p>';};
    form.onsubmit=async e=>{
      e.preventDefault();const ticket=++seq,b=$('#closeRun'),fy=$('#closeFy').value.trim();
      b.disabled=true;report=null;box.innerHTML='<p><span class="spin"></span> กำลังตรวจทะเบียน ผลส่ง และประวัติการเบิก…</p>';
      try{
        const [d,roster]=await Promise.all([api('reports',{report_mode:'closeout',fy:fy}),api('officers_list').catch(e=>{if(e.code==='VIEW_CHANGED')throw e;return {officers:[],unavailable:true};})]);
        if(ticket!==seq||!m.isConnected)return;
        if(d.report_mode!=='closeout')throw new Error('ระบบรายงานกำลังอัปเดต กรุณาลองใหม่อีกครั้ง');
        report=d;const t=d.totals;
        const byOfficer=new Map(d.per_officer.map(r=>[r.officer_id,Object.assign({},r)]));
        (roster.officers||[]).forEach(o=>{
          const r=byOfficer.get(o.officer_id)||{officer_id:o.officer_id,count:0,ready_n:0,ready_units:0,ready_amount:0,wait_n:0,review_n:0,noclaim_n:0};
          r.officer=o.full_name||o.name||r.officer||o.officer_id;byOfficer.set(o.officer_id,r);
        });
        const people=Array.from(byOfficer.values()).sort((a,b)=>String(a.officer).localeCompare(String(b.officer),'th'));
        box.innerHTML='<div class="note g"><b>ตรวจข้อมูล '+esc(thDate(d.from))+' ถึง '+esc(thDate(d.to))+'</b><br>ข้อมูลปัจจุบัน ณ '+esc(thDate(d.checked_at,true))+' · สิ้นปีงบ '+esc(thDate(d.fiscal_end))+'</div>'+latestHtml(d.last_imports)+
          '<p class="tiny muted">ทะเบียนในไฟล์ถึง '+esc(thDate((d.data_period||{}).to)||'ยังไม่ระบุ')+' · ผลส่งในไฟล์ถึง '+esc(thDate((d.data_period||{}).result_to)||'ยังไม่ระบุ')+' · ผลตรวจครอบคลุมเฉพาะข้อมูลที่นำเข้าแล้ว</p>'+
          '<div class="grid-k close-kpis">'+[['ส่งแล้ว ยังไม่เบิก',num(t.ready_n)+' ฉบับ',num(t.ready_units)+' หน่วยเบิก'],['ยอดประมาณการก่อนการเบิก',baht2(t.ready_amount)+' บาท','ยังไม่ใช่ยอดเบิกจริง · ยืนยันในหน้าเตรียมเบิก'],['รอผล / รอตรวจ',num(t.wait_n+t.review_n)+' ฉบับ','ยังไม่รวมในยอดประมาณการก่อนการเบิก'],['ไม่เบิกจ่าย',num(t.noclaim_n)+' ฉบับ','ไม่นำมารวมยอดเสนอเบิก']].map(a=>'<div class="kpi clay"><span>'+a[0]+'</span><b>'+a[1]+'</b><span>'+a[2]+'</span></div>').join('')+'</div><div id="closeBudget" class="note"></div>'+
          (d.expired?'<p class="note r">สิ้นปีงบประมาณแล้ว หมายฟรีที่ยังไม่ได้เบิกแสดง “ไม่เบิกจ่าย” ไม่นำมารวมยอดเสนอเบิกในรายงานนี้ โดยเก็บประวัติและยอดอ้างอิงเดิมไว้</p>':'')+
          '<p class="tiny muted">ไม่นำรายการที่พบการเบิกแล้ว '+num(t.excluded_claimed)+' ฉบับมาแสดงคงค้าง · กดตรวจสอบใหม่เมื่อมีการนำเข้าหรือยืนยันรอบเพิ่มเติม</p>'+
          '<h3 id="closeOverview">หมายฟรีคงค้าง · รวมทุกคน</h3><p class="small muted">แตะชื่อผู้ส่งหมายเพื่อดูรายการของคนนั้นในตารางด้านล่าง · จำนวนฉบับอาจมากกว่าหน่วยเบิก เพราะรวมหมายตามหลักเกณฑ์เดิม</p>'+
          (roster.unavailable?'<p class="note">โหลดรายชื่อทั้งหมดไม่สำเร็จ ขณะนี้แสดงเฉพาะผู้มีรายการคงค้าง กดตรวจสอบใหม่เพื่อโหลดครบทุกคน</p>':'')+
          closeOfficerTable(people,t)+
          '<section id="closeDetail" class="close-detail" aria-labelledby="closeDetailTitle"><h3 id="closeDetailTitle">รายละเอียดรายฉบับ</h3><p id="closeSelection" class="note" aria-live="polite"></p><div class="row close-actions"><label>รายการที่ต้องการดู<select class="sel" id="closeStatus"><option value="">ทั้งหมดที่ยังไม่เบิก</option><option value="READY">ส่งแล้ว ยังไม่เบิก</option><option value="WAIT">รอผลส่ง</option><option value="REVIEW">รอตรวจข้อมูล</option><option value="NOCLAIM">ไม่เบิกจ่าย</option></select></label><button type="button" class="btn btn-sm" id="closeAll">ดูรายการทุกคน</button><button class="btn btn-sm" id="closePrint">พิมพ์รายการที่แสดง</button><button class="btn btn-sm" id="closeCsv">ดาวน์โหลด CSV</button></div><div id="closeRows" class="tbl-wrap"></div></section>';
        let officer=null;
        const scopeName=()=>officer===null?'ยังไม่ได้เลือกผู้ส่งหมาย':officer===''?'ทุกคน':(byOfficer.get(officer)||{}).officer||officer;
        const selected=()=>officer===null?[]:d.rows.filter(r=>(!officer||r.officer_id===officer)&&(!$('#closeStatus').value||r.status===$('#closeStatus').value));
        const selectionTotal=()=>selected().reduce((sum,r)=>sum+Math.round(Number(r.amount||0)*100),0)/100;
        const selectionMoney=()=>$('#closeStatus').value==='NOCLAIM'?'ไม่เบิกจ่าย':['WAIT','REVIEW'].includes($('#closeStatus').value)?'ยังไม่รวมในยอดประมาณการก่อนการเบิก':'ยอดประมาณการก่อนการเบิกตามตัวกรอง '+baht2(selectionTotal())+' บาท';
        const paint=()=>{
          const rows=selected(),label=$('#closeStatus').selectedOptions[0].textContent;
          $('#closeRows').innerHTML=officer===null?'':closeTable(rows);
          $('#closeSelection').textContent=officer===null?'เลือกชื่อผู้ส่งหมายจากตารางรวมด้านบน เพื่อดูรายการของคนนั้น หรือกด “ดูรายการทุกคน”':scopeName()+' · '+label+' · '+num(rows.length)+' ฉบับ'+($('#closeStatus').value==='READY'?' · '+num(new Set(rows.map(r=>r.unit_id)).size)+' หน่วยเบิก · '+baht2(selectionTotal())+' บาท':$('#closeStatus').value==='NOCLAIM'?'':['WAIT','REVIEW'].includes($('#closeStatus').value)?' · ยังไม่รวมในยอดประมาณการก่อนการเบิก':' · ยอดประมาณการก่อนการเบิกในรายการที่แสดง '+baht2(selectionTotal())+' บาท');
          $('#closePrint').disabled=$('#closeCsv').disabled=officer===null||!rows.length;
          $('#closeOfficers').querySelectorAll('[data-close-officer]').forEach(tr=>{const on=tr.dataset.closeOfficer===officer;tr.classList.toggle('close-selected',on);tr.querySelector('button').setAttribute('aria-pressed',String(on));});
        };
        $('#closeOfficers').querySelectorAll('[data-close-officer]').forEach(tr=>tr.onclick=()=>{officer=tr.dataset.closeOfficer;$('#closeStatus').value='';paint();$('#closeDetail').scrollIntoView({behavior:reduceMotion()?'auto':'smooth',block:'start'});});
        sortable($('#closeOfficers'));
        $('#closeAll').onclick=()=>{officer='';paint();};$('#closeStatus').onchange=paint;paint();paintBudget();
        $('#closePrint').onclick=()=>{loadSarabun();printArea('<div class="closeout-print"><div class="pr-head"><div class="pr-court">ศาลจังหวัดลพบุรี</div><div class="pr-title">รายงานตรวจสอบหมายฟรีก่อนปิดงบ · ปีงบ '+esc(d.fy)+'</div><p>ช่วงข้อมูล '+esc(thDate(d.from))+' ถึง '+esc(thDate(d.to))+' · ตรวจ ณ '+esc(thDate(d.checked_at,true))+'</p><p>ผู้ส่งหมาย: '+esc(scopeName())+' · ผลตรวจ: '+esc($('#closeStatus').selectedOptions[0].textContent)+'</p><p>รายการที่พิมพ์ '+num(selected().length)+' ฉบับ · '+esc(selectionMoney())+'</p></div>'+$('#closeBudget').outerHTML+closeTable(selected()).replace('<table class="close-table">','<table class="pr-tbl close-table">')+'<p class="pr-note">ยอดเต็มก่อนแบ่ง 60/40 · ฉบับที่รวมหน่วยไม่นับยอดซ้ำ · รอผลและรอตรวจยังไม่รวมยอด · รายงานนี้แสดงข้อมูล ณ เวลาตรวจ ไม่ใช่หลักฐานการจ่ายเงิน</p></div>');};
        $('#closeCsv').onclick=()=>{const rows=[['ปีงบ','ตรวจ ณ','เลขคดี','เลขหมาย','ชนิด','ผู้ส่ง','ผู้รับ','สถานที่','จ่ายหมาย','ส่ง','รายงาน','หน่วยเบิก','ยอดประมาณการก่อนการเบิก','ยอดอ้างอิง','ผลตรวจ']].concat(selected().map(r=>[d.fy,d.checked_at,r.case_no,r.notice_no,r.notice_kind,r.officer,r.recipient,r.place,r.issued_date,r.delivered_date,r.report_date,r.unit_id,r.status==='WAIT'||r.status==='REVIEW'?'รอตรวจ':r.amount,r.reference,r.reason]));const csv='\ufeff'+rows.map(r=>r.map(v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"').join(',')).join('\r\n');const u=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=u;a.download='free-closeout-'+d.fy+'-'+d.today+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
      }catch(x){if(ticket===seq)box.innerHTML='<p class="note r">'+esc(x.message)+'</p>';}finally{b.disabled=false;}
    };
    function paintBudget(){
      if(!report||!$('#closeBudget'))return;
      const el=$('#closeBudget'),raw=$('#closeBalance').value.trim();
      if(!raw){el.className='note';el.textContent='กรอกงบคงเหลือเพื่อเทียบเงินพอ / ไม่พอ (ยังไม่มีงบคงเหลือให้เปรียบเทียบ)';return;}
      try {const balance=amtOf(raw),diff=Math.round(balance*100)-Math.round(report.totals.ready_amount*100);el.className='note '+(diff<0?'r':'g');el.textContent='งบคงเหลือ (เทียบยอดรวมทุกคน) '+baht2(balance)+' บาท · ยอดประมาณการก่อนการเบิก '+baht2(report.totals.ready_amount)+' บาท · '+(diff<0?'เงินไม่พอ ขาด ':'เงินพอ เหลือ ')+baht2(Math.abs(diff)/100)+' บาท'+(report.totals.wait_n+report.totals.review_n?' · ยังมีรายการรอผล/รอตรวจ ยอดอาจเพิ่มภายหลัง':'');}catch(x){el.className='note r';el.textContent=x.message;}
    }
    $('#closeBalance').oninput=paintBudget;
  }
  function ledgerControlHtml(d){const l=d.ledger_summary||{},r=d.round_summary||{},bd=l.by_date||[],nr=bd.filter(x=>x.state!=='IN_ROUND');return pendingBreakdownHtml(l.pending_breakdown)+'<div class="clay panel"><h3>ยอดควบคุมจากบัญชีและรอบ</h3><p>บัญชีจ่ายเงินหมายมีเงิน '+num(l.count||0)+' รายการ · '+baht2(l.amount||0)+' บาท</p><p>ยังเชื่อมหมายไม่ครบ '+num(l.unmatched_n||0)+' รายการ · '+baht2(l.unmatched_amount||0)+' บาท</p>'+(l.outside_n?'<p>แบ่ง 60:40 นอกระบบแล้ว (ไม่ตั้งรอบ) '+num(l.outside_n)+' รายการ · '+baht2(l.outside_amount)+' บาท</p>':'')+'<p>รอบยืนยันตามตัวกรอง '+num(r.count||0)+' รอบ · '+baht2(r.amount||0)+' บาท</p>'+
    (nr.length?'<div class="note">'+nr.map(x=>'<b>'+esc(thDate(x.pay_date))+'</b> '+esc(x.state_th)+' · '+num(x.no_round_n)+' รายการ '+baht2(x.no_round_amount)+' บาท'+(x.unmatched_n&&x.state!=='OUTSIDE'?' · รอยืนยันการจับคู่ '+num(x.unmatched_n)+' รายการ':'')).join('<br>')+'</div>':'')+
    (bd.length?'<details><summary class="small">บัญชีจ่ายแยกตามวันที่จ่าย ('+num(bd.length)+' วัน)</summary><div class="tbl-wrap"><table><thead><tr><th>วันที่จ่าย</th><th class="n">รายการ</th><th class="n">บาท</th><th class="n">รอยืนยัน</th><th>รอบแบ่งในระบบ</th></tr></thead><tbody>'+bd.map(x=>'<tr><td>'+esc(thDate(x.pay_date))+'</td><td class="n">'+num(x.rows)+'</td><td class="n">'+baht2(x.amount)+'</td><td class="n'+(x.unmatched_n&&x.state!=='OUTSIDE'?' flag-r':'')+'">'+num(x.unmatched_n)+'</td><td class="small '+(x.state==='IN_ROUND'?'flag-ok':x.state==='OUTSIDE'?'muted':'flag-r')+'">'+esc(x.state_th)+(x.round_ids.length?'<br><span class="tiny muted">'+esc(x.round_ids.join(', '))+'</span>':'')+'</td></tr>').join('')+'</tbody></table></div></details>':'')+
    '<p class="tiny muted">ยอดบัญชีที่ยังจับคู่ไม่ได้ยังคงอยู่ในยอดควบคุม ไม่ถูกลบออกจากบัญชีจ่าย</p></div>';}
  function budgetPendingHtml(d){const b=d.budget_pending;if(!b)return '';return '<div class="clay panel"><h3>หมายเงินงบประมาณคงค้าง ปีงบ '+esc(b.fy)+'</h3><div class="chips"><span class="chip est" title="ยังไม่ใช่ยอดเบิกจริง — ยืนยันในหน้าเตรียมเบิกก่อน">ยอดประมาณการก่อนการเบิก '+num(b.ready_n)+' ฉบับ · '+num(b.ready_units)+' หน่วย · <b>'+baht2(b.ready_amount)+' ฿</b></span><span class="chip">รอผลส่ง '+num(b.wait_n)+' ฉบับ</span><span class="chip">รอตรวจ '+num(b.review_n)+' ฉบับ</span><span class="chip">ไม่เบิกจ่าย '+num(b.noclaim_n)+' ฉบับ</span>'+(b.excluded_claimed!==null&&b.excluded_claimed!==undefined?'<span class="chip">เบิกแล้ว (ไม่นับคงค้าง) '+num(b.excluded_claimed)+' ฉบับ</span>':'')+'</div><p class="tiny muted">คิดแบบเดียวกับหน้า ตรวจเงินงบประมาณ ('+esc(thDate(b.from))+' ถึง '+esc(thDate(b.to))+' ทั้งปีงบ ไม่ขึ้นกับตัวกรองพื้นที่/วันที่/สถานะ) · ยอดในทะเบียนด้านล่างรวมรายการที่เบิกแล้ว จึงใช้แทนยอดคงค้างไม่ได้</p></div>';}
  function statusAmountChips(d){const a=(d.totals||{}).status_amount||{},st=d.statuses||{};return Object.keys(a).filter(k=>(d.totals.statuses||{})[k]).map(k=>'<span class="chip">'+esc(st[k]||k)+' '+num(d.totals.statuses[k])+' · '+baht2(a[k])+' ฿</span>').join('');}
  RENDER.settings=(m)=>{m.innerHTML=top('ตั้งค่าและข้อมูลอ้างอิง')+'<div class="clay panel"><h3>ข้อมูลประกอบการตรวจ</h3><div class="row"><button class="btn btn-g" id="setRates">ผู้ส่งหมายและอัตรา</button>'+(has('ADMIN')?'<button class="btn" id="setUsers">ผู้ใช้และสิทธิ์</button><button class="btn" id="setRecovery">ตรวจงานบันทึกค้าง</button>':'')+'</div><p class="small muted" style="margin-top:12px">อัตราและหลักการคำนวณใช้ค่าที่ตั้งไว้เดิม การปรับสิทธิ์ทำได้เฉพาะผู้ดูแลระบบ</p></div>';$('#setRates').onclick=()=>go('officers');if($('#setUsers'))$('#setUsers').onclick=()=>go('users');if($('#setRecovery'))$('#setRecovery').onclick=recoverWork;};
  RENDER.finance = RENDER.reports;
  RENDER.compensation = async function(m) {
    const d=await api('compensation_summary',{fy:S.fy||''}),t=d.totals,bulkOk=!!(d.can_payment&&d.unrecorded_rounds&&d.allow_bulk);   // 0.7.25 ปิดบันทึกจ่ายหลายรอบเป็นค่าเริ่มต้น
    m.innerHTML=top('สรุปค่าตอบแทนเจ้าพนักงาน')+'<p class="page-description">ดูยอดส่วน 60% ที่บันทึกในรอบยืนยันแล้ว แยกรอบที่บันทึกหลักฐานจ่ายจริงในระบบแล้ว กับรอบที่ยังไม่ได้บันทึก</p>'+
      '<form class="clay panel row" id="compForm"><label>ปีงบประมาณ พ.ศ.<input class="inp year-input" id="compFy" inputmode="numeric" maxlength="4" value="'+esc(d.fy)+'" placeholder="ทุกปีงบประมาณ"></label><button class="btn btn-g">แสดงสรุป</button><button type="button" class="btn" id="compPrint">พิมพ์สรุป</button></form>'+
      '<div class="comp-kpis"><div class="clay kpi"><span>ส่วน 60% ตามรอบยืนยัน</span><b>'+baht2(t.c60)+'</b><small>บาท · ยอดที่บันทึกไว้เดิม</small></div><div class="clay kpi"><span>บันทึกจ่ายจริงในระบบแล้ว</span><b class="flag-ok">'+baht2(t.paid60)+'</b><small>บาท · ตามสถานะจ่ายของรอบ</small></div><div class="clay kpi"><span>ยังไม่บันทึกหลักฐานจ่าย</span><b class="flag-a">'+baht2(t.pending60)+'</b><small>บาท · '+num(d.unrecorded_rounds||0)+' รอบ · ไม่ได้แปลว่ายังไม่จ่าย</small></div></div>'+
      (d.unrecorded_rounds?'<div class="note">มี '+num(d.unrecorded_rounds)+' รอบที่ยืนยันแล้วแต่ช่อง “สถานะจ่ายเงินจริง” ยังว่าง ยอด '+baht2(t.pending60)+' บาทจึงยังไม่นับเป็นจ่ายแล้ว หากจ่ายเงินแล้ว '+(bulkOk?'ให้เลือกรอบในตารางด้านล่างแล้วกด “บันทึกว่าจ่ายแล้ว”':d.can_payment?'ให้เปิดรอบนั้น (กดรหัสรอบ) แล้วกด “บันทึกหลักฐานจ่ายจริง” ทีละรอบ พร้อมวันที่และเลขเอกสาร':'ให้การเงินหรือผู้ดูแลระบบบันทึกหลักฐานจ่าย')+'</div>':'')+
      '<section class="clay panel" id="compSummary"><h3>ค่าตอบแทนรายผู้ส่งหมาย</h3><p class="tiny muted">ยอดฐานเป็นยอดก่อนแบ่ง ส่วน 60% เป็นค่าตอบแทนตามรอบเดิม · ▲ ยอดมากไปน้อย · ▼ ยอดน้อยไปมาก</p><div class="tbl-wrap"><table id="compTable" class="wide-tbl"><thead><tr><th class="onm">ผู้ส่งหมาย</th><th class="n">รอบยืนยัน</th><th class="n">ฐานนอกงบฯ</th><th class="n">ฐานงบประมาณ</th><th class="n">บันทึกจ่ายแล้ว (60%)</th><th class="n">ยังไม่บันทึกจ่าย (60%)</th><th class="n" data-sort>รวมส่วน 60% (บาท)</th></tr></thead><tbody>'+d.officers.map(r=>'<tr><td class="onm">'+oDot({officer:{color:r.color}},'officer')+' '+esc(r.name)+'</td><td class="n">'+num(r.rounds)+'</td><td class="n">'+baht2(r.paid)+'</td><td class="n">'+baht2(r.budget)+'</td><td class="n">'+baht2(r.paid60)+'</td><td class="n">'+baht2(r.pending60)+'</td><td class="n"><b>'+baht2(r.c60)+'</b></td></tr>').join('')+'</tbody><tfoot><tr><td colspan="2">รวม</td><td class="n">'+baht2(t.paid)+'</td><td class="n">'+baht2(t.budget)+'</td><td class="n">'+baht2(t.paid60)+'</td><td class="n">'+baht2(t.pending60)+'</td><td class="n"><b>'+baht2(t.c60)+'</b></td></tr></tfoot></table></div><p class="tiny muted">ส่วน 40% รวม '+baht2(t.c40)+' บาท นำเข้ากองกลาง ไม่ใช่ยอดรับส่วนบุคคล การแบ่งต่อที่นั่งและเศษยกไปแสดงในรายละเอียดรอบ</p></section>'+
      '<section class="clay panel"><h3>รอบที่นำมาสรุป</h3><p class="tiny muted">รายการนี้ใช้รหัสรอบเดิม เลขที่ใบเบิกให้ตรวจจากเอกสารต้นทาง</p><div class="tbl-wrap"><table class="wide-tbl"><thead><tr>'+(bulkOk?'<th><input type="checkbox" id="compAll" aria-label="เลือกทุกรอบที่ยังไม่บันทึกจ่าย"></th>':'')+'<th>รหัสรอบ</th><th>วันที่รอบ</th><th>แหล่งเงิน</th><th>สถานะจ่ายเงินจริง</th><th class="n">ส่วน 60% (บาท)</th><th></th></tr></thead><tbody>'+(d.rounds.length?d.rounds.map(r=>'<tr>'+(bulkOk?'<td>'+(r.payment_status==='PAID'?'':'<input type="checkbox" data-comp-pick="'+esc(r.round_id)+'" aria-label="เลือกรอบ '+esc(r.round_id)+'">')+'</td>':'')+'<td>'+esc(r.round_id)+'</td><td>'+esc(thDate(r.pay_date))+'</td><td>'+esc(RTYPE_TH[r.round_type]||r.round_type||'ตามรอบเดิม')+'</td><td>'+(r.payment_status==='PAID'?'<span class="flag-ok">จ่ายจริง '+esc(thDate(r.payment_date))+'</span>':'<span class="flag-a">ยืนยันรอบแล้ว · ยังไม่บันทึกหลักฐานจ่าย</span>')+'</td><td class="n">'+baht2(r.c60)+'</td><td><button class="btn btn-sm" type="button" data-comp-round="'+esc(r.round_id)+'">ดูรายละเอียด</button></td></tr>').join(''):'<tr><td colspan="6" class="muted">ยังไม่มีรอบยืนยันในปีงบประมาณที่เลือก</td></tr>')+'</tbody></table></div>'+
      (bulkOk?'<form id="compPay" class="row" style="margin-top:12px"><label>เลขที่หลักฐาน / เอกสารการจ่าย<input class="inp" id="compRef" maxlength="200" required placeholder="เช่น ใบแบ่งยอดศาล / เลขที่ฎีกา"></label><label class="small"><input type="checkbox" id="compUsePay" checked> ใช้วันที่ของแต่ละรอบเป็นวันที่จ่ายจริง</label><label>หรือวันที่จ่ายจริง<input type="date" class="inp" id="compDate" disabled></label><button class="btn btn-g">บันทึกว่าจ่ายแล้ว</button></form><p class="tiny muted">บันทึกสถานะและหลักฐานเท่านั้น ไม่เปลี่ยนยอด เศษ หรือรายการของรอบ · รอบที่บันทึกจ่ายแล้วยกเลิกรอบโดยตรงไม่ได้</p>':'')+'</section>';
    sortable($('#compTable'));
    if($('#compPay')){
      const picks=()=>Array.from(m.querySelectorAll('[data-comp-pick]:checked'),x=>x.dataset.compPick);
      $('#compAll').onchange=e=>m.querySelectorAll('[data-comp-pick]').forEach(x=>{x.checked=e.target.checked;});
      $('#compUsePay').onchange=e=>{$('#compDate').disabled=e.target.checked;$('#compDate').required=!e.target.checked;};
      $('#compPay').onsubmit=async e=>{e.preventDefault();const ids=picks(),b=$('button',e.currentTarget);if(!ids.length){toast('เลือกรอบที่จ่ายเงินแล้วก่อน');return;}
        const use=$('#compUsePay').checked,sum=d.rounds.filter(r=>ids.includes(r.round_id)).reduce((a,r)=>a+Number(r.c60||0),0);
        if(!(await askBox('ยืนยันว่าจ่ายเงินจริงแล้ว '+num(ids.length)+' รอบ (ส่วน 60% รวม '+baht2(sum)+' บาท)'+(use?' โดยใช้วันที่ของแต่ละรอบ':' วันที่ '+thDate($('#compDate').value))+'?')))return;
        b.disabled=true;try{const r=await api('round_payment_bulk',{round_ids:ids,payment_ref:$('#compRef').value,use_pay_date:use,payment_date:use?'':$('#compDate').value});toast('บันทึกจ่ายแล้ว '+num(r.updated)+' รอบ'+(r.skipped.length?' · ข้าม '+num(r.skipped.length)+' รอบ':''));go('compensation');}catch(x){toast(x.message);b.disabled=false;}};
    }
    $('#compForm').onsubmit=e=>{e.preventDefault();S.fy=$('#compFy').value.trim();go('compensation');};
    m.querySelectorAll('[data-comp-round]').forEach(b=>b.onclick=()=>{S.payoutSub='round:'+b.dataset.compRound;go('payout');});
    $('#compPrint').onclick=()=>{loadSarabun();const c=$('#compSummary').cloneNode(true);c.querySelectorAll('button').forEach(b=>b.remove());printArea('<div class="pr-head"><div class="pr-court">ศาลจังหวัดลพบุรี</div><div class="pr-title">สรุปค่าตอบแทนเจ้าพนักงาน</div><p>ปีงบประมาณ '+esc(d.fy||'ทั้งหมด')+' · เฉพาะรอบยืนยัน</p></div>'+c.innerHTML+'<p class="pr-note">อ่านยอดแบ่งที่บันทึกในรอบเดิม การยืนยันรอบไม่ใช่หลักฐานจ่ายเงินจริง</p>');};
  };

  function paymentForm(m,r){let box=$('#paymentBox');if(!box){box=document.createElement('div');box.id='paymentBox';m.appendChild(box);}box.innerHTML='<form class="clay panel" id="payEvidence"><h3>บันทึกหลักฐานจ่ายเงินจริง</h3><p class="small">รอบ '+esc(r.round_id)+' · ยอด '+baht2(r.total)+' บาท</p><div class="row"><label>วันที่จ่ายจริง<input type="date" class="inp" id="actualDate" required></label><label>เลขที่หลักฐาน / เอกสาร<input class="inp" id="actualRef" maxlength="200" required></label><button class="btn btn-g">บันทึกหลักฐานจ่าย</button></div><p class="tiny muted">ใช้เมื่อจ่ายเงินจริงแล้ว การบันทึกนี้ไม่เปลี่ยนยอดและเศษของรอบ</p></form>';$('#payEvidence').onsubmit=async e=>{e.preventDefault();const b=$('button',e.currentTarget);if(!(await askBox('ยืนยันว่าจ่ายเงินจริงแล้วสำหรับรอบ '+r.round_id+' จำนวน '+baht2(r.total)+' บาท?')))return;b.disabled=true;try{await api('round_payment',{round_id:r.round_id,payment_date:$('#actualDate').value,payment_ref:$('#actualRef').value});toast('บันทึกหลักฐานแล้ว');S.payoutSub='round:'+r.round_id;go('payout');}catch(x){toast(x.message);b.disabled=false;}};box.scrollIntoView({behavior:'smooth'});}

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


