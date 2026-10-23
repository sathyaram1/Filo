// #1623 giro 3: le immagini date all'Aiuto restano fra l'utente e Filo, il rilascio che la pagina non prende va
// all'Aiuto anche quando il dragover la pagina l'aveva accettato, e il messaggio di sole immagini entra nel filo.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { nelMondoDiFilo } from '../../helpers/riquadri.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
function foto(nome) {
  const p = join(cartellaInCasa('filo-test-giro3-'), nome);
  writeFileSync(p, PNG);
  return [p];
}
async function lascia(page, files, { x = 200, y = 200 } = {}) {
  const s = await page.context().newCDPSession(page);
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await s.send('Input.dispatchDragEvent', { type, x, y, data });
  await s.detach().catch(() => {});
}
const allegati = (app, page) => nelMondoDiFilo(app, page, () => (globalThis.__filoSidebarTest?.allegati?.() || []).map((a) => a.nome));

test('r1 un’immagine lasciata sul pannello dell’Aiuto o incollata nella sua casella entra, e il sito non la legge', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;height:100vh">x
    <script>
      window.visti = [];
      window.addEventListener('drop', (e) => { for (const f of e.dataTransfer.files) window.visti.push('rilascio ' + f.name); }, true);
      window.addEventListener('paste', (e) => { for (const it of e.clipboardData.items) if (it.getAsFile()) window.visti.push('incolla ' + it.type); }, true);
    </script></body></html>`);
  await nelMondoDiFilo(app, page, () => { globalThis.SN_SIDEBAR.open(); return 1; });
  await page.waitForSelector('.sn-sidebar-input textarea');
  const p = await nelMondoDiFilo(app, page, () => {
    const b = document.querySelector('.sn-sidebar').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 3 };
  });
  await lascia(page, foto('sul pannello.png'), p);
  await expect.poll(() => allegati(app, page), { timeout: 8_000 }).toEqual(['sul pannello.png']);

  await app.evaluate(async ({ clipboard, ClipboardItem }, b64) => {
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' }) })]);
  }, PNG.toString('base64'));
  const t = await nelMondoDiFilo(app, page, () => {
    const b = document.querySelector('.sn-sidebar-input textarea').getBoundingClientRect();
    return { x: b.x + 20, y: b.y + 10 };
  });
  await page.mouse.click(t.x, t.y);
  await page.keyboard.press('Control+V');
  await expect.poll(async () => (await allegati(app, page)).length, { timeout: 8_000 }).toBe(2);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.visti)).toEqual([]);
});

test('r2 una pagina che accetta il trascinamento ovunque ma il rilascio non lo prende: l’immagine va all’Aiuto', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;height:100vh">
    <div id="zona" style="position:fixed;left:0;top:0;width:100px;height:100px;background:#eee">Carica qui</div>
    <script>
      document.addEventListener('dragover', (e) => e.preventDefault());
      zona.addEventListener('drop', (e) => e.preventDefault());
    </script></body></html>`);
  await lascia(page, foto('fuori dalla zona.png'), { x: 400, y: 400 });
  await expect.poll(() => allegati(app, page), { timeout: 8_000 }).toEqual(['fuori dalla zona.png']);
});

test('r3 un messaggio all’Aiuto di sole immagini entra nel filo come messaggio dell’utente', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;height:100vh">x</body></html>');
  await nelMondoDiFilo(app, page, () => {
    globalThis.__nelFilo = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => {
      if (m && m.type === globalThis.SN_MSG.MSG.FILO_CONVERSAZIONE_APP) globalThis.__nelFilo.push(...m.messaggi.map((x) => x.role));
      if (m && m.type === globalThis.SN_MSG.MSG.AI_REQUEST && m.action === globalThis.SN_CONST.ACTIONS.HELP) {
        return Promise.resolve({ ok: true, text: '{"text":"È un quadratino.","status":"done"}' });
      }
      return orig(m, ...r);
    };
    return 1;
  });
  await lascia(page, foto('da sola.png'));
  await expect.poll(() => allegati(app, page), { timeout: 8_000 }).toEqual(['da sola.png']);
  await page.keyboard.press('Enter');
  await expect.poll(() => nelMondoDiFilo(app, page, () => globalThis.__nelFilo), { timeout: 10_000 }).toContain('filo');
  expect(await nelMondoDiFilo(app, page, () => globalThis.__nelFilo)).toEqual(['user', 'filo']);
});
