/* ระบบค่าหมาย · Service Worker — เก็บไฟล์หน้าเว็บไว้ในเครื่องให้เปิดเร็ว
 * - ไม่เก็บข้อมูลจาก Apps Script (ข้อมูลคดี/การเงิน) ไว้เด็ดขาด — คำขอ POST และโดเมน script.google.com ผ่านตรง
 * - index.html / config.js : ดึงจากเครือข่ายก่อน (ได้รุ่นใหม่ทันที) ถ้าออฟไลน์/ช้าเกิน 3 วินาที ใช้ที่เก็บไว้
 * - ไฟล์อื่น (app.js?v= app.css?v= ตราศาล ฟอนต์ ตัวอ่าน Excel) : ใช้ที่เก็บไว้ก่อน เพราะเปลี่ยนชื่อ ?v= ทุกรุ่น */
const CACHE = 'np-static-0.7.2';
const STATIC_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('np-static-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())));

function isDoc(req, url) {
  return req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/config.js');
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw e;
  }
}

async function cacheFirst(req, url) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) {
    // ลบไฟล์รุ่นเก่าชื่อเดียวกัน (?v= ต่างกัน) กันที่เก็บโตเรื่อย ๆ
    if (url.origin === self.location.origin && url.search) {
      const keys = await cache.keys();
      await Promise.all(keys.filter((k) => { const u = new URL(k.url); return u.pathname === url.pathname && u.search !== url.search; }).map((k) => cache.delete(k)));
    }
    cache.put(req, res.clone());
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (/script\.google(usercontent)?\.com$/.test(url.hostname) || url.hostname.endsWith('googleusercontent.com')) return;
  const same = url.origin === self.location.origin;
  if (same && isDoc(req, url)) { e.respondWith(networkFirst(req)); return; }
  if (same || STATIC_HOSTS.indexOf(url.hostname) >= 0) e.respondWith(cacheFirst(req, url));
});

