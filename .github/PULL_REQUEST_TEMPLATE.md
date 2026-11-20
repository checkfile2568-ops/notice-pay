## คำขอเปลี่ยนแปลง
Change ID / ผู้ขอ / วันที่:
อธิบายปัญหาที่ทำซ้ำได้:
ผลที่ต้องการ (ก่อน → หลัง):
สิ่งที่ต้องคงเดิม:

## วิเคราะห์ผลกระทบก่อนแก้
- [ ] ตรวจรุ่น frontend, GAS deployment ที่เผยแพร่จริง และ schema (read-only)
- [ ] UI → API → validation → sheets → calculation → reports/print → AUDIT
- [ ] นำเข้า 50/42/18/30/25, UID/การป้องกันซ้ำ/ปีงบ
- [ ] 60/40, การปัดเศษ, คนรับ, ลำดับรอบ, carry in/out
- [ ] รอบ confirmed / จ่ายจริงถูกล็อกและไม่ถูกแก้ย้อนหลัง
- [ ] สิทธิ์ NOTICE/FINANCE/COURIER/VIEWER/ADMIN และ R1 privacy
- [ ] Cache, URL backend, API action compatibility, backup/rollback

## ขอบเขตแน่นอน
ไฟล์ที่อนุญาต:
ไฟล์ที่ห้ามเปลี่ยน:
ชนิด change_type ใน manifest (copy-only / tooling-only / runtime):
เหตุที่ไม่ต้องแก้ไฟล์อื่น:

## หลักฐานการทดสอบ
Version matrix (frontend / GAS / schema / cache):
Regression tests + ผล:
ผลคำนวณก่อน/หลัง (ผลต่างต้องเป็น 0 สำหรับข้อมูลเดิม):
กรณี 0/1/2/หลายรอบต่อเดือน และวันศุกร์ที่มี/ไม่มีการจ่าย:
ไฟล์ Excel จริง (ข้อมูลปกปิด) + fixture hash / ที่เก็บส่วนตัว:
Backend/database clone and live read-only verification:
กรณี failed/error, duplicate, retry, concurrent, 60/40 rounding:
Browser มือถือ/คอม + รายงาน/พิมพ์:
ผลของ `node tools/check-release.js`:
จุดที่ยัง BLOCKED:

## ตัดสินใจเผยแพร่
- [ ] ผู้ตรวจสอบอนุมัติขอบเขต
- [ ] การเงินตรวจรับยอด
- [ ] มีสำรองและจุด rollback
- [ ] ไม่มี blocker ค้าง
- [ ] ตรวจ live readback หลังเผยแพร่

**อย่าติ๊กผ่านจากการตรวจ static เพียงอย่างเดียว และอย่าระบุว่า DEPLOYED หากแค่เปิด Draft PR**
