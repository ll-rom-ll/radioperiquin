import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const storage=fs.mkdtempSync(path.join(os.tmpdir(),'rp-cloud-smoke-'));
const port=18987; const token='smoke-test-secret';
const child=spawn(process.execPath,['src/server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',RADIO_ADMIN_TOKEN:token,RADIO_STORAGE_ROOT:storage},stdio:['ignore','pipe','pipe']});
let stderr=''; child.stderr.on('data',d=>stderr+=d);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const headers={Authorization:`Bearer ${token}`};
try{
  let ok=false; for(let i=0;i<40;i++){await wait(100);try{const r=await fetch(`http://127.0.0.1:${port}/health`);if(r.ok){const h=await r.json();if(h.version!=='0.3.0')throw new Error('Health no reporta v0.3.0');ok=true;break}}catch{}}
  if(!ok) throw new Error('Servidor no inició. '+stderr);
  const pub=await fetch(`http://127.0.0.1:${port}/api/v1/public/config`); if(!pub.ok) throw new Error('GET público falló');
  const cfg=await pub.json(); const etag=pub.headers.get('etag'); if(!etag) throw new Error('Falta ETag');
  const notModified=await fetch(`http://127.0.0.1:${port}/api/v1/public/config`,{headers:{'If-None-Match':etag}}); if(notModified.status!==304) throw new Error('ETag/304 falló');
  const admin=await fetch(`http://127.0.0.1:${port}/api/v1/admin/config`,{headers}); if(!admin.ok) throw new Error('Admin GET falló');
  const current=await admin.json();
  const update={...current,home:{...current.home,currentProgram:'Smoke Test Especial'}};
  const published=await fetch(`http://127.0.0.1:${port}/api/v1/admin/config`,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(update)}); if(!published.ok) throw new Error('Publicación falló');
  const publishedBody=await published.json(); const newVersion=publishedBody.config.contentVersion;
  if(newVersion!==Number(current.contentVersion)+1) throw new Error('contentVersion no incrementó');
  const history=await fetch(`http://127.0.0.1:${port}/api/v1/admin/history`,{headers}); if(!history.ok) throw new Error('Historial falló');
  const historyBody=await history.json(); if(!historyBody.history.some(x=>x.contentVersion===Number(current.contentVersion))) throw new Error('No se guardó versión anterior');
  const old=await fetch(`http://127.0.0.1:${port}/api/v1/admin/history/${current.contentVersion}`,{headers}); if(!old.ok) throw new Error('Lectura de versión histórica falló');
  const mediaBody=Buffer.from('fake-png-smoke');
  const uploaded=await fetch(`http://127.0.0.1:${port}/api/v1/admin/media?filename=smoke.png`,{method:'POST',headers:{...headers,'Content-Type':'image/png'},body:mediaBody}); if(!uploaded.ok) throw new Error('Upload media falló');
  const media=await fetch(`http://127.0.0.1:${port}/api/v1/admin/media`,{headers}); if(!media.ok) throw new Error('Listado media falló');
  const mediaJson=await media.json(); if(!mediaJson.media.length) throw new Error('Biblioteca media vacía');
  const restored=await fetch(`http://127.0.0.1:${port}/api/v1/admin/restore/${current.contentVersion}`,{method:'POST',headers}); if(!restored.ok) throw new Error('Restauración falló');
  const restoreJson=await restored.json(); if(restoreJson.config.contentVersion!==newVersion+1) throw new Error('Restauración no creó versión nueva');
  console.log(`Smoke test OK · config v${cfg.contentVersion} · history/media/restore OK`);
} finally {
  child.kill('SIGTERM');
  fs.rmSync(storage,{recursive:true,force:true});
}
