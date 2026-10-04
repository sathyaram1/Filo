// #946 giro 3: un'immagine costruita apposta (testo compresso enorme, o un XMP
// ripetitivo) non deve bloccare Filo quando l'utente fa tasto destro su di lei.

import { test, expect } from '../../fixtures/electron.mjs';
import zlib from 'node:zlib';
import { pngSpoglio } from '../../helpers/immagineFirmata.mjs';

function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(tipo, dati) {
  const l = Buffer.alloc(4); l.writeUInt32BE(dati.length);
  const t = Buffer.from(tipo, 'latin1');
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, dati])));
  return Buffer.concat([l, t, dati, c]);
}
function conPezzi(...pezzi) {
  const base = pngSpoglio();
  const iend = base.length - 12;
  return Buffer.concat([base.subarray(0, iend), ...pezzi, base.subarray(iend)]);
}

const CASI = {
  // Mezzo megabyte di XMP: la ricerca dell'etichetta torna indietro su ogni occorrenza.
  'XMP ripetitivo': () => conPezzi(chunk('iTXt', Buffer.concat([
    Buffer.from('XML:com.adobe.xmp\0\0\0\0\0', 'latin1'),
    Buffer.from('DigitalSourceType '.repeat(30000), 'utf8'),
  ]))),
  // Due testi compressi da 300 KB che decompressi fanno 300 MB l'uno.
  'testo compresso enorme': () => {
    const bomba = zlib.deflateSync(Buffer.alloc(300 * 1024 * 1024, 0x41), { level: 9 });
    return conPezzi(
      chunk('zTXt', Buffer.concat([Buffer.from('a\0\0', 'latin1'), bomba])),
      chunk('zTXt', Buffer.concat([Buffer.from('b\0\0', 'latin1'), bomba])),
    );
  },
};

for (const [nome, crea] of Object.entries(CASI)) {
  test(`tasto destro su un’immagine con ${nome}: Filo resta reattivo`, async ({ app, openTab, testServer }) => {
    test.setTimeout(180_000);
    const src = testServer.asset(crea(), 'image/png');
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
      <img id="foto" src="${src}" width="160" height="160"></body></html>`);
    await page.waitForFunction(() => document.getElementById('foto').naturalWidth > 0);
    await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });

    // Il processo principale tiene finestra, schede e scorciatoie: dal clic in poi,
    // per otto secondi, deve rispondere sempre entro un secondo.
    let peggiore = 0;
    const fine = Date.now() + 8000;
    while (Date.now() < fine) {
      const t = Date.now();
      await app.evaluate(() => 1);
      peggiore = Math.max(peggiore, Date.now() - t);
      await new Promise((r) => setTimeout(r, 100));
    }
    await expect(page.locator('.sn-menu')).toBeVisible();
    expect(peggiore).toBeLessThan(1000);
  });
}

// Stessa immagine, nessun tasto destro su di lei: basta chiedere qualcosa all'Aiuto
// mentre è visibile, perché l'Aiuto legge da solo le etichette delle immagini che hai davanti.
test('una domanda qualsiasi all’Aiuto, con l’immagine ripetitiva visibile: Filo resta reattivo', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const finto = async ({ attempts }) => ({ text: JSON.stringify({ text: 'Ecco.', status: 'done' }), model: attempts[0].model, provider: attempts[0].provider, usage: {} });
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
  const src = testServer.asset(CASI['XMP ripetitivo'](), 'image/png');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px;min-height:600px">
    <img id="foto" src="${src}" width="160" height="160"><p id="testo" style="margin-top:200px">Un paragrafo qualsiasi.</p></body></html>`);
  await page.waitForFunction(() => document.getElementById('foto').naturalWidth > 0);
  await page.locator('#testo').click({ button: 'right' });
  await page.locator('.sn-menu').getByText('Aiuto', { exact: true }).click();
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8000 });
  await page.fill('.sn-sidebar-input textarea', 'riassumi la pagina');
  await page.press('.sn-sidebar-input textarea', 'Enter');

  let peggiore = 0;
  const fine = Date.now() + 8000;
  while (Date.now() < fine) {
    const t = Date.now();
    await app.evaluate(() => 1);
    peggiore = Math.max(peggiore, Date.now() - t);
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(peggiore).toBeLessThan(1000);
});
