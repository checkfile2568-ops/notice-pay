/* Colour PNG generated from complete report data, independent of mobile scroll position. */
(function(root) {
  'use strict';
  const urls=[];
  function clear(){urls.splice(0).forEach(u=>URL.revokeObjectURL(u));}
  function wrap(ctx, value, width) {
    const out = [], text = String(value == null ? '' : value).replace(/\u00a0/g, ' ');
    for (const paragraph of text.split('\n')) {
      let line = '';
      const words = typeof Intl.Segmenter === 'function' ? Array.from(new Intl.Segmenter('th', {granularity:'word'}).segment(paragraph), x=>x.segment) : Array.from(paragraph);
      for (const word of words) {
        if (ctx.measureText(line + word).width <= width) { line += word; continue; }
        if (line.trim()) out.push(line.trim()); line = '';
        if (ctx.measureText(word).width <= width) { line = word.trimStart(); continue; }
        const letters = typeof Intl.Segmenter === 'function' ? Array.from(new Intl.Segmenter('th', {granularity:'grapheme'}).segment(word), x=>x.segment) : Array.from(word);
        for (const letter of letters) {
          if (line && ctx.measureText(line + letter).width > width) { out.push(line); line = ''; }
          line += letter;
        }
      }
      out.push(line.trim());
    }
    return out;
  }
  async function png(spec) {
    clear();
    if (document.fonts) await document.fonts.ready;
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('เบราว์เซอร์นี้ไม่รองรับการสร้างภาพ PNG');
    const widths = spec.widths, width = widths.reduce((a,b)=>a+b,0) + 64;
    const font = '18px "Noto Sans Thai", Tahoma, sans-serif', lineH = 29;
    ctx.font = font;
    const prep = values => values.map((v,i)=>wrap(ctx, typeof v === 'object' ? v.text : v, widths[i]-24));
    const headers = prep(spec.headers), headerH = Math.max(...headers.map(x=>x.length))*lineH+28;
    const rows = spec.rows.map(r=>({values:r, lines:prep(r)}));
    rows.forEach(r=>r.height=Math.max(1,...r.lines.map(x=>x.length))*lineH+24);
    // Bound bitmap dimensions on mobile; split into complete pages without omitting rows.
    const chunks = []; let chunk = [], height = 240 + headerH;
    rows.forEach(r=>{if (height+r.height>2600 && chunk.length) {chunks.push(chunk);chunk=[];height=240+headerH;} chunk.push(r);height+=r.height;});
    if (chunk.length || !chunks.length) chunks.push(chunk);
    const results=[];
    for (let page=0;page<chunks.length;page++) {
      const part = chunks[page], h = 240+headerH+part.reduce((s,r)=>s+r.height,0);
      canvas.width=width*2;canvas.height=h*2;ctx.scale(2,2);
      ctx.fillStyle='#f6faf7';ctx.fillRect(0,0,width,h);
      ctx.fillStyle='#21503a';ctx.fillRect(0,0,width,12);
      ctx.textBaseline='top';ctx.font='bold 28px "Noto Sans Thai", Tahoma, sans-serif';ctx.fillText(spec.title,32,32);
      ctx.font=font;ctx.fillStyle='#4b6657';ctx.fillText(spec.subtitle||'',32,82);
      let y=132;
      const draw=(lines, values, rowH, head)=>{
        ctx.fillStyle=head?'#2e6b4f':(values.sum?'#dceee2':'#ffffff');ctx.fillRect(32,y,width-64,rowH);
        let x=32;ctx.font=head?'bold '+font:font;
        lines.forEach((ls,i)=>{const v=values[i];ls.forEach((l,j)=>{ctx.fillStyle=head?'#ffffff':/^เกินอัตรา/.test(l)?'#a8620a':/^ต่ำกว่าอัตรา/.test(l)?'#b4232a':((v&&v.color)||'#1d3a2c');ctx.fillText(l,x+12,y+12+j*lineH);});x+=widths[i];});
        ctx.strokeStyle='#dce8df';ctx.beginPath();ctx.moveTo(32,y+rowH);ctx.lineTo(width-32,y+rowH);ctx.stroke();y+=rowH;
      };
      draw(headers,spec.headers,headerH,true);part.forEach(r=>draw(r.lines,r.values,r.height,false));
      ctx.font='15px "Noto Sans Thai", Tahoma, sans-serif';ctx.fillStyle='#4b6657';
      wrap(ctx,spec.note||'',width-64).slice(0,2).forEach((line,i)=>ctx.fillText(line,32,y+20+i*23));
      ctx.fillText('หน้า '+(page+1)+' / '+chunks.length+' · ศาลจังหวัดลพบุรี',32,h-32);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      if(!blob)throw new Error('สร้าง PNG ไม่สำเร็จ กรุณาลองอีกครั้ง');
      const u=URL.createObjectURL(blob),a=document.createElement('a');urls.push(u);a.href=u;a.download=spec.filename+(chunks.length>1?'-'+(page+1):'')+'.png';a.textContent='ดาวน์โหลด PNG'+(chunks.length>1?' หน้า '+(page+1):'');a.className='btn btn-sm';
      // Keep visible links for browsers which allow only one automatic download.
      if(spec.links)spec.links.appendChild(a);a.click();results.push({url:u,name:a.download});
    }
    return results;
  }
  root.NP_EXPORT={png:png,wrap:wrap,clear:clear};
  if(typeof module!=='undefined')module.exports={wrap:wrap};
})(typeof window==='undefined'?this:window);
