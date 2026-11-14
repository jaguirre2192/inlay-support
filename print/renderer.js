import {withLimit} from './storage.js';
import {totals,countLabel} from './snapshot.js';
const PAPER='#f5f0e4',INK='#22382e';
let mapCache=null;
const detailCache=new Map(),flagCache=new Map();
function check(signal){if(signal?.aborted)throw new DOMException('Cancelled','AbortError');}
async function fetchBounded(url,signal,as='blob'){
 check(signal);const controller=new AbortController();let stalled=false;const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});const timer=setTimeout(()=>{stalled=true;cancel();},12000);
 try{const response=await fetch(url,{signal:controller.signal,cache:'force-cache'});if(!response.ok)throw Error('An artwork file is unavailable.');return await response[as]();}
 catch(e){if(stalled)throw Error('The artwork did not finish loading. Check your connection and retry.');throw e;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
async function detail(id,signal){
 if(detailCache.has(id))return detailCache.get(id);
 const d=await fetchBounded('./data/'+id+'.json',signal,'json');check(signal);detailCache.set(id,d);return d;
}
async function art(name,signal){
 const blob=await fetchBounded('./assets/art/'+name,signal);check(signal);
 if(typeof createImageBitmap==='function'){
  try{return await withLimit(createImageBitmap(blob),8000,'The artwork could not be opened.');}catch(e){check(signal);if(e.name==='AbortError')throw e;}
 }
 const url=URL.createObjectURL(blob),image=new Image();image.src=url;
 try{await withLimit(image.decode(),8000,'The artwork could not be opened.');check(signal);return {image,width:image.naturalWidth,height:image.naturalHeight,close(){image.src='';URL.revokeObjectURL(url);}};}
 catch(e){URL.revokeObjectURL(url);throw e;}
}
async function flag(id,signal){
 if(flagCache.has(id))return flagCache.get(id);
 const image=new Image();image.src='./assets/flags/'+id.toLowerCase()+'.svg';
 await withLimit(image.decode(),8000,'A flag did not finish loading.');check(signal);flagCache.set(id,image);return image;
}
function countryPath(row){return new Path2D(row.d);}
async function paintCountry(ctx,row,signal){
 const d=await detail(row.id,signal),shape=countryPath(d);let bitmap=null,current='';
 ctx.save();ctx.clip(shape,'evenodd');
 try{
  for(const plate of d.plates){
   check(signal);if(current!==plate.image){bitmap?.close?.();bitmap=await art(plate.image,signal);current=plate.image;}
   ctx.save();try{if(plate.d)ctx.clip(new Path2D(plate.d),'evenodd');const [x,y,w,h]=plate.frame,[cx,cy,cw,ch]=plate.crop;ctx.drawImage(bitmap.image||bitmap,cx*bitmap.width,cy*bitmap.height,cw*bitmap.width,ch*bitmap.height,x,y,w,h);}finally{ctx.restore();}
  }
 }finally{bitmap?.close?.();ctx.restore();}
}
async function buildMap(catalog,ids,edition,country,onProgress,signal){
 const isWorld=edition==='world';const key=isWorld?'world:'+ids.join(','):edition+':'+country;
 if(mapCache?.key===key)return mapCache.canvas;
 if(!isWorld&&country==='IT'){const image=await art('approved-italy.png',signal);try{const paper=document.createElement('canvas');paper.width=1920;paper.height=2300;const c=paper.getContext('2d');c.fillStyle=PAPER;c.fillRect(0,0,1920,2300);c.drawImage(image.image||image,0,0,1920,2300);check(signal);mapCache={key,canvas:paper};return paper;}finally{image.close?.();}}
 const canvas=document.createElement('canvas');canvas.width=isWorld?3344:(edition==='country'?1920:1520);canvas.height=isWorld?1640:2200;
 const ctx=canvas.getContext('2d');ctx.fillStyle=PAPER;ctx.fillRect(0,0,canvas.width,canvas.height);
 if(!isWorld&&country==='US'){
  const row=catalog.countries.find(r=>r.id==='US'),data=await detail('US',signal);
  const panels=[{frame:row.focus,box:[40,80,canvas.width-80,1150]},{name:'Alaska',frame:data.composition.alaska,box:[40,1360,(canvas.width-120)*.6,650]},{name:'Hawaiʻi',frame:data.composition.hawaii,box:[canvas.width*.68,1470,canvas.width*.28,450]}];
  for(const panel of panels){
   const [x,y,w,h]=panel.frame,[bx,by,bw,bh]=panel.box,scale=Math.min(bw/w,bh/h)*.94;
   ctx.save();try{ctx.translate(bx+(bw-w*scale)/2,by+(bh-h*scale)/2);ctx.scale(scale,scale);ctx.translate(-x,-y);ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.fillStyle='#dedfcf';ctx.fill(countryPath(row),'evenodd');onProgress('Painting the United States…');await paintCountry(ctx,row,signal);ctx.strokeStyle='rgba(117,133,106,.35)';ctx.lineWidth=2/scale;ctx.stroke(countryPath(row));}finally{ctx.restore();}
   if(panel.name){ctx.fillStyle=INK;line(ctx,panel.name,bx+bw/2,by+bh+55,bw,44,'Instrument',true,'center');}
  }
  check(signal);mapCache={key,canvas};return canvas;
 }

 const row=catalog.countries.find(x=>x.id===country);
 const frame=isWorld?catalog.worldFrame:row.focus;
 const [x,y,w,h]=frame;const scale=Math.min(canvas.width/w,canvas.height/h)*(isWorld?1:.93);
 ctx.translate((canvas.width-w*scale)/2,(canvas.height-h*scale)/2);ctx.scale(scale,scale);ctx.translate(-x,-y);
 if(!isWorld){ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();}
 const selected=new Set(isWorld?ids:[country]);
 for(const r of catalog.countries){ctx.fillStyle='#dedfcf';ctx.strokeStyle='#b7bba8';ctx.lineWidth=isWorld?10:Math.max(2,1/scale);const shape=countryPath(r);if(isWorld||r.id===country){ctx.fill(shape,'evenodd');ctx.stroke(shape);}}
 const rows=catalog.countries.filter(r=>selected.has(r.id));let done=0;
 for(const r of rows){check(signal);onProgress(`Painting your places · ${++done} of ${rows.length}`);await paintCountry(ctx,r,signal);ctx.strokeStyle='rgba(117,133,106,.35)';ctx.lineWidth=isWorld?8:Math.max(1,1/scale);ctx.stroke(countryPath(r));}
 check(signal);mapCache={key,canvas};return canvas;
}
function font(ctx,size,family='Instrument',italic=false){ctx.font=`${italic?'italic ':''}${size}px ${family}`;}
function line(ctx,text,x,y,max,size,family='Instrument',italic=false,align='left'){
 ctx.textAlign=align;let s=size;font(ctx,s,family,italic);while(ctx.measureText(text).width>max&&s>12){s-=1;font(ctx,s,family,italic);}ctx.fillText(text,x,y);return s;
}
function captionDate(s){if(!s)return '';return new Intl.DateTimeFormat(undefined,{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(s+'T12:00:00Z'));}
function fitPhoto(ctx,img,x,y,w,h){const crop=Math.max(w/img.naturalWidth,h/img.naturalHeight);const sw=w/crop,sh=h/crop;ctx.drawImage(img,(img.naturalWidth-sw)/2,(img.naturalHeight-sh)/2,sw,sh,x,y,w,h);}
async function mountPhotos(ctx,photos,signal,italy=false){
 const positions=italy?[[780,322,2.5,290,334],[790,1068,-2,290,334],[118,1024,-3,290,334]]:[[833,344,2,260,310],[818,701,-2,260,310],[841,1058,1.5,260,310]];
 for(let n=0;n<3;n++){
  check(signal);const [x,y,angle,w,h]=positions[n],pad=italy?16:14,picH=italy?258:230;ctx.save();ctx.translate(x+w/2,y+h/2);ctx.rotate(angle*Math.PI/180);ctx.translate(-w/2,-h/2);ctx.fillStyle='#fffdf7';ctx.shadowColor='rgba(45,40,30,.17)';ctx.shadowBlur=14;ctx.shadowOffsetY=7;ctx.fillRect(0,0,w,h);ctx.shadowColor='transparent';
  if(photos[n]?.data){const img=new Image();img.src=photos[n].data;await withLimit(img.decode(),8000,'A photograph could not be opened. Remove or replace it, then retry.');check(signal);fitPhoto(ctx,img,pad,pad,w-pad*2,picH);img.src='';}
  else{ctx.fillStyle='#e8e5d9';ctx.fillRect(pad,pad,w-pad*2,picH);ctx.strokeStyle='#a1aa94';ctx.lineWidth=1.5;const ix=w/2-27,iy=pad+picH/2-21;ctx.strokeRect(ix,iy,54,42);ctx.beginPath();ctx.moveTo(ix+7,iy+34);ctx.lineTo(ix+23,iy+17);ctx.lineTo(ix+36,iy+31);ctx.lineTo(ix+45,iy+22);ctx.lineTo(ix+52,iy+33);ctx.stroke();}
  ctx.fillStyle=INK;line(ctx,photos[n]?.caption||'',w/2,italy?310:281,w-pad*2,italy?26:23,'Instrument',true,'center');ctx.restore();
 }
}
async function world(ctx,map,catalog,snapshot,names,dedication,occasionDate,onProgress,signal){
 const stats=totals(snapshot.people,catalog),shared=snapshot.people.length===2,ids=stats.ids;
 const columns=ids.length>68?50:34,rows=Math.ceil(ids.length/columns),fw=ids.length>68?24:40,fh=fw*.75;
 const mapHeight=rows>2?740:820;ctx.drawImage(map,64,66,1672,mapHeight);
 const flagStart=rows>2?834:914,rowHeight=fh+12;
 for(let r=0;r<rows;r++){
  const current=ids.slice(r*columns,(r+1)*columns),step=fw+4,total=current.length*step+4,left=(1800-total)/2;
  for(let i=0;i<current.length;i++){
   check(signal);onProgress(`Setting the flags · ${r*columns+i+1} of ${ids.length}`);const image=await flag(current[i],signal),x=left+i*step,y=flagStart+r*rowHeight;
   ctx.fillStyle='#fffdf7';ctx.shadowColor='rgba(40,32,20,.14)';ctx.shadowOffsetY=2;ctx.shadowBlur=4;ctx.fillRect(x,y,fw+8,fh+8);ctx.shadowColor='transparent';ctx.strokeStyle='rgba(34,56,46,.22)';ctx.lineWidth=.75;ctx.strokeRect(x,y,fw+8,fh+8);ctx.drawImage(image,x+4,y+4,fw,fh);
  }
 }
 ctx.fillStyle=INK;
 const denseFlags=rows>=4;
 if(shared)line(ctx,`${names[0]} · ${countLabel(stats.individual[0])}   /   ${names[1]} · ${countLabel(stats.individual[1])}   /   ${countLabel(stats.both)} visited by both`,900,denseFlags?1014:991,1500,25,'Sans',false,'center');
 const recipient=names.join(' & '),long=recipient.length>45;
 if(long&&shared){line(ctx,'Made for '+names[0],900,denseFlags?1050:1038,680,29,'Instrument',true,'center');line(ctx,'& '+names[1],900,denseFlags?1080:1069,680,29,'Instrument',true,'center');}
 else line(ctx,'Made for '+recipient,900,shared?1050:1046,680,32,'Instrument',true,'center');
 const note=[dedication,captionDate(occasionDate)].filter(Boolean).join(' · ');line(ctx,note,900,long&&shared?(denseFlags?1120:1104):1093,730,23,'Instrument',true,'center');
 line(ctx,'I N L A Y',900,1150,400,13,'Sans',false,'center');
 line(ctx,shared?'Our world':'Your world',112,1130,410,shared?76:88,'Italiana');
 const count=String(stats.combined.countries);line(ctx,count,1510,1130,190,96,'Italiana',false,'right');line(ctx,stats.combined.countries===1?'country':'countries',1530,1124,165,32,'Instrument',true);
 if(stats.combined.territories)line(ctx,`${stats.combined.territories} ${stats.combined.territories===1?'territory':'territories'}`,1688,1164,300,22,'Instrument',true,'right');
}
export async function renderProof(canvas,options){
 const {catalog,snapshot,names,edition,country,dedication,occasionDate,photos,onProgress,signal}=options;
 check(signal);onProgress('Preparing your proof…');
 await withLimit(Promise.all([document.fonts.load('32px Italiana'),document.fonts.load('32px Instrument'),document.fonts.load('italic 32px Instrument'),document.fonts.load('16px Sans')]),8000,'The print fonts did not finish loading.');check(signal);
 const stats=totals(snapshot.people,catalog);const map=await buildMap(catalog,stats.ids,edition,country,onProgress,signal);check(signal);
 const width=edition==='world'?1800:1200,height=edition==='world'?1200:1600;
 const next=document.createElement('canvas');next.width=width*2;next.height=height*2;const ctx=next.getContext('2d');ctx.scale(2,2);ctx.fillStyle=PAPER;ctx.fillRect(0,0,width,height);ctx.fillStyle=INK;
 if(edition==='world')await world(ctx,map,catalog,snapshot,names,dedication,occasionDate,onProgress,signal);
 else{
  const row=catalog.countries.find(x=>x.id===country),memory=edition==='memory';
  if(row.id==='IT'){
   if(memory){line(ctx,'Italia',100,205,1000,120,'Italiana');line(ctx,'I giorni da ricordare',104,262,900,30,'Instrument',true);ctx.drawImage(map,90,300,820,982);await mountPhotos(ctx,photos,signal,true);}
   else{ctx.drawImage(map,150,160,960,1150);line(ctx,'Italia',168,1148,600,132,'Italiana');line(ctx,'41°54′ N · 12°30′ E',174,1205,520,15,'Sans');}
  }else{line(ctx,row.name,90,180,1020,108,'Italiana');ctx.drawImage(map,memory?42:120,240,memory?760:960,1100);if(memory)await mountPhotos(ctx,photos,signal);}
  ctx.fillStyle=INK;line(ctx,'Made for '+names.join(' & '),600,1450,1020,30,'Instrument',true,'center');line(ctx,[dedication,captionDate(occasionDate)].filter(Boolean).join(' · '),600,1490,1020,23,'Instrument',true,'center');line(ctx,'I N L A Y',600,1542,500,14,'Sans',false,'center');
 }
 check(signal);canvas.width=next.width;canvas.height=next.height;canvas.getContext('2d').drawImage(next,0,0);return stats;
}
