importScripts('./vendor/pako-inflate-2.1.0.min.js');
self.onmessage=event=>{
 try{
  const code=event.data;
  if(typeof code!=='string'||!code.startsWith('INLAYP1-'))throw Error('Use a print link from Inlay.');
  const body=code.slice(8);
  if(!body||body.length>24000||body.length%4===1||!/^[A-Za-z0-9_-]+$/.test(body))throw Error('This print link is incomplete or too long. Make a new link in Inlay.');
  const packed=Uint8Array.from(atob(body.replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0));
  const chunks=[];let size=0;const inflater=new pako.Inflate({raw:true,chunkSize:8192});
  inflater.onData=chunk=>{size+=chunk.byteLength;if(size>=200000)throw Error('This print link is too large. Make a new link in Inlay.');chunks.push(chunk);};
  inflater.push(packed,true);
  if(inflater.err||!inflater.ended)throw Error('This print link could not be read. Make a new link in Inlay.');
  const joined=new Uint8Array(size);let at=0;for(const chunk of chunks){joined.set(chunk,at);at+=chunk.length;}
  self.postMessage({ok:true,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(joined))});
 }catch(error){self.postMessage({ok:false,message:error.message||'This print link could not be read. Make a new link in Inlay.'});}
};
