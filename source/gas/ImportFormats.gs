/* NoticePay 0.7.5: shared, deterministic input rules. No network or storage. */
var NoticeImportFormat = (function () {
  'use strict';
  function digits(v) { return String(v == null ? '' : v).replace(/[๐-๙]/g, function(c) { return String(c.charCodeAt(0)-0x0e50); }); }
  function text(v) { return digits(v).replace(/\s+/g, ' ').trim(); }
  function name(v) { return text(v).replace(/^(นางสาว|นาง|นาย|น\.ส\.|ด\.ช\.|ด\.ญ\.|เด็กชาย|เด็กหญิง|คุณ|ว่าที่\s*ร\.ต\.)\s*/, '').replace(/\s+/g, ''); }
  function caseNo(v) { return digits(v).split(/\r?\n/)[0].replace(/\s+/g, '').toUpperCase(); }
  function iso(y,m,d) {
    if (y>2400) y-=543;
    if (y<2000 || y>2100 || m<1 || m>12 || d<1 || d>31) return null;
    var dt=new Date(Date.UTC(y,m-1,d));
    return dt.getUTCFullYear()===y && dt.getUTCMonth()===m-1 && dt.getUTCDate()===d ? y+'-'+('0'+m).slice(-2)+'-'+('0'+d).slice(-2) : null;
  }
  function date(v, date1904) {
    if (v==null || v==='') return '';
    if (Object.prototype.toString.call(v)==='[object Date]') return isNaN(v.getTime()) ? null : iso(v.getFullYear(),v.getMonth()+1,v.getDate());
    if (typeof v==='number') {
      if (!isFinite(v) || v<=0) return null;
      var dt=new Date(Date.UTC(1899,11,30)+(Math.floor(v)+(date1904?1462:0))*86400000);
      return iso(dt.getUTCFullYear(),dt.getUTCMonth()+1,dt.getUTCDate());
    }
    var s=digits(v).trim(); if (!s) return '';
    var m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:(?:T|\s)\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
    if (m) return iso(+m[1],+m[2],+m[3]);
    m=s.match(/^(\d{1,2})[\s/.-]+(\d{1,2}|[ก-๙.]+)[\s/.-]+(\d{2}|\d{4})$/);
    if (!m) return null;
    var year=+m[3];
    // Short years 40–99 mean Thai B.E.; 00–39 are ambiguous, require four digits.
    if (m[3].length===2) { if(year<40) return null; year+=2500; }
    var month=+m[2];
    if (!month) {
      var full=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
      var short=['มค','กพ','มีค','เมย','พค','มิย','กค','สค','กย','ตค','พย','ธค'];
      var clean=m[2].replace(/\./g,''); month=full.indexOf(clean)+1; if(!month) month=short.indexOf(clean)+1;
    }
    return iso(year,month,+m[1]);
  }
  // SHA-256 over UTF-8. Same bytes in browsers and Apps Script, no name retained.
  function sha256(str) {
    var bytes=unescape(encodeURIComponent(str)), words=[], bitLen=bytes.length*8;
    for(var i=0;i<bytes.length;i++) words[i>>2]=(words[i>>2]||0)|(bytes.charCodeAt(i)<<(24-(i%4)*8));
    words[bitLen>>5]=(words[bitLen>>5]||0)|(0x80<<(24-bitLen%32));
    words[((bitLen+64>>9)<<4)+15]=bitLen;
    var h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    function rot(x,n){return x>>>n|x<<32-n;}
    for(i=0;i<words.length;i+=16){
      var w=[],a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];
      for(var t=0;t<64;t++){
        if(t<16) w[t]=words[i+t]|0; else {var x=w[t-15],y=w[t-2];w[t]=((rot(x,7)^rot(x,18)^x>>>3)+w[t-16]+(rot(y,17)^rot(y,19)^y>>>10)+w[t-7])|0;}
        var s1=rot(e,6)^rot(e,11)^rot(e,25),ch=e&f^~e&g,T1=(hh+s1+ch+k[t]+w[t])|0;
        var s0=rot(a,2)^rot(a,13)^rot(a,22),maj=a&b^a&c^b&c,T2=(s0+maj)|0;
        hh=g;g=f;f=e;e=d+T1|0;d=c;c=b;b=a;a=T1+T2|0;
      }
      var v=[a,b,c,d,e,f,g,hh];for(t=0;t<8;t++)h[t]=h[t]+v[t]|0;
    }
    return h.map(function(x){return ('00000000'+(x>>>0).toString(16)).slice(-8);}).join('').toUpperCase();
  }
  function recipient(cs,v) {
    if (!text(v)) return '';
    return String(v).split(/\s*,\s*/).filter(function(x){return text(x);}).map(function(x){
      if (/^R1-[A-F0-9]{64}$/.test(x)) return x;
      return 'R1-'+sha256('NoticePay/recipient/v1\n'+caseNo(cs)+'\n'+name(x));
    }).join(',');
  }
  function mapped(row,mapping,date1904) {
    var out={},cs=caseNo(row[mapping.case_no]);
    Object.keys(mapping).forEach(function(f){
      var col=mapping[f]; if(!col) return; var v=row[col];
      if(f==='recipient')v=recipient(cs,v);
      else if(f==='payer')v='';
      else if(/^(issued|delivered|reported)_date$/.test(f)){
        var n=date(v,date1904); if(n===null)throw new Error('วันที่ไม่ถูกต้องในคอลัมน์ '+col+' กรุณาใช้ วัน/เดือน/ปี 4 หลัก'); v=n;
      }
      out[col]=v==null?'':v;
    });
    return out;
  }
  return {date:date,recipient:recipient,mapped:mapped,sha256:sha256};
})();
if (typeof module!=='undefined' && module.exports) module.exports=NoticeImportFormat;
