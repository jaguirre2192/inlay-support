/** Owned local/public artifact checks; never uses an authenticated user browser. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
const {chromium,webkit}=await import(process.env.INLAY_PLAYWRIGHT_MODULE||'playwright');
const root=process.cwd(),base=process.env.INLAY_PRINT_BASE||'http://127.0.0.1:63054/print/';
const fixtures=process.env.INLAY_PRINT_FIXTURES;
if(!fixtures)throw Error('Set INLAY_PRINT_FIXTURES to the actual Swift fixture folder.');
const manifest=JSON.parse(await fs.readFile(path.join(fixtures,'fixtures.json'),'utf8'));
const payload=JSON.parse(await fs.readFile(path.join(fixtures,'own-mixed.payload.json'),'utf8'));
const shared=manifest.fixtures.find(x=>x.name==='two-people-overlap');
const out=path.join(root,'.impeccable/review/functional');await fs.mkdir(out,{recursive:true});
const records=[],captures=[];const encode=o=>'INLAYP1-'+deflateRawSync(JSON.stringify(o)).toString('base64url');
const codeURL=c=>base+'#'+c;
const wait=page=>page.getByText('Proof ready.',{exact:true}).waitFor({timeout:120000});
async function capture(page,name){await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0)});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const file=path.join(out,name+'.png');await page.screenshot({path:file,fullPage:true,caret:'initial'});captures.push({file:path.relative(root,file),sha256:crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'),viewport:page.viewportSize(),scrollY:await page.evaluate(()=>scrollY)});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
async function browserCase(engine,fn){const browser=await engine.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});const page=await context.newPage();const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));try{return await fn(page,context,{errors,requests});}finally{assert.deepEqual(errors,[],'uncaught browser errors');assert(requests.every(x=>x.startsWith(new URL(base).origin)||x.startsWith('data:')||x.startsWith('blob:')),'no third-party requests');assert(requests.every(x=>!x.includes('INLAYP1-')),'no private code in request URLs');await browser.close();}}
async function record(name,fn){const start=Date.now();try{await fn();records.push({name,pass:true,ms:Date.now()-start});console.log('PASS '+name);}catch(e){records.push({name,pass:false,error:e.message});console.log('FAIL '+name+': '+e.message);throw e;}}
try{
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])await record('Swift encoder fixtures in '+name,()=>browserCase(engine,async(page,context)=>{
 for(const fixture of manifest.fixtures){await page.goto(codeURL(fixture.code));await wait(page);assert.equal(await page.evaluate(()=>location.hash),'');const summary=await page.locator('#atlas-summary').innerText();console.log('FIXTURE '+name+' '+fixture.name+': '+summary.replaceAll('\n',' / '));fixture.people.forEach(p=>{assert(summary.includes(p.name));assert(summary.includes(`${p.countries} ${p.countries===1?'country':'countries'}`));});if(fixture.name==='two-people-overlap'){assert(summary.includes('8 countries · 4 territories'));assert.equal(await page.locator('#edition-title').innerText(),'Our World');}assert.deepEqual(await page.locator('#proof').evaluate(c=>[c.width,c.height]),[3600,2400]);}
}));
await record('Names, union, proof image, private design file and restoration',()=>browserCase(chromium,async(page)=>{
 await page.goto(codeURL(shared.code));await wait(page);await page.locator('#name-0').fill('Alexandria');await page.locator('#name-1').fill('Christopher');await page.locator('#dedication').fill('Everywhere, with you.');await page.locator('#occasion-date').fill('2026-11-14');await wait(page);
 const downloadPromise=page.waitForEvent('download');await page.locator('#download-proof').click();const image=await downloadPromise;await image.saveAs(path.join(out,'our-world-proof.png'));const bytes=await fs.readFile(path.join(out,'our-world-proof.png'));assert.equal(bytes.readUInt32BE(16),3600);assert.equal(bytes.readUInt32BE(20),2400);
 const savePromise=page.waitForEvent('download');await page.locator('#save-design').click();const design=await savePromise;await design.saveAs(path.join(out,'saved-design.json'));const json=JSON.parse(await fs.readFile(path.join(out,'saved-design.json'),'utf8'));assert.equal(json.config.names[1],'Christopher');assert.equal(json.config.dedication,'Everywhere, with you.');assert.equal(json.snapshot.people.length,2);assert.deepEqual(json.config.photos,[null,null,null]);
 await page.waitForFunction(()=>document.getElementById('storage-note').textContent.startsWith('Draft saved'));await page.reload();await wait(page);assert.equal(await page.locator('#name-1').inputValue(),'Christopher');assert.equal(await page.locator('#dedication').inputValue(),'Everywhere, with you.');await capture(page,'phone-shared');
 await page.locator('#inspect summary').click();await page.locator('.proof-scroll').focus();await page.keyboard.press('End');assert(await page.locator('.proof-scroll').evaluate(x=>x.scrollLeft)>100);await capture(page,'phone-shared-inspection');
}));
await record('Country and Memory photos: invalid, add, caption, replace, remove and retain',()=>browserCase(chromium,async(page)=>{
 await page.goto(codeURL(shared.code));await wait(page);await page.getByLabel('Memory',{exact:true}).check();await page.locator('#country').selectOption('IT');await wait(page);assert.equal(await page.locator('#photo-slots img').count(),0);
 await page.locator('#photo-0').setInputFiles({name:'bad.txt',mimeType:'text/plain',buffer:Buffer.from('not an image')});await page.getByText(/Choose a JPG/).waitFor();
 const photo=process.env.INLAY_PRINT_PHOTO;if(!photo)throw Error('Set INLAY_PRINT_PHOTO to the owned synthetic JPEG fixture.');
 await page.locator('#photo-0').setInputFiles(photo);await page.getByText('Photograph added. It stays on this device.').waitFor();await page.locator('#caption-0').fill('A day to remember');await wait(page);
 await page.locator('#photo-1').setInputFiles(photo);await page.locator('#photo-slots img').nth(1).waitFor();await page.locator('#caption-1').fill('Our favourite view');await page.locator('#photo-2').setInputFiles(photo);await page.locator('#photo-slots img').nth(2).waitFor();await wait(page);await capture(page,'phone-memory');
 await page.waitForFunction(()=>document.getElementById('storage-note').textContent.startsWith('Draft saved'));await page.reload();await wait(page);assert.equal(await page.locator('#photo-slots img').count(),3);assert.equal(await page.locator('#caption-0').inputValue(),'A day to remember');await page.getByRole('button',{name:'Remove photograph',exact:true}).nth(1).click();assert.equal(await page.locator('#photo-slots img').count(),2);await wait(page);
 await page.getByLabel('Country',{exact:true}).check();await wait(page);assert.deepEqual(await page.locator('#proof').evaluate(c=>[c.width,c.height]),[2400,3200]);await capture(page,'phone-country');
}));
await record('Malformed, catalog, unknown-ID, duplicate, oversized and decompression-bomb recovery',()=>browserCase(chromium,async(page)=>{
 await page.goto(codeURL(manifest.fixtures[0].code));await wait(page);await page.locator('#dedication').fill('Keep this design');await wait(page);await page.locator('.more-atlas summary').click();
 const cases=[['wrong prefix','INLAY2-abc'],['catalog',{...payload,catalog:'ffffffffffffffff'}],['unknown ID',{...payload,people:[{...payload.people[0],ids:['ZZ']}]}],['duplicate',{...payload,people:[{...payload.people[0],ids:['IT','IT']}]}],['extra people',{...payload,people:[...payload.people,payload.people[0],payload.people[0]]}],['oversized','INLAYP1-'+'A'.repeat(24001)],['bomb',{...payload,extra:'X'.repeat(800000)}]];
 for(const [label,data] of cases){await page.locator('#second-link').fill(typeof data==='string'?data:encode(data));await page.locator('#replace-atlas').click();await page.locator('#import-error').waitFor();assert.equal(await page.locator('#dedication').inputValue(),'Keep this design',label);assert.equal(await page.locator('#name-0').inputValue(),payload.people[0].name,label);}
 await page.locator('#second-link').fill(shared.url);await page.locator('#replace-atlas').click();await wait(page);assert.equal(await page.locator('#name-1').inputValue(),'Sam Sample');await capture(page,'phone-shared-recovered');
}));
await record('Add any second person and reverse without losing the first',()=>browserCase(chromium,async(page)=>{
 await page.goto(codeURL(manifest.fixtures.find(x=>x.name==='friend-live').code));await wait(page);await page.locator('#name-0').fill('My friend');await page.locator('.more-atlas summary').click();await page.locator('#second-link').fill(manifest.fixtures.find(x=>x.name==='friend-invite').url);await page.locator('#add-atlas').click();await wait(page);assert.equal(await page.locator('#name-0').inputValue(),'My friend');assert.equal(await page.locator('#name-1').inputValue(),'Sam Sample');await page.locator('#remove-second').click();await wait(page);assert.equal(await page.locator('#name-0').inputValue(),'My friend');assert.equal(await page.locator('#name-1').count(),0);
}));
await record('No link, confirmed empty, small phone and clear/undo',()=>browserCase(chromium,async(page)=>{
 await page.setViewportSize({width:320,height:740});await page.goto(base);await page.getByText('No atlas is open yet.',{exact:false}).waitFor();await capture(page,'small-phone-start');await page.locator('#print-link').fill(manifest.fixtures.find(x=>x.name==='empty-own').url);await page.locator('#import-submit').click();await wait(page);assert((await page.locator('#atlas-summary').innerText()).includes('0 countries'));await capture(page,'small-phone-empty');await page.locator('#clear-draft').click();await page.getByText('Draft cleared from this page.',{exact:false}).waitFor();await page.locator('#clear-draft').click();await wait(page);assert.equal(await page.locator('#name-0').inputValue(),'Me');
}));
await record('Blocked storage recovers while the proof and edits remain',()=>browserCase(chromium,async(page)=>{
 await page.addInitScript(()=>{window.blockStorage=true;const open=indexedDB.open.bind(indexedDB);indexedDB.open=(...args)=>{if(window.blockStorage)throw new DOMException('Blocked','SecurityError');return open(...args);};});await page.goto(codeURL(shared.code));await wait(page);await page.locator('#dedication').fill('Still here');await page.locator('#retry-save').waitFor();await page.evaluate(()=>window.blockStorage=false);await page.locator('#retry-save').click();await page.waitForFunction(()=>document.getElementById('storage-note').textContent.startsWith('Draft saved'));assert.equal(await page.locator('#dedication').inputValue(),'Still here');
}));
await record('Artwork network failure and retry preserve edits',()=>browserCase(chromium,async(page,context)=>{
 let failed=true;await context.route('**/assets/art/**',route=>failed?route.abort():route.continue());await page.goto(codeURL(manifest.fixtures[0].code));await page.locator('#render-error').waitFor({timeout:30000});await page.locator('#dedication').fill('A kept dedication');failed=false;await page.locator('#retry-render').click();await wait(page);assert.equal(await page.locator('#dedication').inputValue(),'A kept dedication');
}));
await record('Stalled catalog then retry imports the original consumed fragment',()=>browserCase(chromium,async(page,context)=>{
 let stalled=true;await context.route('**/data/catalog.json',route=>stalled?new Promise(()=>{}):route.continue());await page.goto(codeURL(shared.code));await page.locator('#import-error').waitFor({timeout:20000});stalled=false;await page.locator('#retry-import').click();await wait(page);assert.equal(await page.locator('#name-1').inputValue(),'Sam Sample');assert.equal(await page.evaluate(()=>location.hash),'');
}));
await record('Stalled export recovers without discarding the proof',()=>browserCase(chromium,async(page)=>{
 await page.goto(codeURL(shared.code));await wait(page);await page.evaluate(()=>{window.originalToBlob=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(){};});await page.locator('#download-proof').click();await page.locator('#export-error').waitFor({timeout:15000});await page.evaluate(()=>HTMLCanvasElement.prototype.toBlob=window.originalToBlob);const promise=page.waitForEvent('download');await page.locator('#download-proof').click();await promise;assert.equal(await page.locator('#name-1').inputValue(),'Sam Sample');
}));
await record('Responsive shared proofs in desktop/tablet and WebKit',async()=>{
 for(const [name,engine,width] of [['desktop',chromium,1440],['tablet',chromium,768],['webkit-phone',webkit,390]])await browserCase(engine,async(page)=>{await page.setViewportSize({width,height:960});await page.goto(codeURL(shared.code));await wait(page);await page.locator('#dedication').fill('Everywhere, with you.');await wait(page);await capture(page,name+'-shared');});
});
}finally{await fs.writeFile(path.join(out,'functional-checks.json'),JSON.stringify({base,records,captures},null,2)+'\n');}
