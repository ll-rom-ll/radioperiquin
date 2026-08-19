import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=18987; const token='smoke-test-secret';
const child=spawn(process.execPath,['src/server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',RADIO_ADMIN_TOKEN:token},stdio:['ignore','pipe','pipe']});
let stderr=''; child.stderr.on('data',d=>stderr+=d);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
  let ok=false; for(let i=0;i<30;i++){await wait(100);try{const r=await fetch(`http://127.0.0.1:${port}/health`);if(r.ok){ok=true;break}}catch{}}
  if(!ok) throw new Error('Servidor no inició. '+stderr);
  const pub=await fetch(`http://127.0.0.1:${port}/api/v1/public/config`); if(!pub.ok) throw new Error('GET público falló');
  const cfg=await pub.json(); const etag=pub.headers.get('etag'); if(!etag) throw new Error('Falta ETag');
  const notModified=await fetch(`http://127.0.0.1:${port}/api/v1/public/config`,{headers:{'If-None-Match':etag}}); if(notModified.status!==304) throw new Error('ETag/304 falló');
  const admin=await fetch(`http://127.0.0.1:${port}/api/v1/admin/config`,{headers:{Authorization:`Bearer ${token}`}}); if(!admin.ok) throw new Error('Admin GET falló');
  console.log('Smoke test OK · public config v'+cfg.contentVersion+' · ETag '+etag);
} finally { child.kill('SIGTERM'); }
