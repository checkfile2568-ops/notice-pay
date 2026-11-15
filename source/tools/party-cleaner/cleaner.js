/* Offline XLSX privacy transform. Uses the exact NoticePay recipient rules. */
var NoticePartyCleaner=(function(){
  'use strict';
  var NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  function nodes(el,name){return Array.from(el.getElementsByTagNameNS('*',name));}
  function xml(s){var d=new DOMParser().parseFromString(s,'application/xml');if(nodes(d,'parsererror').length)throw Error('โครงสร้าง XML ในไฟล์ไม่ถูกต้อง');return d;}
  function serialize(d){return new XMLSerializer().serializeToString(d);}
  function header(v){return String(v||'').toLowerCase().replace(/[\s\u200b\u00a0:()（）.]/g,'');}
  var aliases={
    case_no:['เลขคดี','เลขคดีดำ','เลขดำที่','เลขดำ','หมายเลขคดี','คดีหมายเลข','เลขที่คดี','คดีเลขที่','คดีดำ','คดีหมายเลขดำ','คดีหมายเลขดำที่','หมายเลขคดีดำ','case_no','caseno'],
    recipient:['ผู้รับ','ชื่อผู้รับ','ผู้รับหมาย','ชื่อผู้รับหมาย','หมายถึงใคร','ส่งหมายถึงใคร','ส่งหมายให้ใคร','ส่งถึง','recipient'],
    payer:['ผู้วางเงิน','ชื่อผู้วางเงิน','ผู้ชำระเงิน','ผู้ชำระ','payer'],
    party:['โจทก์','ชื่อโจทก์','จำเลย','ชื่อจำเลย','คู่ความ','ชื่อคู่ความ','plaintiff','defendant']
  };
  function kind(v){var h=header(v);return Object.keys(aliases).find(k=>aliases[k].some(a=>header(a)===h))||(/โจทก์|จำเลย|คู่ความ|plaintiff|defendant/i.test(h)?'party':'');}
  function col(c){return c.getAttribute('r').replace(/\d/g,'');}
  function value(c,strings){if(!c)return '';var t=c.getAttribute('t');if(t==='s'){var v=nodes(c,'v')[0];return strings[Number(v&&v.textContent)]||'';}if(t==='inlineStr')return nodes(c,'t').map(x=>x.textContent).join('');return (nodes(c,'v')[0]||{}).textContent||'';}
  function write(c,v){Array.from(c.childNodes).forEach(x=>c.removeChild(x));c.setAttribute('t','inlineStr');var is=c.ownerDocument.createElementNS(NS,'is'),t=c.ownerDocument.createElementNS(NS,'t');t.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');t.textContent=v;is.appendChild(t);c.appendChild(is);}
  async function clean(bytes){
    var zip=await JSZip.loadAsync(bytes),files=Object.keys(zip.files),stats={sheets:0,rows:0,recipients:0,payers:0,parties:0},removed=new Set(),recognized=0;
    if(files.some(p=>/vbaProject|externalLinks|customXml|comments|threadedComments|embeddings|drawings|vmlDrawing|digitalSignature|_xmlsignatures/i.test(p)))throw Error('ไฟล์มีความคิดเห็น ภาพ วัตถุฝัง ลิงก์ภายนอก หรือส่วนเสริมที่เครื่องมือนี้ยังตรวจชื่อไม่ได้ กรุณาใช้สำเนา .xlsx ที่ไม่มีส่วนเหล่านี้');
    var shared=zip.file('xl/sharedStrings.xml'),sd=shared?xml(await shared.async('string')):null,sis=sd?nodes(sd,'si'):[],strings=sis.map(si=>nodes(si,'t').map(t=>t.textContent).join(''));
    for(var path of files.filter(p=>/^xl\/worksheets\/sheet\d+\.xml$/.test(p))){
      var doc=xml(await zip.file(path).async('string')),active=null;stats.sheets++;
      for(var row of nodes(doc,'row')){
        var cells=nodes(row,'c'),map={},found={};cells.forEach(c=>{map[col(c)]=c;var k=kind(value(c,strings));if(k)(found[k]=found[k]||[]).push(col(c));});
        if(found.case_no&&(found.recipient||found.party||found.payer)){
          if(found.case_no.length!==1||(found.recipient||[]).length>1)throw Error('หัวตารางเลขคดีหรือผู้รับซ้ำ กรุณาแยกตารางก่อนตรวจ');
          active=found;recognized++;continue;
        }
        if(!active)continue;
        var cs=value(map[active.case_no[0]],strings),texts=cells.map(c=>value(c,strings));
        if(texts.some(t=>/^\s*(จ่ายเงินให้\s|รวม(?:ทั้งสิ้น|เป็นเงิน|ทุกคน|เงิน|จำนวน|ยอด|$)|ยอดรวม|ลงชื่อ)/.test(t))&&!cs.trim())continue;
        var sensitive=['recipient','payer','party'].flatMap(k=>(active[k]||[]).map(c=>({k:k,c:map[c]}))).filter(x=>x.c&&value(x.c,strings).trim());
        if(!sensitive.length)continue;
        if(!cs.trim())throw Error('แถว '+row.getAttribute('r')+' มีข้อมูลชื่อแต่ไม่มีเลขคดี กรุณาตรวจไฟล์ต้นฉบับก่อน');
        if(/^\s*(รวม|ยอด|จ่ายเงินให้)/.test(cs))continue;
        if(nodes(map[active.case_no[0]],'f').length)throw Error('เลขคดีเป็นสูตร กรุณาแปลงเป็นค่าก่อนตรวจ');
        stats.rows++;
        for(var field of sensitive){
          var old=value(field.c,strings);if(nodes(field.c,'f').length)throw Error('ช่องชื่อในแถว '+row.getAttribute('r')+' เป็นสูตร กรุณาแปลงเป็นค่าก่อนตรวจ');
          var next=field.k==='recipient'?NoticeImportFormat.recipient(cs,old):'';
          if(old!==next){removed.add(old);write(field.c,next);stats[field.k==='recipient'?'recipients':field.k==='payer'?'payers':'parties']++;}
        }
      }
      // Inline every shared string so unused original names cannot remain in the ZIP.
      for(var cell of nodes(doc,'c').filter(c=>c.getAttribute('t')==='s')){
        var idx=Number((nodes(cell,'v')[0]||{}).textContent),si=sis[idx];if(!si)throw Error('ดัชนีข้อความใน Excel ไม่ถูกต้อง');
        Array.from(cell.childNodes).forEach(x=>cell.removeChild(x));cell.setAttribute('t','inlineStr');var inline=doc.createElementNS(NS,'is');Array.from(si.childNodes).forEach(x=>inline.appendChild(doc.importNode(x,true)));cell.appendChild(inline);
      }
      zip.file(path,serialize(doc));
    }
    if(!recognized)throw Error('ไม่พบหัวตารางเลขคดีกับผู้รับ/คู่ความ/ผู้วางเงินที่รองรับ กรุณาส่งเฉพาะภาพหัวตารางเพื่อเพิ่มรูปแบบ');
    zip.remove('xl/sharedStrings.xml');
    for(var relPath of ['[Content_Types].xml','xl/_rels/workbook.xml.rels'])if(zip.file(relPath)){
      var rel=xml(await zip.file(relPath).async('string'));Array.from(rel.documentElement.childNodes).filter(n=>n.nodeType===1&&/sharedStrings/i.test(n.getAttribute('PartName')||n.getAttribute('Type')||n.getAttribute('Target')||'')).forEach(n=>n.parentNode.removeChild(n));zip.file(relPath,serialize(rel));
    }
    for(var p of Object.keys(zip.files).filter(p=>/\.xml$|\.rels$/.test(p)&&!zip.files[p].dir)){
      var body=xml(await zip.file(p).async('string')).documentElement.textContent||'';
      if(Array.from(removed).some(v=>body.includes(v)))throw Error('ยังพบชื่อเดิมในส่วนอื่นของไฟล์ จึงยังไม่ส่งออก กรุณาตรวจสำเนาต้นฉบับ');
    }
    return {bytes:await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}),stats:stats};
  }
  return {clean:clean};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=NoticePartyCleaner;
