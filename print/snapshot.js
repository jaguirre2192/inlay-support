export class PrintError extends Error { constructor(code,message){super(message);this.code=code;} }
export const PREFIX='INLAYP1-';
const SOURCES=new Set(['own','friend-invite','friend-live']);
const keysOnly=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
const count=s=>typeof Intl.Segmenter==='function'?[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(s)].length:Array.from(s).length;
const date=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(s)&&Number.isFinite(Date.parse(s));
export function validDisplayName(s){return typeof s==='string'&&Boolean(s.trim())&&count(s)<=40&&!/[\u0000-\u001f\u007f]/.test(s);}
export function extractCode(value){
 const s=String(value||'').trim();
 if(s.startsWith(PREFIX))return s;
 try{const u=new URL(s);if(u.protocol==='https:'||u.protocol==='http:')return u.hash.slice(1);}catch{}
 throw new PrintError('invalid','Paste the full print link from Inlay, or its INLAYP1 code.');
}
export function validateSnapshot(value,catalog){
 if(!keysOnly(value,['schema','purpose','snapshotID','createdAt','catalog','policy','people'])||value.schema!==1||value.purpose!=='print'||value.policy!=='countries+territories')throw new PrintError('version','This link uses a different print format. Make a new print link in the latest Inlay app.');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.snapshotID)||!date(value.createdAt))throw new PrintError('invalid','This print link is incomplete. Open Inlay and make a new one.');
 if(value.catalog!==catalog.version)throw new PrintError('catalog','This atlas uses a different destination list. Make a new print link in the latest Inlay app. Your current design is still here.');
 if(!Array.isArray(value.people)||value.people.length<1||value.people.length>2)throw new PrintError('invalid','A print needs one or two atlases. Make a new print link in Inlay.');
 const known=new Set(catalog.countries.map(x=>x.id));
 for(const p of value.people){
  if(!keysOnly(p,['name','ids','source','updatedAt'])||!validDisplayName(p.name)||!SOURCES.has(p.source)||!date(p.updatedAt)||!Array.isArray(p.ids)||p.ids.length>=1000||p.ids.some(id=>typeof id!=='string'||!/^[A-Za-z0-9-]{1,8}$/.test(id)))throw new PrintError('invalid','Part of this atlas is unreadable. Make a new print link in Inlay. Your current design is still here.');
  if(new Set(p.ids).size!==p.ids.length)throw new PrintError('invalid','This link repeats a destination. Make a new print link in Inlay.');
  if(p.ids.some(id=>!known.has(id)))throw new PrintError('place','This atlas includes a destination this site does not recognize. Make a new link in the latest Inlay app. Nothing was dropped from your atlas.');
 }
 return structuredClone(value);
}
export function totals(people,catalog){
 const byID=new Map(catalog.countries.map(x=>[x.id,x]));
 const counts=ids=>({countries:[...ids].filter(id=>byID.get(id)?.kind==='country').length,territories:[...ids].filter(id=>byID.get(id)?.kind==='territory').length});
 const sets=people.map(p=>new Set(p.ids));const union=new Set(sets.flatMap(x=>[...x]));
 const both=sets.length===2?new Set([...sets[0]].filter(id=>sets[1].has(id))):new Set();
 return {individual:sets.map(counts),combined:counts(union),both:counts(both),ids:[...union].sort()};
}
export function countLabel(c){return `${c.countries} ${c.countries===1?'country':'countries'}`+(c.territories?` · ${c.territories} ${c.territories===1?'territory':'territories'}`:'');}
