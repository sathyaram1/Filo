// Esplorazione del giro 16: quali richieste comuni producono la domanda «permesso che Filo non conosce».
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROVE = {
  wake: `navigator.wakeLock.request('screen').then(()=>'ok',e=>'err:'+e.name)`,
  persist: `navigator.storage.persist().then(String,e=>'err:'+e.name)`,
  sensori: `new Promise(r=>{try{const s=new Accelerometer();s.onerror=e=>r('err:'+e.error.name);s.onreading=()=>r('ok');s.start();setTimeout(()=>r('timeout'),1500)}catch(e){r('throw:'+e.name)}})`,
  midi: `navigator.requestMIDIAccess().then(()=>'ok',e=>'err:'+e.name)`,
  idle: `IdleDetector.requestPermission().then(String,e=>'err:'+e.name)`,
  schermi: `window.getScreenDetails().then(()=>'ok',e=>'err:'+e.name)`,
  font: `window.queryLocalFonts().then(f=>'n:'+f.length,e=>'err:'+e.name)`,
  storageAccess: `document.requestStorageAccess().then(()=>'ok',e=>'err:'+e.name)`,
  casse: `navigator.mediaDevices.selectAudioOutput().then(()=>'ok',e=>'err:'+e.name)`,
  appunti: `navigator.clipboard.readText().then(t=>'ok:'+t.length,e=>'err:'+e.name)`,
  mks: `navigator.requestMediaKeySystemAccess('org.w3.clearkey',[{initDataTypes:['cenc'],videoCapabilities:[{contentType:'video/mp4; codecs="avc1.42E01E"'}]}]).then(()=>'ok',e=>'err:'+e.name)`,
  bgsync: `navigator.permissions.query({name:'background-sync'}).then(s=>s.state,e=>'err:'+e.name)`,
  payment: `navigator.permissions.query({name:'payment-handler'}).then(s=>s.state,e=>'err:'+e.name)`,
  ppsync: `navigator.permissions.query({name:'periodic-background-sync'}).then(s=>s.state,e=>'err:'+e.name)`,
  qnotif: `navigator.permissions.query({name:'notifications'}).then(s=>s.state,e=>'err:'+e.name)`,
  qcam: `navigator.permissions.query({name:'camera'}).then(s=>s.state,e=>'err:'+e.name)`,
  qgeo: `navigator.permissions.query({name:'geolocation'}).then(s=>s.state,e=>'err:'+e.name)`,
  qclip: `navigator.permissions.query({name:'clipboard-read'}).then(s=>s.state,e=>'err:'+e.name)`,
  nperm: `Promise.resolve(Notification.permission)`,
};

const PAGINA = `<!doctype html><html><head><title>Esplora</title></head><body>
${Object.keys(PROVE).map((k) => `<button id="b-${k}" style="display:block">${k}</button>`).join('\n')}
<script>
const P = {${Object.entries(PROVE).map(([k, v]) => `${JSON.stringify(k)}: () => ${v}`).join(',\n')}};
window.__esiti = {};
for (const k of Object.keys(P)) document.getElementById('b-' + k).onclick = () => {
  window.__esiti[k] = 'attesa';
  try { P[k]().then((r) => { window.__esiti[k] = r; }, (e) => { window.__esiti[k] = 'rej:' + e; }); } catch (e) { window.__esiti[k] = 'throw:' + e.name; }
};
</script></body></html>`;

test('esplora', async ({ shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, PAGINA);
  const righe = [];
  for (const k of Object.keys(PROVE)) {
    await page.locator('#b-' + k).click();
    await sleep(1500);
    const barra = await shell.evaluate(() => (document.querySelector('#perm-bar') || {}).innerText || '');
    const esito = await page.evaluate((x) => window.__esiti[x], k);
    righe.push(`${k}: esito=${esito} | barra=${barra.replace(/\s+/g, ' ').slice(0, 160)}`);
    // via la domanda, se c'è
    await shell.evaluate(() => { const b = document.querySelector('#perm-bar .perm-chiudi'); if (b) b.click(); });
    await sleep(300);
  }
  console.log('\n' + righe.join('\n'));
  expect(righe.length).toBeGreaterThan(0);
});
