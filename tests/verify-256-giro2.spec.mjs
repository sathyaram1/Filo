// Verifica #256, secondo giro: tema scuro davvero applicato, cronologia piena
// (il tetto è 50 voci), miniature ostili, e le due viste (pagina Sicurezza e
// menu "Incolla") che devono raccontare la stessa cronologia.

import { test, expect } from './fixtures/electron.mjs';
import { clickConfirm } from './helpers/confirm.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SVG_OSTILE = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><script>window.top.__svgxss=1</script><rect width="40" height="40" fill="red"/></svg>',
).toString('base64');

async function seed(app, entries) {
  await app.evaluate(async (_e, list) => {
    const MSG = globalThis.SN_MSG.MSG;
    for (const entry of list) {
      await globalThis.SN_HANDLE_MESSAGE(
        { type: MSG.PUSH_CLIPBOARD_ENTRY, entry },
        { url: 'https://example.com/page' },
      );
    }
  }, entries.map((e) => (typeof e === 'string' ? { type: 'text', text: e } : e)));
}

async function stored(app) {
  return app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    const res = await globalThis.SN_HANDLE_MESSAGE(
      { type: MSG.GET_CLIPBOARD_HISTORY },
      { url: 'filo://security/security.html' },
    );
    return (res.items || []).map((e) => (e.type === 'image' ? 'IMG' : e.text));
  });
}

async function setDark(app) {
  await app.evaluate(async () => {
    await globalThis.__filoStorage.set({ settings: { theme: 'dark' } });
  });
}

test('#256 tema scuro: la sezione cronologia appunti resta leggibile', async ({ app, shell, openTab }) => {
  void shell;
  await setDark(app);
  await seed(app, ['password-di-prova-scura', 'un secondo testo copiato', { type: 'image', dataUrl: PNG, description: 'schermata scura' }]);
  const page = await openTab('filo://security/');
  await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(3, { timeout: 10_000 });
  const tema = await page.evaluate(() => document.documentElement.dataset.snTheme || document.documentElement.getAttribute('data-theme') || getComputedStyle(document.body).backgroundColor);
  console.log('[#256] tema:', tema);

  // Contrasto minimo: il testo della voce non deve essere quasi il fondo.
  const col = await page.evaluate(() => {
    const t = document.querySelector('.sn-clip-text');
    const r = document.querySelector('.sn-clip-remove');
    const parse = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
    const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    const bg = parse(getComputedStyle(document.body).backgroundColor);
    return {
      bg: lum(bg),
      testo: lum(parse(getComputedStyle(t).color)),
      rimuovi: lum(parse(getComputedStyle(r).color)),
    };
  });
  console.log('[#256] luminanze scuro:', JSON.stringify(col));
  expect(Math.abs(col.testo - col.bg), 'testo della voce distinguibile dal fondo').toBeGreaterThan(0.2);
  expect(Math.abs(col.rimuovi - col.bg), '"Rimuovi" distinguibile dal fondo').toBeGreaterThan(0.1);
  await page.locator('#sec-clipboard').screenshot({ path: 'tests/.shots/256-clipboard-scuro.png' });
});

test('#256 cronologia piena (50 voci): la lista scorre, non allunga la pagina all\'infinito', async ({ app, shell, openTab }) => {
  void shell;
  const molte = [];
  for (let i = 0; i < 60; i++) molte.push(`voce numero ${i} — testo copiato ${'x'.repeat(60)}`);
  await seed(app, molte);
  const dopo = await stored(app);
  expect(dopo.length, 'il tetto della cronologia').toBeLessThanOrEqual(50);

  const page = await openTab('filo://security/');
  await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(dopo.length, { timeout: 15_000 });
  const box = await page.evaluate(() => {
    const l = document.getElementById('sec-clip-list');
    return {
      h: Math.round(l.getBoundingClientRect().height),
      scroll: l.scrollHeight > l.clientHeight,
      overflowDoc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  console.log('[#256] lista 50 voci:', JSON.stringify(box));
  expect(box.h, 'la lista non diventa una pagina infinita').toBeLessThan(420);
  expect(box.scroll, 'con 50 voci la lista scorre').toBe(true);
  expect(box.overflowDoc).toBeLessThanOrEqual(1);

  // Il tasto "Svuota cronologia" resta raggiungibile senza scorrere la lista.
  await expect(page.locator('#sec-clip-clear')).toBeVisible();
  await page.locator('#sec-clip-clear').click();
  await clickConfirm(page, 'ok');
  await expect.poll(() => stored(app)).toEqual([]);
});

test('#256 miniatura ostile: un\'immagine copiata con dentro uno script non esegue nulla', async ({ app, shell, openTab }) => {
  void shell;
  await seed(app, [{ type: 'image', dataUrl: SVG_OSTILE, description: 'finta schermata' }, 'testo normale']);
  const page = await openTab('filo://security/');
  await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(2, { timeout: 10_000 });
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__svgxss)).toBeUndefined();
  // La voce si rimuove comunque.
  await page.locator('.sn-clip-item', { hasText: 'finta schermata' }).locator('.sn-clip-remove').click();
  await expect.poll(() => stored(app)).toEqual(['testo normale']);
});

test('#256 due viste, una sola cronologia: tolgo dal menu, la pagina già aperta cosa dice?', async ({ app, shell, openTab, testServer }) => {
  void shell;
  await seed(app, ['segreto-condiviso', 'testo qualunque']);
  const pagina = await openTab('filo://security/');
  await expect(pagina.locator('#sec-clip-list .sn-clip-item')).toHaveCount(2, { timeout: 10_000 });

  const web = await testServer.openReady(
    openTab,
    '<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="4" cols="50"></textarea></body></html>',
  );
  await web.locator('#ta').click({ button: 'right' });
  await expect(web.locator('.sn-menu')).toBeVisible();
  await web.locator('.sn-menu-paste-arrow').click();
  const sub = web.locator('.sn-menu-history-sub');
  await expect(sub).toBeVisible();
  await sub.locator('.sn-menu-history-item', { hasText: 'segreto-condiviso' }).locator('.sn-menu-history-remove').click();
  await expect.poll(() => stored(app)).toEqual(['testo qualunque']);

  await pagina.waitForTimeout(1500);
  const testoPagina = await pagina.locator('#sec-clip-list').textContent();
  console.log('[#256] la pagina aperta mostra ancora la voce rimossa altrove:', testoPagina.includes('segreto-condiviso'));

  // E se dalla pagina "stantia" premo Rimuovi su una voce che non c'è più?
  const riga = pagina.locator('.sn-clip-item', { hasText: 'segreto-condiviso' });
  if (await riga.count()) {
    await riga.locator('.sn-clip-remove').click();
    await pagina.waitForTimeout(600);
    const rimaste = await pagina.locator('#sec-clip-list .sn-clip-item').count();
    console.log('[#256] dopo il rimuovi su voce fantasma, righe in pagina:', rimaste);
    expect(await stored(app), 'una rimozione fantasma non deve portare via altro').toEqual(['testo qualunque']);
  }
});
