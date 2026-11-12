// Verifica #1623.3 giro 1: una foto o un documento dati al riquadro delle segnalazioni aperto su un sito entrano negli
// allegati, e il sito che ascolta rilasci e incolla non riceve niente.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { nelMondoDiFilo, paginaDelloStrato, conta } from '../../helpers/riquadri.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const SITO = `<!doctype html><html><head><meta charset="utf-8"><title>Sito curioso</title></head>
<body style="margin:0;height:100vh;font:16px sans-serif"><p>Una pagina che ascolta.</p><script>
window.__ricevuti = [];
const nota = (e) => {
  const dt = e.dataTransfer || e.clipboardData;
  const files = dt && dt.files ? Array.from(dt.files).map((f) => f.name + ':' + f.size) : [];
  window.__ricevuti.push({ tipo: e.type, files, types: dt ? Array.from(dt.types || []) : [] });
  if (e.type !== 'paste') e.preventDefault();
};
for (const t of ['dragenter', 'dragover', 'drop', 'paste']) { window.addEventListener(t, nota, true); document.addEventListener(t, nota, true); }
</script></body></html>`;

function fileSulDisco() {
  const dir = cartellaInCasa('filo-test-1623-');
  const foto = join(dir, 'estratto conto.png');
  const doc = join(dir, 'note segrete.txt');
  writeFileSync(foto, PNG);
  writeFileSync(doc, 'IBAN segreto');
  return { foto, doc };
}

async function lascia(pagina, files, x, y) {
  const s = await pagina.context().newCDPSession(pagina);
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await s.send('Input.dispatchDragEvent', { type, x, y, data });
  await s.detach().catch(() => {});
}

async function apriSegnalazione(app, page) {
  await nelMondoDiFilo(app, page, () => { globalThis.SN_FEEDBACK_UI.open(); return true; });
  const strato = await paginaDelloStrato(app, page);
  await expect(strato.locator('.sn-fb-modal')).toBeVisible({ timeout: 10_000 });
  return strato;
}

test('foto e documento lasciati sul riquadro: entrano negli allegati, il sito non riceve niente', async ({ app, openTab, testServer }) => {
  const { foto, doc } = fileSulDisco();
  const page = await testServer.openReady(openTab, SITO);
  const strato = await apriSegnalazione(app, page);
  const box = await strato.locator('.sn-fb-modal').boundingBox();
  await lascia(strato, [foto], box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => conta(app, page, '.sn-fb-thumb'), { timeout: 10_000 }).toBe(1);
  await lascia(strato, [doc], box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => conta(app, page, '.sn-fb-file-chip'), { timeout: 10_000 }).toBe(1);
  await strato.waitForTimeout(500);
  expect(await page.evaluate(() => window.__ricevuti)).toEqual([]);
});

test('foto lasciata fuori dalla scatola, sul resto del riquadro: il sito non la riceve e la segnalazione resta', async ({ app, openTab, testServer }) => {
  const { foto } = fileSulDisco();
  const page = await testServer.openReady(openTab, SITO);
  const urlSito = page.url();
  const strato = await apriSegnalazione(app, page);
  const urlStrato = strato.url();
  await lascia(strato, [foto], 15, 15);
  await strato.waitForTimeout(800);
  expect(await page.evaluate(() => window.__ricevuti)).toEqual([]);
  expect(page.url()).toBe(urlSito);
  expect(strato.url()).toBe(urlStrato);
  await expect(strato.locator('.sn-fb-modal')).toBeVisible();
});

test('immagine incollata nella casella: entra negli allegati, il sito non riceve niente', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const strato = await apriSegnalazione(app, page);
  await strato.locator('.sn-fb-text').click();
  // Le prove hanno appunti finti nel main: l'immagine va negli appunti veri del sistema dal renderer dello strato.
  const scritto = await strato.evaluate(async (b64) => {
    try {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bin], { type: 'image/png' }) })]);
      return 'ok';
    } catch (e) { return String(e); }
  }, PNG.toString('base64'));
  console.log('scrittura appunti:', scritto);
  await strato.keyboard.press('Control+V');
  await expect.poll(() => conta(app, page, '.sn-fb-thumb'), { timeout: 10_000 }).toBe(1);
  await strato.waitForTimeout(500);
  expect(await page.evaluate(() => window.__ricevuti)).toEqual([]);
});
