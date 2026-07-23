import { test, expect } from './fixtures/electron.mjs';
import { createServer as createNetServer, connect as netConnect } from 'node:net';
async function startSocks5() {
  const server = createNetServer((socket) => {
    socket.on('error', () => {});
    socket.once('data', (g) => { if (g[0]!==0x05){socket.end();return;} socket.write(Buffer.from([0x05,0x00]));
      socket.once('data', (req)=>{ const atyp=req[3]; let host,port;
        if(atyp===0x01){host=`${req[4]}.${req[5]}.${req[6]}.${req[7]}`;port=req.readUInt16BE(8);}
        else if(atyp===0x03){const len=req[4];host=req.subarray(5,5+len).toString('utf8');port=req.readUInt16BE(5+len);}
        else{socket.end();return;}
        const up=netConnect(port,atyp===0x03?'127.0.0.1':host,()=>{socket.write(Buffer.from([0x05,0x00,0x00,0x01,0,0,0,0,0,0]));socket.pipe(up);up.pipe(socket);});
        up.on('error',()=>{try{socket.destroy();}catch(_){}}); });});
  });
  await new Promise((r)=>server.listen(0,'127.0.0.1',r));
  return { port: server.address().port, async close(){await new Promise(r=>server.close(r));} };
}
async function rightClickTab(shell){ await shell.evaluate(()=>{const el=document.querySelector('.tab.active')||document.querySelector('.tab');const r=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:Math.round(r.left+r.width/2),clientY:Math.round(r.top+r.height/2)}));});}
async function hasWin(app, needle){ for (const w of app.windows()){ try{ const h=await w.evaluate((n)=>!!document.body&&document.body.innerText.includes(n),needle); if(h)return true;}catch(_){} } return false; }
async function clickWin(app, needle, label){ for (const w of app.windows()){ try{ const c=await w.evaluate(({n,l})=>{ if(!document.body||!document.body.innerText.includes(n))return false; const b=[...document.querySelectorAll('button.item')].find(x=>new RegExp(l).test(x.textContent)); if(!b)return false; b.click(); return true;},{n:needle,l:label}); if(c)return true;}catch(_){} } return false; }
test('diag popupB lifetime after proxy', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60000);
  const socks = await startSocks5();
  const url = testServer.html('<title>D</title><h1 id="ok">p</h1>');
  const page = await openTab(url); await page.waitForSelector('#ok');
  await app.evaluate(async (_e,cfg)=>{await globalThis.SN_STORAGE.updateSettings({proxy:{datacenter:cfg.endpoint,bypass:'<-loopback>'}});},{endpoint:`socks5://127.0.0.1:${socks.port}`});
  // proxy col default
  await rightClickTab(shell);
  await expect.poll(()=>hasWin(app,'Apri da un altro paese'),{timeout:8000}).toBe(true);
  await clickWin(app,'Apri da un altro paese','Apri da un altro paese');
  await expect(shell.locator('.tab .proxy-ind .cc')).toHaveText('US',{timeout:10000});
  // popup B
  await rightClickTab(shell);
  await expect.poll(()=>hasWin(app,'Cambia paese'),{timeout:8000}).toBe(true);
  const foundAt = Date.now();
  // Ora SENZA polling: aspetta senza toccare, poi verifica vita a intervalli
  const checks=[];
  for (const delay of [0,50,100,150,200,300,500,800]) {
    await new Promise(r=>setTimeout(r,delay - (checks.length?[0,50,100,150,200,300,500,800][checks.length-1]:0)));
    checks.push(`${delay}ms:${await hasWin(app,'Cambia paese')?'ALIVE':'DEAD'}`);
  }
  console.log('POPUPB '+checks.join(' '));
  await socks.close();
});
