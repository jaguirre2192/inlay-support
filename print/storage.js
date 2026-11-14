const withLimit=(promise,ms,message)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(message)),ms);promise.then(v=>{clearTimeout(timer);resolve(v)},e=>{clearTimeout(timer);reject(e)});});
let dbPromise;
function db(){
 if(!dbPromise)dbPromise=withLimit(new Promise((resolve,reject)=>{
  const req=indexedDB.open('inlay-print-studio',1);
  req.onupgradeneeded=()=>req.result.createObjectStore('drafts');
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(Error('Browser storage is busy.'));
 }),2500,'Browser storage did not respond.').catch(e=>{dbPromise=null;throw e;});
 return dbPromise;
}
export async function readDraft(){const database=await db();return withLimit(new Promise((resolve,reject)=>{const req=database.transaction('drafts').objectStore('drafts').get('current');req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);}),2500,'The saved draft did not respond.');}
export async function saveDraft(value){const database=await db();return withLimit(new Promise((resolve,reject)=>{const tx=database.transaction('drafts','readwrite');const store=tx.objectStore('drafts');value?store.put(value,'current'):store.delete('current');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('The draft was not saved.'));}),3000,'The draft could not be saved in time.');}
export {withLimit};
