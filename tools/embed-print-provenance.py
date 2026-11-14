#!/usr/bin/env python3
"""Attach origin metadata to web copies; prove every decoded pixel is unchanged."""
from pathlib import Path
import argparse,concurrent.futures,hashlib,json,subprocess
ap=argparse.ArgumentParser();ap.add_argument('--impeccable',type=Path,required=True);args=ap.parse_args()
root=Path(__file__).resolve().parents[1];ledger=json.loads((root/'tools/print-asset-ledger.json').read_text())
rows=[x for x in ledger['files'] if x['file'].startswith('print/assets/art/')]
def pixels(p):
 if p.suffix.lower()=='.webp':
  return {'byteSHA256':hashlib.sha256(p.read_bytes()).hexdigest(),'proof':'byte-identical WebP; origin is stored in a sidecar'}
 result=subprocess.run(['ffmpeg','-v','error','-i',str(p),'-frames:v','1','-pix_fmt','rgba','-f','hash','-hash','sha256','-'],capture_output=True,text=True,check=True)
 return {'rgbaSHA256':result.stdout.strip(),'proof':'FFmpeg decoded RGBA hash before and after JPEG metadata'}
def process(row):
 p=root/row['file'];before=pixels(p)
 origin=f"Existing approved Inlay illustration. Native source: {row['origin']}. Original SHA-256: {row['sha256']}. Source illustration and geographic placement unchanged; the web copy adds origin metadata only."
 result=subprocess.run([str(args.impeccable),'embed-prompt',str(p),'--prompt',origin],capture_output=True,text=True)
 if result.returncode:raise RuntimeError(row['file']+': '+result.stderr+result.stdout)
 after=pixels(p);assert before==after,row['file']
 return {'file':row['file'],'originalSHA256':row['sha256'],'shippedSHA256':hashlib.sha256(p.read_bytes()).hexdigest(),'origin':row['origin'],'pixels':after}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:verified=list(pool.map(process,rows))
(root/'tools/print-art-pixel-preservation.json').write_text(json.dumps({'policy':'metadata-only web derivatives; native originals retained','files':verified},indent=2)+'\n')
print(f'Embedded origin metadata and verified exact decoded pixels for{len(verified)} art files.')
