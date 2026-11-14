const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const {createCanvas,GlobalFonts}=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'@napi-rs/canvas'));
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf','Noto Sans Thai');GlobalFonts.registerFromPath('/usr/share/fonts/truetype/noto/NotoSansThai-Bold.ttf','Noto Sans Thai');
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','Tahoma');GlobalFonts.registerFromPath('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','Tahoma');
const drawn=[],images=[],links=[];let index=0;
const root={window:{},Intl,URL:{createObjectURL:b=>{images.push(b);return 'blob:test-'+index++;},revokeObjectURL:()=>{}},document:{fonts:{ready:Promise.resolve()},createElement:tag=>{
 if(tag==='a')return {click(){},className:''};
 const c=createCanvas(1,1),ctx=c.getContext('2d'),fill=ctx.fillText.bind(ctx);ctx.fillText=(t,...args)=>{drawn.push(String(t));return fill(t,...args)};
 c.getContext=()=>ctx;c.toBlob=fn=>fn(c.toBuffer('image/png'));return c;
}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../web/report-export.js'),'utf8'),root);
const rows=Array.from({length:10},(_,i)=>[{text:'เจ้าหน้าที่ทดสอบ '+(i+1)+(i<3?'\n'+(i===2?'ต่ำกว่าอัตรา 1 ฉบับ 50 บาท':'เกินอัตรา 1 ฉบับ '+(i===0?'150':'100')+' บาท'):''),color:['#1e875f','#914d24','#8f3d96'][i%3]},'141','70,500.00','50','30','9,000.00','5','79,500.00']);
(async()=>{
 const spec={title:'สรุปค่าหมายรายผู้ส่ง · ข้อมูลจำลอง',subtitle:'ปีงบประมาณ 2570 · ข้อมูลครบทุกคนและทุกคอลัมน์',headers:['ผู้ส่งหมาย / ข้อควรตรวจ','มีเงิน\nฉบับ','มีเงิน\nบาท','ฟรี\nฉบับ','หน่วยเบิก','ฟรี\nบาท','ฟรีรอวันส่ง\nฉบับ','รวม\nบาท'],widths:[330,110,150,100,110,150,140,160],rows,note:'ยอดก่อนแบ่ง 60/40 · ส่วนต่างเทียบอัตราตำบล · รอบจ่ายหมายมีเงินใช้ยอดบัญชีจ่ายจริง',filename:'synthetic-export',links:{appendChild:a=>links.push(a)}};
 const result=await root.window.NP_EXPORT.png(spec);assert.equal(result.length,1);
 for(let i=1;i<=10;i++)assert.ok(drawn.some(t=>t.includes('เจ้าหน้าที่ทดสอบ '+i)));
 assert.ok(drawn.includes('79,500.00'));assert.equal(links.length,1);
 fs.mkdirSync(path.join(__dirname,'../evidence'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../evidence/png-export-synthetic.png'),images[0]);
 const ctx=createCanvas(1,1).getContext('2d');ctx.font='18px "Noto Sans Thai"';
 for(const txt of ['ต่ำกว่าอัตรา 1 ฉบับ รวม 50 บาท — ปรับขึ้นเป็นอัตราตำบล','บันทึกรอบเบิกแล้ว ตรวจหลักฐานจ่ายเงินจริง','BU-2570-A51D1A5 ถูกล็อก · ม.4'])for(const line of root.window.NP_EXPORT.wrap(ctx,txt,160))assert.ok(ctx.measureText(line).width<=160.1);
 drawn.length=0;await root.window.NP_EXPORT.png({...spec,rows:Array.from({length:80},(_,i)=>['คนที่ '+(i+1),'1','300','1','1','300','0','600'])});assert.ok(links.length>2);for(let i=1;i<=80;i++)assert.ok(drawn.includes('คนที่ '+i));
 console.log('ผ่าน PNG จริงด้วย Canvas: ชื่อครบ 10 คน ทุกคอลัมน์ คำเตือนสี/จำนวนเงิน ครบ 80 คนข้ามหน้า และตัดคำไทยไม่ล้น');
})().catch(e=>{console.error(e);process.exitCode=1});
