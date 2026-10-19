// Verifica #869 giro 3: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { mkdirSync } from 'node:fs';

mkdirSync('tests/.shots', { recursive: true });

const alle = (giorniFa, ore, minuti = 0) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - giorniFa, ore, minuti).toISOString();
};

async function attivaHome(shell) {
  await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.filter((x) => String(x.url).startsWith('filo://newtab')).pop();
    await window.filoShell.tabs.activate(t.id);
  });
}

test('E1 tolgo la prima pagina del gruppo in corso, poi visito un’altra pagina: un gruppo solo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await home(app);
  for (const nome of ['alfa', 'beta', 'gamma']) {
    const p = await openTab(testServer.html(`<title>${nome}</title><p>${nome}</p>`));
    await p.waitForFunction((n) => document.title === n, nome);
  }
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.pagine()).length)).toBe(3);
  const page = await openTab('filo://newtab/');
  const riga = page.locator('.dash-pagine').last();
  await expect(riga.locator('.dash-pagine-testo')).toHaveText('3 pagine, fra cui gamma');
  await riga.locator('.dash-pagine-testa').click();
  const alfa = riga.locator('.dash-pagina', { hasText: 'alfa' });
  await alfa.click({ button: 'right' });
  await page.locator('.sn-menu').getByText('Togli dal filo', { exact: true }).click();
  await expect(alfa).toHaveCount(0);
  const p4 = await openTab(testServer.html('<title>delta</title><p>delta</p>'));
  await p4.waitForFunction(() => document.title === 'delta');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.pagine()).length)).toBe(3);
  await attivaHome(shell);
  await page.waitForTimeout(1500);
  const testi = await page.locator('.dash-pagine .dash-pagine-testo').allTextContents();
  console.log('E1 righe', JSON.stringify(testi));
  await page.screenshot({ path: 'tests/.shots/869-g3-e1.png' });
  expect(testi).toEqual(['3 pagine, fra cui delta']);
});

test('E2 una scheda chiusa tolta dalla Cronologia: la home la mostra ancora?', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await home(app);
  const url = testServer.html('<title>orche marine</title><p>le orche</p>');
  const p = await openTab(url);
  await p.waitForFunction(() => document.title === 'orche marine');
  await shell.evaluate(async (u) => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.find((x) => x.url === u);
    await window.filoShell.tabs.close(t.id);
  }, url);
  await expect.poll(() => app.evaluate(async (_e, u) => (await globalThis.SN_ARCHIVED_TABS.list()).filter((t) => t.url === u).length, url)).toBe(1);
  await app.evaluate(async (_e, u) => {
    const t = (await globalThis.SN_ARCHIVED_TABS.list()).find((x) => x.url === u);
    await globalThis.SN_ARCHIVED_TABS.remove(t.id);
  }, url);
  const page = await openTab('filo://newtab/');
  await page.locator('#cercaInput').fill('orche');
  await expect(page.locator('#cercaRisultati')).toBeVisible();
  await page.waitForTimeout(800);
  const trovate = await page.locator('#cercaRisultati .dash-cerca-pagina').allTextContents();
  const righe = await page.locator('.dash-pagine .dash-pagine-testo').allTextContents();
  console.log('E2 ricerca', JSON.stringify(trovate), 'righe', JSON.stringify(righe));
});

test('E3 titoli e messaggi con markup restano testo nella coda e nella ricerca', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await home(app);
  const p = await openTab(testServer.html('<title>&lt;img src=x onerror="window.__xss=1"&gt; orche</title><p>x</p>'));
  await p.waitForFunction(() => document.title.includes('orche'));
  await app.evaluate(async (_e, ts) => {
    const E = globalThis.SN_FILO_EVENTI;
    const qui = await globalThis.SN_IL_FILO.dispositivo();
    const ev = [
      E.crea(E.TIPI.CHAT_APERTA, { chat: 'x' }, { ts, dispositivo: qui }),
      E.crea(E.TIPI.MESSAGGIO, { chat: 'x', msg: { role: 'user', text: '<img src=y onerror="window.__xss2=1"> orche <b>grasse</b>' } }, { ts, dispositivo: qui, autore: 'utente' }),
    ];
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  }, new Date(Date.now() - 600000).toISOString());
  const page = await openTab('filo://newtab/');
  await page.locator('.dash-pagine').last().locator('.dash-pagine-testa').click();
  await page.locator('#cercaInput').fill('orche');
  await expect(page.locator('#cercaRisultati .dash-cerca-voce').first()).toBeVisible();
  await page.waitForTimeout(500);
  const imgs = await page.evaluate(() => ({ coda: document.querySelectorAll('#bubbles img[src="x"], #bubbles img[src="y"]').length, cerca: document.querySelectorAll('#cercaRisultati img').length, x: window.__xss || window.__xss2 || 0 }));
  console.log('E3', JSON.stringify(imgs));
  await page.screenshot({ path: 'tests/.shots/869-g3-e3.png' });
  expect(imgs).toEqual({ coda: 0, cerca: 0, x: 0 });
});

for (const tema of ['light', 'dark']) {
  test(`E4 aspetto della coda, tema ${tema}`, async ({ app, openTab }) => {
    test.setTimeout(60_000);
    await home(app);
    await app.evaluate(async (_e, d) => {
      const E = globalThis.SN_FILO_EVENTI;
      const qui = await globalThis.SN_IL_FILO.dispositivo();
      const ev = [];
      const chat = (id, msgs, disp = qui) => {
        ev.push(E.crea(E.TIPI.CHAT_APERTA, { chat: id }, { ts: msgs[0].ts, dispositivo: disp }));
        for (const m of msgs) ev.push(E.crea(E.TIPI.MESSAGGIO, { chat: id, msg: { role: m.role, text: m.text, ...(m.sp ? { spontaneo: true } : {}) } }, { ts: m.ts, dispositivo: disp, autore: m.role === 'user' ? 'utente' : 'filo' }));
      };
      chat('a', [{ role: 'user', text: 'trova un idraulico aperto sabato', ts: d.ieri }, { role: 'filo', text: 'Rossi & figli apre alle 8.', ts: d.ieri2 }]);
      chat('t', [{ role: 'user', text: 'sveglia alle 7', ts: d.ieri3 }], 'telefono');
      for (const [i, t] of ['YouTube: orche', 'Wikipedia: Orcinus orca', 'Meteo Roma'].entries()) ev.push(E.crea(E.TIPI.NAVIGAZIONE, { url: `https://es.it/${i}`, titolo: t }, { ts: d.pag[i], dispositivo: qui }));
      chat('b', [{ role: 'filo', text: 'Buongiorno. Il timer della pasta è suonato.', ts: d.oggi, sp: true }, { role: 'user', text: 'grazie, metti il tema scuro', ts: d.oggi2 }, { role: 'filo', text: 'Fatto.', ts: d.oggi3 }]);
      await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
    }, {
      ieri: alle(1, 18), ieri2: alle(1, 18, 1), ieri3: alle(1, 22),
      pag: [new Date(Date.now() - 50 * 60000).toISOString(), new Date(Date.now() - 45 * 60000).toISOString(), new Date(Date.now() - 40 * 60000).toISOString()],
      oggi: new Date(Date.now() - 30 * 60000).toISOString(), oggi2: new Date(Date.now() - 20 * 60000).toISOString(), oggi3: new Date(Date.now() - 19 * 60000).toISOString(),
    });
    await app.evaluate(async (_e, t) => globalThis.SN_STORAGE.updateSettings({ theme: t }), tema);
    const page = await openTab('filo://newtab/');
    await expect(page.locator('.dash-bubble', { hasText: 'Fatto.' })).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `tests/.shots/869-g3-e4-${tema}.png` });
    await page.locator('.dash-pagine').last().locator('.dash-pagine-testa').click();
    await page.locator('#cercaInput').fill('orche');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `tests/.shots/869-g3-e4-${tema}-cerca.png` });
  });
}
