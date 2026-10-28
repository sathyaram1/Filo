// #1246, #867.1 — le azioni sulla pagina stanno nella barra laterale, non nel menu del tasto destro: agiscono sulla
// scheda davanti, si riordinano trascinandole, si mettono da parte in «Altro…», e ogni spostamento è un cambio
// del filo che «rimetti come prima» annulla senza toccare gli altri.

import { test, expect } from './fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { barraPage, statoBarra, comandaBarra, pannelloFermo, premiNellaBarra } from './helpers/barra.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { home, modelloFinto, ripristina, chiedi } from './helpers/chatFinta.mjs';

const PAGINA = (titolo) => `<!doctype html><html><head><title>${titolo}</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif;height:1200px"><h1>${titolo}</h1><p id="p">Clic destro qui.</p></body></html>`;
const PAGINA_DI_PRIMA = ['translate', 'screenshot', 'share', 'saveForLater', 'qrCode', 'newTab'];

const salvate = (app) => app.evaluate(async () => {
  const r = await globalThis.chrome.storage.local.get('savedPages');
  return (r.savedPages || []).map((p) => p.url);
});
// Dalla porta del registro, non dal posto dove tiene i cambi: quel posto è già cambiato una volta (#1561).
const registro = (app) => app.evaluate(async () => {
  await globalThis.SN_REGISTRO_CAMBI.attesa();
  return globalThis.SN_REGISTRO_CAMBI.lista();
});
const ordine = (barra) => barra.$$eval('#nav .ico[data-id]', (els) => els.map((e) => e.dataset.id));

// Trascina l'icona `id` col mouse vero della vista della barra fino a `y` (px della vista).
async function trascina(barra, id, y) {
  const b = await barra.locator(`#nav .ico[data-id="${id}"]`).boundingBox();
  await barra.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await barra.mouse.down();
  await barra.mouse.move(b.x + b.width / 2 + 2, b.y + b.height / 2 - 6, { steps: 3 });
  await barra.mouse.move(b.x + b.width / 2, y, { steps: 8 });
  await barra.mouse.up();
}

test('le azioni della fila sono nella barra e agiscono sulla scheda davanti; il menu del tasto destro non le ha più', async ({ app, openTab, testServer }) => {
  const dietro = await testServer.openReady(openTab, PAGINA('Dietro'));
  const davanti = await testServer.openReady(openTab, PAGINA('Davanti'));

  await davanti.locator('#p').click({ button: 'right' });
  const menu = menuDi(davanti);
  await expect(menu.locator('.sn-menu').first()).toBeVisible();
  await expect(menu.locator('[data-sn-icon-id]')).toHaveCount(0);
  await expect(menu.locator('.sn-menu-item', { hasText: /^Salva per dopo$|^Screenshot$|^QR code della pagina$/ })).toHaveCount(0);
  await davanti.keyboard.press('Escape');

  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  for (const id of PAGINA_DI_PRIMA) {
    await expect(barra.locator(`#nav .ico[data-id="${id}"]:not(.riserva)`), id).toBeVisible();
  }
  // Il resto aspetta in «Altro…»: chiuso non si vede, la freccia lo apre.
  await expect(barra.locator('#nav .ico[data-id="screenshotCrop"]')).toHaveCount(0);
  await barra.locator('#nav [data-altro]').click();
  await expect(barra.locator('#nav .ico.riserva[data-id="screenshotCrop"]')).toBeVisible();
  await expect(barra.locator('#nav [data-altro]')).toHaveAttribute('aria-expanded', 'true');

  await barra.locator('#nav .ico[data-id="saveForLater"]').click();
  await expect.poll(() => salvate(app), { timeout: 10_000 }).toContain(davanti.url());
  expect(await salvate(app)).not.toContain(dietro.url());
});

test('Screenshot e Color picker dalla barra arrivano agli appunti: la pagina non ha avuto il clic, la barra sì', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA('Appunti'));
  await app.evaluate(({ clipboard }) => clipboard.clear());
  await premiNellaBarra(app, 'screenshot');
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.has('image/png')), { timeout: 15_000 }).toBe(true);

  // Il contagocce lo apre la barra, che il gesto l'ha avuto; alla pagina arriva solo il colore. Qui quello di sistema
  // non si può guidare: lo sostituisce uno che sceglie subito.
  const barra = await barraPage(app);
  await barra.evaluate(() => { window.EyeDropper = class { open() { return Promise.resolve({ sRGBHex: '#12ab34' }); } }; });
  await premiNellaBarra(app, 'colorPicker');
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 10_000 }).toBe('#12AB34');
  // Rinunciare non fa niente.
  await app.evaluate(({ clipboard }) => clipboard.writeText('prima'));
  await barra.evaluate(() => { window.EyeDropper = class { open() { return Promise.reject(new DOMException('no', 'AbortError')); } }; });
  await premiNellaBarra(app, 'colorPicker');
  await new Promise((r) => setTimeout(r, 800));
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('prima');
});

test('trascinandole si riordinano, sul cassetto vanno in «Altro…», e col tasto destro tornano in vista', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA('Riordino'));
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);

  // Il QR sopra Indietro.
  const back = await barra.locator('#nav .ico[data-id="back"]').boundingBox();
  await trascina(barra, 'qrCode', back.y + 4);
  await expect.poll(async () => (await statoBarra(app)).bar.slice(0, 3)).toEqual(['help', 'qrCode', 'back']);
  await expect.poll(async () => (await ordine(barra)).slice(0, 3)).toEqual(['help', 'qrCode', 'back']);

  // «Condividi» sulla freccia di «Altro…»: esce dalle icone in vista e sta fra quelle da parte.
  const cassetto = await barra.locator('#nav [data-altro]').boundingBox();
  await trascina(barra, 'share', cassetto.y + cassetto.height - 3);
  await expect.poll(async () => (await statoBarra(app)).secondary).toContain('share');
  expect((await statoBarra(app)).bar).not.toContain('share');
  await expect(barra.locator('#nav .ico[data-id="share"]')).toHaveCount(0);

  // Riaperto «Altro…», il tasto destro la riporta in vista, in fondo. Il menu a comparsa è una finestra sua: la
  // scelta si fa dal main, con le voci che quel menu mostrerebbe.
  await barra.locator('#nav [data-altro]').click();
  await app.evaluate(({ BrowserWindow }) => {
    const b = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.barra;
    const vero = b._apriMenu.bind(b);
    globalThis.__vociBarra = new Promise((res) => {
      b._apriMenu = (voci, x, y, scegli) => { b._apriMenu = vero; res(voci.map((v) => v.label)); scegli('barra:in-vista'); };
    });
  });
  await barra.locator('#nav .ico.riserva[data-id="share"]').click({ button: 'right' });
  expect(await app.evaluate(() => globalThis.__vociBarra)).toContain('Porta fra le icone in vista');
  await expect.poll(async () => (await statoBarra(app)).bar.at(-1)).toBe('share');

  // Sul disco c'è quello che si vede, senza più la riga del tasto destro.
  const salvato = await app.evaluate(async () => (await globalThis.chrome.storage.local.get('sn_icon_layout')).sn_icon_layout);
  expect(salvato.bar.slice(0, 3)).toEqual(['help', 'qrCode', 'back']);
  expect(salvato.bar.at(-1)).toBe('share');
  expect(salvato.primary).toBeUndefined();
});

test('dopo un riordino «rimetti come prima» in chat rimette la disposizione di prima e non tocca gli altri cambi', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Rimesso.' }]);
  // Un altro cambio, prima: deve restare.
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  const prima = (await statoBarra(app)).bar;

  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const back = await barra.locator('#nav .ico[data-id="back"]').boundingBox();
  await trascina(barra, 'home', back.y + 4);
  await expect.poll(async () => (await statoBarra(app)).bar.slice(0, 3)).toEqual(['help', 'home', 'back']);
  const mossa = (await registro(app)).filter((e) => e.tipo === 'icone').pop();
  expect(mossa).toMatchObject({ via: 'interfaccia', dove: 'barra' });
  await comandaBarra(app, 'chiudi');

  // Il modello finto fa quello che farebbe uno vero: legge i CAMBI RECENTI e annulla l'ultimo, quello delle icone.
  await app.evaluate(() => {
    const finto = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (o) => {
      const testo = o.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      globalThis.__visto = testo;
      const m = testo.match(/dalla barra laterale\] (c[0-9a-f]{10}): icona «[^»]+» nella barra laterale/);
      const r = await finto(o);
      if (!m || globalThis.__annullato) return r;
      globalThis.__annullato = true;
      const calls = [{ id: 'u1', name: 'ANNULLA_CAMBIO', arguments: JSON.stringify({ id: m[1] }) }];
      for (const c of calls) { try { o.onToolCall && o.onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      return { ...r, toolCalls: calls, finishReason: 'tool_calls' };
    };
  });
  await chiedi(page, 'rimetti come prima');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Rimesso.' })).toBeVisible({ timeout: 10_000 });
  expect(await app.evaluate(() => globalThis.__visto)).toMatch(/icona «[^»]+» nella barra laterale: 5° posto → 2° posto/);

  await expect.poll(async () => (await statoBarra(app)).bar).toEqual(prima);
  expect((await app.evaluate(async () => globalThis.SN_STORAGE.getSettings())).theme).toBe('dark');
  const annullo = (await registro(app)).filter((e) => e.tipo === 'icone').pop();
  expect(annullo.annulla).toBe(mossa.id);
  await ripristina(app);
});

// #1343 — le azioni le esegue Filo dentro la pagina: dove non c'è si spengono dicendo perché, come l'Aiuto; dove non ha
// il fuoco (il visore PDF) o sta ancora arrivando fanno lo stesso quello che dicono; l'indirizzo è quello vero del sito.
const DALLE_PREFERENZE = { tab: { id: 5, url: 'filo://preferences/preferences.html' }, url: 'filo://preferences/preferences.html' };
const naviga = (app, u) => app.evaluate(({ BrowserWindow }, url) => {
  const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
  tm.navigate(tm.activeId, url);
}, u);
const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
async function iconaInVista(app, id) {
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const ico = barra.locator(`#nav .ico[data-id="${id}"]`);
  if (!(await ico.count())) await barra.locator('#nav [data-altro]').click();
  return ico;
}
async function condivisa(app, voluto, timeout = 6000) {
  await app.evaluate(({ clipboard }) => clipboard.writeText('niente'));
  const share = await iconaInVista(app, 'share');
  await expect(share).not.toHaveAttribute('aria-disabled', 'true');
  await share.click();
  await expect.poll(() => appunti(app), { timeout }).toBe(voluto);
}

test('dove Filo è spento o la pagina è di Filo le azioni si spengono dicendo perché; sul PDF e sull\'errore funzionano', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA('Spento'));
  await app.evaluate(async (_e, a) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { blocklist: [a.host] } }, a.da),
    { host: new URL(page.url()).hostname, da: DALLE_PREFERENZE });
  for (const id of ['share', 'screenshot', 'qrCode']) {
    const ico = await iconaInVista(app, id);
    await expect(ico, id).toHaveAttribute('aria-disabled', 'true', { timeout: 8000 });
    await expect(ico, id).toHaveAttribute('data-sugg', 'Filo è spento su questo sito');
  }
  await app.evaluate(async (_e, da) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { blocklist: [] } }, da), DALLE_PREFERENZE);

  // Il visore PDF tiene il fuoco: gli appunti li scrive Filo, non la pagina.
  const pdf = testServer.asset(readFileSync('tests/fixtures/documenti/documento-con-testo.pdf'), 'application/pdf');
  await naviga(app, pdf);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    return !!tm.tabs.find((t) => t.id === tm.activeId).aiuto;
  }), { timeout: 10_000 }).toBe(true);
  await condivisa(app, pdf);
  await app.evaluate(({ clipboard }) => clipboard.clear());
  await (await iconaInVista(app, 'screenshot')).click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.has('image/png')), { timeout: 15_000 }).toBe(true);

  // Il sito che non risponde: si condivide il sito, non la pagina d'errore di Filo.
  const irraggiungibile = 'http://127.0.0.1:9/irraggiungibile';
  await naviga(app, irraggiungibile);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return !!t.aiuto && /^filo:\/\/error\//.test(t.view.webContents.getURL());
  }), { timeout: 10_000 }).toBe(true);
  await condivisa(app, irraggiungibile);

  // La home non ha un indirizzo da dare a qualcuno.
  await naviga(app, 'filo://newtab/');
  const share = await iconaInVista(app, 'share');
  await expect(share).toHaveAttribute('aria-disabled', 'true', { timeout: 8000 });
  await expect(share).toHaveAttribute('data-sugg', 'Questa pagina di Filo non ha un indirizzo da condividere');
  await expect(await iconaInVista(app, 'screenshot')).not.toHaveAttribute('aria-disabled', 'true');
});

test('Condividi premuto su una pagina che sta ancora arrivando aspetta la pagina e copia il suo indirizzo', async ({ app, openTab, testServer }) => {
  const lento = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.write('<!doctype html><title>Lenta</title><h1>Arriva…</h1>' + ' '.repeat(4096));
    setTimeout(() => res.end('<p>finita</p>'), 5000);
  });
  await new Promise((r) => lento.listen(0, '127.0.0.1', r));
  try {
    await testServer.openReady(openTab, PAGINA('Prima'));
    const url = `http://127.0.0.1:${lento.address().port}/lenta`;
    await naviga(app, url);
    await new Promise((r) => setTimeout(r, 1000));
    await condivisa(app, url, 12_000);
  } finally {
    lento.close();
  }
});

test('con «Altro…» aperto Opzioni Filo e Impostazioni hanno disegni diversi: fanno cose diverse a poche icone di distanza', async ({ app }) => {
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#nav [data-altro]').click();
  const opzioni = barra.locator('#nav .ico[data-id="openOptions"] svg');
  await expect(opzioni).toBeVisible();
  expect(await opzioni.innerHTML()).not.toBe(await barra.locator('[data-comando="settings"] svg').innerHTML());
});
