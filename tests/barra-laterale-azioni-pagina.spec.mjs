// #1246, #867.1 — le azioni sulla pagina stanno nella barra laterale, non nel menu del tasto destro: agiscono sulla
// scheda davanti, si riordinano trascinandole, si mettono da parte in «Altro…», e ogni spostamento è un cambio
// del filo che «rimetti come prima» annulla senza toccare gli altri.

import { test, expect } from './fixtures/electron.mjs';
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
const registro = (app) => app.evaluate(async () => {
  await globalThis.SN_REGISTRO_CAMBI.attesa();
  const r = await globalThis.chrome.storage.local.get('filo_cambi');
  return r.filo_cambi || [];
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

  // Riaperto «Altro…», il tasto destro la riporta in vista, in fondo.
  await barra.locator('#nav [data-altro]').click();
  await barra.locator('#nav .ico.riserva[data-id="share"]').click({ button: 'right' });
  const scelta = app.evaluate(({ BrowserWindow }) => new Promise((res) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const b = w._filoTabs.barra;
    const prima = b._apriMenu.bind(b);
    b._apriMenu = (voci, x, y, scegli) => { b._apriMenu = prima; res(voci.map((v) => v.label)); scegli('barra:in-vista'); };
  }));
  // Il menu è già stato chiesto dal clic: si rifà, con la scelta intercettata.
  await barra.locator('#nav .ico.riserva[data-id="share"]').click({ button: 'right' });
  expect(await scelta).toContain('Porta fra le icone in vista');
  await expect.poll(async () => (await statoBarra(app)).bar.at(-1)).toBe('share');

  // Dopo un riavvio della barra resta tutto dov'è: lo legge dal disco.
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
