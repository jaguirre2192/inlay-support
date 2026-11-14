#!/usr/bin/env python3
"""Publish exact app artwork and compact geographic data for local print proofs."""
import argparse,hashlib,json,shutil,subprocess,tarfile,io,urllib.request,base64
from pathlib import Path
ap=argparse.ArgumentParser();ap.add_argument('--native',type=Path,required=True);ap.add_argument('--approved',type=Path,required=True);args=ap.parse_args()
root=Path(__file__).resolve().parents[1];out=root/'print';native=args.native/'App/Resources'
d=json.loads((native/'atlas-countries.json').read_text());italy=json.loads((native/'atlas-geometry.json').read_text())
ledger=[]
def copy(src,dst):
 dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dst)
 digest=hashlib.sha256(dst.read_bytes()).hexdigest();assert digest==hashlib.sha256(src.read_bytes()).hexdigest()
 ledger.append({'file':str(dst.relative_to(root)),'sha256':digest,'bytes':dst.stat().st_size,'origin':str(src.relative_to(args.native)) if src.is_relative_to(args.native) else 'approved print collection/'+src.name})
def path(rings):
 return ''.join('M'+'L'.join(f'{x:g},{y:g}' for x,y in ring)+'Z' for ring in rings)
rows=[];images=set()
for r in d['countries']:
 plates=r.get('plates',[])
 if r['id']=='IT':plates=[{'image':p['name']+'.jpg','frame':p['frame'],'crop':[0,0,1,1],'rings':p['rings']} for p in italy['parts']]
 detail={'id':r['id'],'d':path(r['rings']),'plates':[{'image':p['image'],'frame':p['frame'],'crop':p.get('crop',[0,0,1,1]),**({'d':path(p['rings'])} if p.get('rings') else {})} for p in plates]}
 if r['id']=='US':
  points=[p for ring in r['rings'] if len(ring)>=16 and min(p[1] for p in ring)>6000 and max(p[0] for p in ring)<7000 for p in ring]
  xs=[p[0] for p in points];ys=[p[1] for p in points];x=min(xs);y=min(ys);w=max(xs)-x;h=max(ys)-y
  detail['composition']={'alaska':plates[1]['frame'],'hawaii':[x-w*.04,y-h*.04,w*1.08,h*1.08]}
 (out/'data'/f'{r["id"]}.json').write_text(json.dumps(detail,separators=(',',':'))+'\n')
 images.update(p['image'] for p in plates)
 # Exact native coordinates; only JSON whitespace and field names change.
 rows.append({'id':r['id'],'name':r.get('shortName',r['name']),'kind':r['kind'],'group':r['group'],'bounds':r['bounds'],'focus':r.get('focusFrame',r['bounds']),'d':detail['d']})
for name in sorted(images):
 src=native/'Countries'/name
 if not src.exists():src=native/name
 assert src.is_file(),src
 copy(src,out/'assets/art'/name)
fontsrc=args.approved/'website-shop-v1/site/assets/print-assets'
copy(fontsrc/'italy-art.png',out/'assets/art/approved-italy.png')
for name in ['Italiana-Regular.ttf','InstrumentSerif-Regular.ttf','InstrumentSerif-Italic.ttf','InstrumentSans-Regular.ttf','Italiana-OFL.txt','InstrumentSerif-OFL.txt','InstrumentSans-OFL.txt']:
 copy(fontsrc/name,out/'assets/fonts'/name)
version=hashlib.sha256(','.join(sorted(x['id'] for x in rows)).encode()).hexdigest()[:16]
(out/'data/catalog.json').write_text(json.dumps({'schema':1,'version':version,'worldFrame':[-120,700,39540,19400],'countries':rows},ensure_ascii=False,separators=(',',':'))+'\n')
# Same pinned MIT source as the approved24-flag row, expanded to the full app catalog.
commit='ac7e0eb3259eb62aa6100c435607e2fe03896a97'
url=f'https://codeload.github.com/lipis/flag-icons/tar.gz/{commit}'
archive=urllib.request.urlopen(url,timeout=40).read()
with tarfile.open(fileobj=io.BytesIO(archive),mode='r:gz') as tf:
 members={Path(x.name).name:x for x in tf.getmembers() if '/flags/4x3/' in x.name and x.name.endswith('.svg')}
 for r in rows:
  name=r['id'].lower()+'.svg';assert name in members,(r['id'],r['name'])
  payload=tf.extractfile(members[name]).read();(out/'assets/flags'/name).write_bytes(payload)
  ledger.append({'file':'print/assets/flags/'+name,'sha256':hashlib.sha256(payload).hexdigest(),'bytes':len(payload),'origin':f'https://github.com/lipis/flag-icons/tree/{commit}/flags/4x3/{name}'})
 lic=next(x for x in tf.getmembers() if x.name.endswith('/LICENSE'))
 (out/'assets/flags/LICENSE.txt').write_bytes(tf.extractfile(lic).read())
# Small pinned browser inflater, self-hosted and integrity-verified against npm.
meta=json.load(urllib.request.urlopen('https://registry.npmjs.org/pako/2.1.0',timeout=20))
packed=urllib.request.urlopen(meta['dist']['tarball'],timeout=30).read()
assert 'sha512-'+base64.b64encode(hashlib.sha512(packed).digest()).decode()==meta['dist']['integrity']
with tarfile.open(fileobj=io.BytesIO(packed),mode='r:gz') as tf:
 for src,dst in [('package/dist/pako_inflate.min.js','pako-inflate-2.1.0.min.js'),('package/LICENSE','pako-LICENSE.txt')]:
  payload=tf.extractfile(src).read();(out/'vendor'/dst).write_bytes(payload)
  ledger.append({'file':'print/vendor/'+dst,'sha256':hashlib.sha256(payload).hexdigest(),'bytes':len(payload),'origin':meta['dist']['tarball'],'integrity':meta['dist']['integrity']})
(root/'tools/print-asset-ledger.json').write_text(json.dumps({'catalog':version,'nativeCatalogSHA256':hashlib.sha256((native/'atlas-countries.json').read_bytes()).hexdigest(),'nativeSource':subprocess.check_output(['git','-C',str(args.native),'rev-parse','HEAD'],text=True).strip(),'coordinatePolicy':'exact native paths, no invented/simplified borders','flagCommit':commit,'files':ledger},indent=2)+'\n')
print(json.dumps({'catalog':version,'destinations':len(rows),'artFiles':len(images)+1,'totalArtBytes':sum((out/'assets/art'/n).stat().st_size for n in images)+(out/'assets/art/approved-italy.png').stat().st_size,'catalogBytes':(out/'data/catalog.json').stat().st_size}))
