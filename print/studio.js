import {validateSnapshot,extractCode,totals,countLabel,PrintError,validDisplayName} from './snapshot.js';
import {readDraft,saveDraft,withLimit} from './storage.js';
import {renderProof} from './renderer.js';
const $=id=>document.getElementById(id);
const DEFAULT={edition:'world',country:'',names:[],dedication:'',occasionDate:'',frame:'oak',photos:[null,null,null]};
let saveVersion=0,shareCode='',copyGeneration=0;
let catalog=null,state=null,undo=null,renderTimer,saveTimer,renderController,renderTicket=0,decodeTicket=0,lastCode='',lastImportMode='replace',working=false;
const photoJobs=[0,0,0];
const setStatus=(id,text)=>{$(id).textContent=text;$(id).hidden=!text;};
const message=e=>e?.name==='AbortError'?'The operation was cancelled. Try again.':e?.message||'Something interrupted this step. Try again; your design is still here.';
async function loadCatalog(){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
 try{const response=await fetch('./data/catalog.json',{signal:controller.signal});if(!response.ok)throw Error('The destination list is unavailable.');const value=await response.json();if(value.schema!==1||value.countries.length!==249)throw Error('The destination list could not be read.');catalog=value;return value;}
 catch(e){throw Error('The destination list did not finish loading. Check your connection and try again.');}
 finally{clearTimeout(timer);}
}
let catalogPromise=loadCatalog();catalogPromise.catch(()=>{});
async function ensureCatalog(){if(catalog)return;if(!catalogPromise)catalogPromise=loadCatalog();try{await catalogPromise;}catch(e){catalogPromise=null;throw e;}}
function decode(code){return new Promise((resolve,reject)=>{
 let worker;try{worker=new Worker('./decode-worker.js');}catch{reject(Error('This browser could not open the print link. Try Safari or another current browser.'));return;}
 const timer=setTimeout(()=>{worker.terminate();reject(Error('Reading the atlas took too long. Try again, or make a new print link in Inlay.'));},3000);
 const finish=()=>{clearTimeout(timer);worker.terminate();};
 worker.onmessage=event=>{finish();event.data.ok?resolve(event.data.value):reject(new PrintError('invalid',event.data.message));};
 worker.onerror=()=>{finish();reject(Error('The print reader did not load. Check your connection and try again.'));};worker.postMessage(code);
});}
function cleanConfiguration(c){
 if(!c||!['world','country','memory'].includes(c.edition)||!['oak','walnut','none'].includes(c.frame)||!Array.isArray(c.names)||c.names.length>2||c.names.some(x=>!validDisplayName(x))||typeof c.dedication!=='string'||c.dedication.length>100||typeof c.occasionDate!=='string'||(c.occasionDate&&!/^\d{4}-\d\d-\d\d$/.test(c.occasionDate))||!Array.isArray(c.photos)||c.photos.length!==3)throw Error('This saved design could not be read. Open a print link from Inlay instead.');
 for(const p of c.photos)if(p&&(!p.data?.startsWith('data:image/jpeg;base64,')||p.data.length>3000000||typeof p.caption!=='string'||p.caption.length>40))throw Error('A photo in this design could not be read.');
 if(c.occasionDate){const date=new Date(c.occasionDate+'T12:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==c.occasionDate)throw Error('The date in this design is incomplete. Choose another saved design.');}
 return structuredClone(c);
}
function validateDraft(d){if(!d||d.format!=='inlay-proof-1')throw Error('This is not an Inlay proof design. Choose a design saved from this page.');const snapshot=validateSnapshot(d.snapshot,catalog),config=cleanConfiguration(d.config);if(config.names.length!==snapshot.people.length||config.names.some(x=>!x.trim()))throw Error('The names in this saved design are incomplete.');if(config.country&&!catalog.countries.some(x=>x.id===config.country))throw Error('This design has an unknown destination.');return {format:'inlay-proof-1',snapshot,config,savedAt:d.savedAt};}
async function importValue(value,mode='replace'){
 const ticket=++decodeTicket;$('retry-import').hidden=false;$('edit-link').hidden=false;$('choose-design').hidden=true;lastCode=value;lastImportMode=mode;working=true;$('save-design').disabled=true;renderController?.abort();clearTimeout(renderTimer);renderTicket++;$('download-proof').disabled=true;setStatus('render-status','Reading the incoming atlas…');$('import-submit').disabled=true;$('add-atlas').disabled=true;$('replace-atlas').disabled=true;$('import-error').hidden=true;setStatus('import-status','Reading your atlas…');
 try{
  await ensureCatalog();
  const raw=await decode(extractCode(value));const snapshot=validateSnapshot(raw,catalog);if(ticket!==decodeTicket)return;
  if(mode==='add'&&state){
   if(snapshot.people.length!==1)throw Error('Add a link with one person’s atlas. To use both people in this new link, choose Replace this atlas.');
   const old=state.snapshot.people[0];state.snapshot.people=[old,snapshot.people[0]];state.config.names=[state.config.names[0],snapshot.people[0].name];
  }else{
   photoJobs.forEach((_,n)=>photoJobs[n]++);const oldConfig=state?.config;state={format:'inlay-proof-1',snapshot,config:{...structuredClone(DEFAULT),names:snapshot.people.map(x=>x.name)}};
   if(oldConfig){for(const k of ['edition','country','dedication','occasionDate','frame'])state.config[k]=oldConfig[k];}
  }
  const all=totals(state.snapshot.people,catalog).ids;state.config.country=all.includes(state.config.country)?state.config.country:(all.find(id=>catalog.countries.find(x=>x.id===id).kind==='country')||all[0]||catalog.countries[0].id);
  shareCode=mode==='add'?'':extractCode(value);$('print-link').value='';$('second-link').value='';$('import-panel').hidden=true;showEditor();scheduleSave();scheduleRender();
  setStatus('import-status',all.length?'Your atlas is here. Make it yours.':'Your atlas is empty. Your World will show the world in quiet outlines. You can also choose a Country or Memory proof.');
 }catch(e){if(ticket===decodeTicket){$('import-error-message').textContent=message(e);$('import-error').hidden=false;setStatus('import-status','');$('import-panel').hidden=!state;if(state){showEditor();scheduleRender();}}}
 finally{if(ticket===decodeTicket){working=false;$('save-design').disabled=false;$('import-submit').disabled=false;$('add-atlas').disabled=false;$('replace-atlas').disabled=false;}}
}
function showEditor(){
 $('studio-grid').hidden=false;$('clear-draft').disabled=false;copyGeneration++;$('copy-atlas-link').hidden=!shareCode;$('copy-atlas-link').disabled=false;$('copy-atlas-status').textContent='';$('copy-atlas-fallback').hidden=true;$('original-atlas-link').value='';document.body.dataset.edition=state.config.edition;document.querySelector(`[name=edition][value=${state.config.edition}]`).checked=true;document.querySelector(`[name=frame][value=${state.config.frame}]`).checked=true;$('frame').dataset.frame=state.config.frame;
 $('dedication').value=state.config.dedication;$('occasion-date').value=state.config.occasionDate;
 const select=$('country');select.replaceChildren();const visited=new Set(totals(state.snapshot.people,catalog).ids);const sorted=[...catalog.countries].sort((a,b)=>a.name.localeCompare(b.name));
 for(const r of sorted){const option=document.createElement('option');option.value=r.id;option.textContent=r.name+(r.kind==='territory'?' · territory':'')+(visited.has(r.id)?' · in this atlas':'');select.append(option);}select.value=state.config.country;
 $('name-fields').replaceChildren();state.config.names.forEach((name,n)=>{const field=document.createElement('div');field.className='field';const label=document.createElement('label');label.htmlFor='name-'+n;label.textContent=state.config.names.length===2?(n===0?'First person’s name':'Second person’s name'):'Made for';const input=document.createElement('input');input.id='name-'+n;input.maxLength=40;input.autocomplete='off';input.value=name;input.required=true;input.addEventListener('input',()=>{state.config.names[n]=input.value;input.setCustomValidity(input.value.trim()?'':'Enter a name for the proof.');refreshSummary();changed();});field.append(label,input);$('name-fields').append(field);});
 refreshSummary();refreshEdition();refreshPhotos();$('remove-second').hidden=state.snapshot.people.length!==2;$('add-atlas').textContent=state.snapshot.people.length===2?'Replace the second person':'Add a second person';
}
function refreshSummary(){
 const stats=totals(state.snapshot.people,catalog),wrap=$('atlas-summary');wrap.replaceChildren();
 const pair=(name,label,className='')=>{const row=document.createElement('div');row.className='atlas-person '+className;const strong=document.createElement('strong');strong.textContent=name;const span=document.createElement('span');span.textContent=label;row.append(strong,span);wrap.append(row);};
 state.snapshot.people.forEach((p,n)=>{pair(state.config.names[n]||'Name needed',countLabel(stats.individual[n]));if(p.source!=='own'){const text=document.createElement('p');text.className='atlas-freshness';text.textContent='Shared with you · updated '+new Date(p.updatedAt).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});wrap.append(text);}});
 if(stats.individual.length===2){pair('Both visited',countLabel(stats.both),'atlas-combined');pair('Combined atlas',countLabel(stats.combined));}
 $('places').replaceChildren();for(const kind of ['country','territory']){const rows=catalog.countries.filter(r=>r.kind===kind&&stats.ids.includes(r.id)).sort((a,b)=>a.name.localeCompare(b.name));if(!rows.length)continue;const h=document.createElement('h3');h.textContent=kind==='country'?'Countries':'Territories';const ul=document.createElement('ul');rows.forEach(r=>{const li=document.createElement('li');li.textContent=r.name;ul.append(li);});$('places').append(h,ul);}
 if(!stats.ids.length){const p=document.createElement('p');p.className='small';p.textContent='No countries or territories in this imported atlas.';$('places').append(p);}
}
function refreshEdition(){
 const edition=state.config.edition,shared=state.snapshot.people.length===2;
 document.body.dataset.edition=edition;$('country-field').hidden=edition==='world';$('photo-editor').hidden=edition!=='memory';
 $('edition-title').textContent=edition==='world'?(shared?'Our World':'Your World'):edition==='country'?'Country':'Memory';
 $('edition-description').textContent=edition==='world'?(shared?'Two people. One illustrated world. Your individual counts, every shared place, and the world your atlases make.':'Your places, illustrated. A personal atlas with a flag for every destination.'):edition==='country'?'One place, its own art. Choose a country or territory from the atlas.':'The place, and your part in it. Your own photographs, kept beside the illustrated map.';
}
function refreshPhotos(){
 $('photo-slots').replaceChildren();
 for(let n=0;n<3;n++){
  const slot=document.createElement('div');slot.className='photo-slot';const h=document.createElement('h3');h.textContent='Photograph '+(n+1);slot.append(h);
  if(state.config.photos[n]?.data){const img=document.createElement('img');img.src=state.config.photos[n].data;img.alt='Your selected photograph '+(n+1);slot.append(img);}
  const label=document.createElement('label');label.htmlFor='photo-'+n;label.textContent=state.config.photos[n]?'Replace photograph':'Choose photograph';const file=document.createElement('input');file.type='file';file.id='photo-'+n;file.accept='image/jpeg,image/png,image/webp,image/heic,image/heif';file.addEventListener('change',()=>{if(file.files[0])addPhoto(n,file.files[0]);});slot.append(label,file);
  const captionLabel=document.createElement('label');captionLabel.htmlFor='caption-'+n;captionLabel.textContent='Caption (optional)';const caption=document.createElement('input');caption.id='caption-'+n;caption.className='photo-caption';caption.maxLength=40;caption.disabled=!state.config.photos[n];caption.value=state.config.photos[n]?.caption||'';caption.addEventListener('input',()=>{if(state.config.photos[n])state.config.photos[n].caption=caption.value;changed();});slot.append(captionLabel,caption);
  const remove=document.createElement('button');remove.type='button';remove.className='text-button';remove.textContent='Remove photograph';remove.hidden=!state.config.photos[n];remove.addEventListener('click',()=>{photoJobs[n]++;state.config.photos[n]=null;refreshPhotos();changed();});slot.append(remove);
  const status=document.createElement('p');status.id='photo-status-'+n;status.className='photo-status';status.role='status';slot.append(status);$('photo-slots').append(slot);
 }
}
async function addPhoto(n,file){
 const job=++photoJobs[n];let url;
 const status=text=>{const el=$('photo-status-'+n);if(el)el.textContent=text;};status('Opening your photograph…');
 try{
  if(file.size>24000000||!(/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)||/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)))throw Error('Choose a JPG, PNG, WebP or supported HEIC photograph under24MB.');
  url=URL.createObjectURL(file);const image=new Image();image.src=url;await withLimit(image.decode(),10000,'This photograph did not open in time. Choose it again or try another picture.');
  if(image.naturalWidth*image.naturalHeight>80000000||!image.naturalWidth)throw Error('This photograph is too large to open here. Choose a smaller copy.');
  const scale=Math.min(1,1800/Math.max(image.naturalWidth,image.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
  const data=canvas.toDataURL('image/jpeg',.88);if(data.length>3000000)throw Error('This photograph is too large for a saved proof. Choose a smaller copy.');if(job!==photoJobs[n])return;
  state.config.photos[n]={data,caption:$('caption-'+n)?.value||''};refreshPhotos();changed();status('Photograph added. It stays on this device.');
 }catch(e){if(job===photoJobs[n]){status(/heic|heif/i.test(file.type)&&e.name==='EncodingError'?'This browser cannot open that HEIC picture. Choose a JPG copy instead.':message(e));$('photo-status-'+n)?.classList.add('error-text');}}
 finally{if(url)URL.revokeObjectURL(url);}
}
function changed(){setStatus('export-status','');$('export-error').hidden=true;scheduleSave();scheduleRender();}
function scheduleSave(){saveVersion++;$('storage-note').textContent='Saving the draft on this device…';$('retry-save').hidden=true;clearTimeout(saveTimer);saveTimer=setTimeout(store,450);}
async function store(){
 if(!state)return;const current=state,version=saveVersion;
 try{current.savedAt=new Date().toISOString();await saveDraft(structuredClone(current));if(state===current&&saveVersion===version){$('storage-note').textContent='Draft saved on this device. Clear it whenever you like.';$('retry-save').hidden=true;}}
 catch{if(state===current&&saveVersion===version){$('storage-note').textContent='This browser could not save the draft. You can keep editing and download your proof or save the design file.';$('retry-save').hidden=false;}}
}
function scheduleRender(){clearTimeout(renderTimer);renderController?.abort();$('download-proof').disabled=true;setStatus('render-status','Preparing your proof…');renderTimer=setTimeout(render,140);}
async function render(){
 if(!state)return;const ticket=++renderTicket;renderController=new AbortController();const signal=renderController.signal;$('render-error').hidden=true;$('download-proof').disabled=true;
 if(state.config.names.some(x=>!x.trim())){setStatus('render-status','Enter a name to complete the proof.');return;}
 try{
  await renderProof($('proof'),{catalog,snapshot:state.snapshot,...structuredClone(state.config),onProgress:text=>{if(ticket===renderTicket)setStatus('render-status',text);},signal});
  if(signal.aborted||ticket!==renderTicket)return;const detail=$('detail-proof');detail.width=$('proof').width;detail.height=$('proof').height;detail.getContext('2d').drawImage($('proof'),0,0);$('proof').setAttribute('aria-label',`${$('edition-title').textContent} proof made for ${state.config.names.join(' and ')}. ${countLabel(totals(state.snapshot.people,catalog).combined)}.`);setStatus('render-status','Proof ready.');$('download-proof').disabled=false;
 }catch(e){if(signal.aborted||ticket!==renderTicket)return;$('render-error-message').textContent=message(e);$('render-error').hidden=false;setStatus('render-status','The proof is waiting for its artwork. Your edits are still here.');}
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
$('import-form').addEventListener('submit',event=>{event.preventDefault();importValue($('print-link').value);});
$('retry-import').addEventListener('click',()=>importValue(lastCode,lastImportMode));$('edit-link').addEventListener('click',()=>{$('import-panel').hidden=false;$('print-link').focus();});
$('add-atlas').addEventListener('click',()=>importValue($('second-link').value,'add'));$('replace-atlas').addEventListener('click',()=>importValue($('second-link').value));
$('copy-atlas-link').addEventListener('click',async()=>{
 const code=shareCode;if(!code)return;const generation=++copyGeneration,url='https://inlayatlas.com/print/#'+code;$('copy-atlas-link').disabled=true;$('copy-atlas-status').textContent='Copying the atlas link…';$('copy-atlas-fallback').hidden=true;
 try{if(!navigator.clipboard?.writeText)throw Error('Copy unavailable');await withLimit(navigator.clipboard.writeText(url),2500,'Copy did not respond');if(generation===copyGeneration&&shareCode===code)$('copy-atlas-status').textContent='Atlas link copied. Open the other friend’s print from Inlay, then paste this link to add the first person.';}
 catch{if(generation===copyGeneration&&shareCode===code){$('original-atlas-link').value=url;$('copy-atlas-fallback').hidden=false;$('copy-atlas-status').textContent='Copy the link below, then open the other atlas from Inlay. Your current design is still here.';$('original-atlas-link').focus();$('original-atlas-link').select();}}
 finally{if(generation===copyGeneration)$('copy-atlas-link').disabled=false;}
});
$('remove-second').addEventListener('click',()=>{shareCode='';state.snapshot.people=state.snapshot.people.slice(0,1);state.config.names=state.config.names.slice(0,1);showEditor();changed();});
for(const input of document.querySelectorAll('[name=edition]'))input.addEventListener('change',()=>{state.config.edition=input.value;refreshEdition();changed();});
for(const input of document.querySelectorAll('[name=frame]'))input.addEventListener('change',()=>{state.config.frame=input.value;$('frame').dataset.frame=input.value;scheduleSave();});
$('country').addEventListener('change',()=>{state.config.country=$('country').value;changed();});$('dedication').addEventListener('input',()=>{state.config.dedication=$('dedication').value;changed();});$('occasion-date').addEventListener('input',()=>{state.config.occasionDate=$('occasion-date').value;changed();});
$('retry-render').addEventListener('click',()=>scheduleRender());$('retry-save').addEventListener('click',store);
$('download-proof').addEventListener('click',async()=>{
 $('download-proof').disabled=true;$('export-error').hidden=true;setStatus('export-status','Preparing the proof image…');
 try{const blob=await withLimit(new Promise((resolve,reject)=>$('proof').toBlob(b=>b?resolve(b):reject(Error('The proof image could not be prepared. Try again.')),'image/png')),10000,'The proof image did not finish. Try downloading it again.');download(blob,'Inlay-'+$('edition-title').textContent.replaceAll(' ','-')+'-proof.png');setStatus('export-status','Proof image prepared. Save or share it from your browser. No order has been placed.');}
 catch(e){setStatus('export-status','');setStatus('export-error',message(e));}
 finally{$('download-proof').disabled=false;}
});
$('save-design').addEventListener('click',()=>{try{if(state.config.names.some(x=>!x.trim()))throw Error('Enter a name before saving the design.');download(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),'Inlay-print-design.json');setStatus('export-status','Design file prepared. It includes the atlas and any photographs you selected. Keep it somewhere private.');}catch(e){setStatus('export-error',message(e));}});
async function restoreDesign(event){
 const file=event.target.files[0];if(!file)return;const ticket=++decodeTicket;renderController?.abort();clearTimeout(renderTimer);renderTicket++;$('download-proof').disabled=true;$('save-design').disabled=true;setStatus('import-status','Opening your saved design…');
 try{
  if(file.size>12000000)throw Error('Choose an Inlay design file under12MB.');await ensureCatalog();const value=JSON.parse(await withLimit(file.text(),8000,'The design file did not open in time. Choose it again.'));const checked=validateDraft(value);
  for(const photo of checked.config.photos){if(!photo)continue;const img=new Image();img.src=photo.data;try{await withLimit(img.decode(),8000,'A photograph in this design could not be opened. Choose another saved design.');}finally{img.src='';}}
  if(ticket!==decodeTicket)return;photoJobs.forEach((_,n)=>photoJobs[n]++);state=checked;shareCode='';showEditor();changed();$('import-panel').hidden=true;$('import-error').hidden=true;setStatus('import-status','Your saved design is here.');
 }catch(e){if(ticket===decodeTicket){$('import-error-message').textContent=e instanceof SyntaxError?'This file is not a readable Inlay design. Choose another saved design.':e.name==='EncodingError'?'A photograph in this design could not be read. Choose another saved design.':message(e);$('retry-import').hidden=true;$('edit-link').hidden=true;$('choose-design').hidden=false;$('import-error').hidden=false;setStatus('import-status','');if(state)scheduleRender();}}
 finally{event.target.value='';if(ticket===decodeTicket){$('save-design').disabled=false;$('import-submit').disabled=false;$('add-atlas').disabled=false;$('replace-atlas').disabled=false;}}
}
$('choose-design').addEventListener('click',()=>{const input=state?$('design-file'):$('initial-design-file');input.closest('details').open=true;input.click();});
$('design-file').addEventListener('change',restoreDesign);$('initial-design-file').addEventListener('change',restoreDesign);
$('clear-draft').addEventListener('click',async()=>{
 if(!state&&undo){state=undo;undo=null;$('clear-draft').textContent='Clear draft';showEditor();$('import-panel').hidden=true;changed();setStatus('import-status','Draft restored.');return;}
 if(!state)return;undo=state;state=null;shareCode='';copyGeneration++;saveVersion++;decodeTicket++;$('import-submit').disabled=false;$('add-atlas').disabled=false;$('replace-atlas').disabled=false;$('save-design').disabled=false;photoJobs.forEach((_,n)=>photoJobs[n]++);renderController?.abort();clearTimeout(renderTimer);clearTimeout(saveTimer);$('studio-grid').hidden=true;$('import-panel').hidden=false;$('import-error').hidden=true;$('clear-draft').textContent='Undo clear';setStatus('import-status','Draft cleared from this page. Undo restores it until you leave.');try{await saveDraft(null);}catch{setStatus('import-status','Draft cleared from this page, but browser storage did not respond. Retry clearing it before leaving.');state=undo;undo=null;$('clear-draft').textContent='Clear draft';showEditor();}
});
document.querySelector('.proof-scroll').addEventListener('keydown',event=>{const el=event.currentTarget;let left;if(event.key==='ArrowRight')left=el.scrollLeft+120;else if(event.key==='ArrowLeft')left=el.scrollLeft-120;else if(event.key==='Home')left=0;else if(event.key==='End')left=el.scrollWidth;else return;event.preventDefault();el.scrollTo({left,behavior:'instant'});});
window.addEventListener('hashchange',()=>{const code=location.hash.slice(1);if(!code)return;history.replaceState(null,'',location.pathname+location.search);importValue(code);});
async function start(){
 const incoming=window.inlayIncomingPrint;delete window.inlayIncomingPrint;
 if(incoming){lastCode=incoming;setStatus('import-status','Reading your atlas…');}
 try{await catalogPromise;}catch(e){catalogPromise=null;if(incoming){$('import-error-message').textContent=message(e);$('import-error').hidden=false;}setStatus('import-status',incoming?'':message(e));return;}
 try{const saved=await readDraft();if(saved)state=validateDraft(saved);}
 catch{$('storage-note').textContent='Browser storage is unavailable. You can still open an atlas and download a proof.';}
 if(incoming){await importValue(incoming);return;}
 if(state){showEditor();$('import-panel').hidden=true;setStatus('import-status','Your saved draft is here.');scheduleRender();return;}
 setStatus('import-status','No atlas is open yet. Paste a print link from Inlay to begin.');
}
start().catch(e=>setStatus('import-status',message(e)));

