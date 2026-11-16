'use strict';
// 0.7.14 รายการรอบเบิกแสดงสถานะ 2 ขั้น (ยืนยันรอบ / บันทึกจ่ายจริง) และสรุปยอดรอบที่ยังไม่บันทึกจ่าย
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
const gas = fs.readFileSync(path.join(__dirname, '../gas/Payout.gs'), 'utf8');

// ฝั่ง API ส่งสถานะจ่ายจริงมากับรายการรอบ
const listFn = gas.slice(gas.indexOf('function apiPayoutList_'), gas.indexOf('function apiPayoutList_') + 1500);
assert(/payment_status: String\(r\.payment_status/.test(listFn), 'payout_list ต้องส่ง payment_status');
assert(/payment_date: r\.payment_date/.test(listFn), 'payout_list ต้องส่ง payment_date');

// ดึงฟังก์ชันหน้าเว็บมาทดสอบแบบแยก
const grab = (name) => { const i = app.indexOf('const ' + name + ' = '); const j = app.indexOf('\n  };\n', i); return app.slice(i, j + 5); };
const ctx = {};
const src = 'const esc=(s)=>String(s);const thDate=(d)=>"D"+d;const num=(n)=>String(n);' +
  'const baht2=(n)=>Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});' +
  grab('roundStatusHtml') + grab('roundPaySummaryHtml') + 'out.st=roundStatusHtml;out.sum=roundPaySummaryHtml;';
new Function('out', src)(ctx);

assert(/ยกเลิก/.test(ctx.st({ status: 'CANCELLED' })));
assert(/ยืนยันรอบแล้ว/.test(ctx.st({ status: 'CONFIRMED' })) && /ยังไม่บันทึกจ่าย/.test(ctx.st({ status: 'CONFIRMED' })));
assert(/จ่ายจริง D2026-11-20/.test(ctx.st({ status: 'CONFIRMED', payment_status: 'PAID', payment_date: '2026-11-20' })));

// ยอดจริงของรอบที่ยืนยันแล้ว ณ 16 พ.ย. 2569 (ยังไม่บันทึกจ่ายทั้ง 8 รอบ)
const totals = [51550, 94000, 70400, 60500, 125950, 76900, 59400, 61450];
const rounds = totals.map((t) => ({ status: 'CONFIRMED', total: t }));
rounds.push({ status: 'CANCELLED', total: 9999 });
const h = ctx.sum(rounds);
assert(/ยืนยันรอบแล้ว 8 รอบ · 600,150.00/.test(h), h);
assert(/บันทึกจ่ายจริงแล้ว 0 รอบ · 0.00/.test(h), h);
assert(/ยังไม่บันทึกจ่าย 8 รอบ · 600,150.00 ฿ \(ส่วนผู้ส่ง 60% 360,090.00/.test(h), h);
// เมื่อบันทึกจ่าย 1 รอบ ยอดย้ายฝั่งถูกต้อง
rounds[0].payment_status = 'PAID';
const h2 = ctx.sum(rounds);
assert(/บันทึกจ่ายจริงแล้ว 1 รอบ · 51,550.00/.test(h2) && /ยังไม่บันทึกจ่าย 7 รอบ · 548,600.00 ฿ \(ส่วนผู้ส่ง 60% 329,160.00/.test(h2), h2);
assert.strictEqual(ctx.sum([]), '');
console.log('workflow-0714: ok');
