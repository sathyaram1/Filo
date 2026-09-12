import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
const LISTA='blocked.test', NORMALE='innocuo.test';
let porta=0;
const server=createServer((req,res)=>{
  const host=String(req.headers.host||'').split(':')[0];
  const path=req.url.split('?')[0];
  const b=`http://${LISTA}:${porta}`;
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  if(host===LISTA){res.end(`<!doctype html><meta charset=utf-8><h1 id=t>LISTA</h1>`);return;}
  if(path==='/apri-login'){res.end(`<!doctype html><meta charset=utf-8><button id=b onclick="window.__r=String(window.open(document.location.search.slice(1),'_blank','width=500,height=400'))">x</button>`);return;}
  if(path==='/incorpora'){res.end(`<!doctype html><meta charset=utf-8><iframe id=f src="${b}/arrivo" style="width:100%;height:400px"></iframe>`);return;}
  res.end('<!doctype html><meta charset=utf-8><h1 id=altrove>ALTROVE</h1>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
porta=server.address().port;
const userData='/tmp/claude-0/-home-user-Filo/1ebd9f8f-839e-5f9c-8e2d-1e3c5bb87c15/scratchpad/agenti AI probe';
const app=await electron.launch({args:[`--host-resolver-rules=MAP ${LISTA} 127.0.0.1, MAP ${NORMALE} 127.0.0.1`,'.'],cwd:'/home/user/Filo',env:{...process.env,FILO_USER_DATA:userData,NODE_ENV:'test'}});
const shell=await app.firstWindow();
await shell.waitForLoadState('domcontentloaded');
await shell.evaluate((h)=>window.filoShell.message({type:'update_settings',settings:{security:{siteBlock:{enabled:true,useAdblockLists:false,blacklist:h}}}}),[LISTA]);
await shell.waitForTimeout(600);
// --- L: auth popup
await shell.evaluate(u=>window.filoShell.tabs.open(u),`http://${NORMALE}:${porta}/apri-login?http://${NORMALE}:${porta}/login`);
await shell.waitForTimeout(2000);
let p=app.windows().find(w=>{try{return new URL(w.url()).hostname===NORMALE}catch(_){return false}});
await p.waitForSelector('#b');
await p.click('#b');
console.log('ESITO window.open:', await p.evaluate(()=>window.__r));
for (let i=0;i<4;i++){await shell.waitForTimeout(700);const st=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>w.webContents.getURL()+'|'+w.getTitle()));console.log('t'+i,JSON.stringify(st));}
console.log('FINESTRE dopo window.open(/login):');
for(const w of app.windows()) console.log('  -', w.url());
const stato = await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({u:w.webContents.getURL(),t:w.getTitle()})));
console.log('BrowserWindows main-side:', JSON.stringify(stato));
// --- P: iframe
await shell.evaluate(u=>window.filoShell.tabs.open(u),`http://${NORMALE}:${porta}/incorpora`);
await shell.waitForTimeout(3000);
let q=app.windows().filter(w=>{try{return new URL(w.url()).pathname==='/incorpora'}catch(_){return false}}).pop();
console.log('FRAMES della pagina che incorpora:');
for(const f of q.frames()) console.log('  -', f.url());
const testo = await q.frames().map(f=>f).reduce(async (acc,f)=>{const a=await acc; try{a.push(await f.evaluate(()=>document.body?document.body.innerText.slice(0,40):''))}catch(e){a.push('ERR')} return a;},Promise.resolve([]));
console.log('TESTO frames:', JSON.stringify(testo));
await app.close(); server.close(); try{rmSync(userData,{recursive:true,force:true})}catch(_){}
