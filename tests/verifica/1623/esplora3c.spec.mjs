// Esplorazione del giro 3 di #1623: si cancella prima della consegna.
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { nelMondoDiFilo } from '../../helpers/riquadri.mjs';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
function foto(nome) { const dir = cartellaInCasa('filo-test-esplora-'); const p = join(dir, nome); writeFileSync(p, PNG); return [p]; }
async function lascia(page, files, { x = 200, y = 200, fasi = ['dragEnter', 'dragOver', 'drop'] } = {}) {
  const s = await page.context().newCDPSession(page);
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of fasi) await s.send('Input.dispatchDragEvent', { type, x, y, data });
  await s.detach().catch(() => {});
}
test('G il sito legge le immagini date all’Aiuto?', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;height:100vh">x
    <script>window.visti=[];
    window.addEventListener('drop',(e)=>{for(const f of e.dataTransfer.files) f.arrayBuffer().then((b)=>window.visti.push('drop:'+f.name+':'+b.byteLength));},true);
    window.addEventListener('paste',(e)=>{for(const it of e.clipboardData.items){const f=it.getAsFile(); if(f) f.arrayBuffer().then((b)=>window.visti.push('paste:'+f.type+':'+b.byteLength));}},true);
    </script></body></html>`);
  await lascia(page, foto('pagina.png'), { x: 100, y: 100 });
  await page.waitForTimeout(1500);
  const r = await nelMondoDiFilo(app, page, () => { const el = document.querySelector('.sn-sidebar'); const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 3, n: globalThis.__filoSidebarTest.allegati().length }; });
  console.log('G-dopo-pagina', JSON.stringify(r), JSON.stringify(await page.evaluate(() => window.visti)));
  await lascia(page, foto('pannello.png'), { x: r.x, y: r.y });
  await page.waitForTimeout(1500);
  console.log('G-dopo-pannello', await nelMondoDiFilo(app, page, () => globalThis.__filoSidebarTest.allegati().map((a) => a.nome).join(',')), JSON.stringify(await page.evaluate(() => window.visti)));
  await app.evaluate(async ({ clipboard, ClipboardItem }, b64) => { await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' }) })]); }, PNG.toString('base64'));
  const t = await nelMondoDiFilo(app, page, () => { const b = document.querySelector('.sn-sidebar-input textarea').getBoundingClientRect(); return { x: b.x + 20, y: b.y + 10 }; });
  await page.mouse.click(t.x, t.y);
  await page.keyboard.press('Control+V');
  await page.waitForTimeout(1500);
  console.log('G-dopo-incolla', await nelMondoDiFilo(app, page, () => globalThis.__filoSidebarTest.allegati().length), JSON.stringify(await page.evaluate(() => window.visti)));
});
