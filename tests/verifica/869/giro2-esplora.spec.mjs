// Verifica #869 giro 2: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots';
mkdirSync(SHOTS, { recursive: true });

async function modelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__prompts = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const tutto = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      let text = '{}';
      if (tutto.includes('preparare la dashboard')) {
        globalThis.__prompts.push(tutto);
        const i = tutto.indexOf('PERCHÉ SCRIVI ADESSO:');
        const perche = i >= 0 ? tutto.slice(i, tutto.indexOf('\n\n', i)) : '';
        const detto = [];
        if (/giornata/.test(perche)) detto.push('Buongiorno.');
        if (/pasta/.test(perche)) detto.push('Il timer della pasta è suonato.');
        text = JSON.stringify({ message: detto.join(' '), suggestions: [] });
      }
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });
}

const alle = (giorniFa, ore, minuti = 0) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - giorniFa, ore, minuti).toISOString();
};

test('fusione dopo ore di pagine: il timer di adesso finisce sopra le pagine visitate prima', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(async (_e, d) => {
    const E = globalThis.SN_FILO_EVENTI;
    const qui = await globalThis.SN_IL_FILO.dispositivo();
    const msg = { role: 'filo', text: 'Buongiorno.', spontaneo: true, motivi: [{ tipo: 'giornata' }] };
    const ev = [E.crea(E.TIPI.CHAT_APERTA, { chat: 'mattina' }, { ts: d.saluto, dispositivo: qui }), E.crea(E.TIPI.MESSAGGIO, { chat: 'mattina', msg }, { ts: d.saluto, dispositivo: qui, autore: 'filo' })];
    for (const p of d.pagine) ev.push(E.crea(E.TIPI.NAVIGAZIONE, { url: p.url, titolo: p.titolo }, { ts: p.ts, dispositivo: qui }));
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  }, {
    saluto: new Date(Date.now() - 5 * 3600000).toISOString(),
    pagine: [1, 2, 3, 4].map((h) => ({ url: `https://esempio.it/${h}`, titolo: `pagina ${h}`, ts: new Date(Date.now() - (5 - h) * 3600000).toISOString() })),
  });
  const casa = await home(app);
  await modelli(app);
  await app.evaluate(() => globalThis.SN_FILO_PARLA.giro({ subito: [{ tipo: 'timer', testo: 'timer «pasta»' }] }));
  const page = await openTab('filo://newtab/');
  const spont = page.locator('.dash-bubble-filo[data-spontaneo="1"]').last();
  await expect(spont).toContainText('pasta', { timeout: 15_000 });
  const ordine = await page.evaluate(() => [...document.querySelectorAll('#bubbles > *')].map((n) => n.className.split(' ')[0] + ':' + (n.textContent || '').slice(0, 50)));
  console.log('ORDINE', JSON.stringify(ordine, null, 1));
  const posSpont = ordine.findIndex((x) => x.includes('pasta'));
  const posPagine = ordine.findIndex((x) => x.startsWith('dash-pagine'));
  await page.screenshot({ path: `${SHOTS}/v869-fusione-ore.png` });
  void casa;
  expect(posSpont).toBeGreaterThan(posPagine);
});

test('titoli con markup e testi con markup restano testo, nella coda e nella ricerca', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    const E = globalThis.SN_FILO_EVENTI;
    const qui = await globalThis.SN_IL_FILO.dispositivo();
    const ts = new Date(Date.now() - 600000).toISOString();
    const ev = [
      E.crea(E.TIPI.CHAT_APERTA, { chat: 'x' }, { ts, dispositivo: qui }),
      E.crea(E.TIPI.MESSAGGIO, { chat: 'x', msg: { role: 'user', text: '<img src=x onerror="window.__pwn=1"> orche <b>forte</b>' } }, { ts, dispositivo: qui, autore: 'utente' }),
      E.crea(E.TIPI.NAVIGAZIONE, { url: 'https://esempio.it/a', titolo: '<img src=x onerror="window.__pwn=2"> orche 🐋' }, { ts: new Date(Date.now() - 300000).toISOString(), dispositivo: qui }),
      E.crea(E.TIPI.NAVIGAZIONE, { url: 'javascript:alert(1)', titolo: 'orche js' }, { ts: new Date(Date.now() - 200000).toISOString(), dispositivo: qui }),
    ];
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  });
  const page = await openTab('filo://newtab/');
  await page.locator('.dash-pagine-testa').last().click();
  await expect(page.locator('.dash-pagina', { hasText: 'orche 🐋' })).toBeVisible();
  expect(await page.locator('#bubbles img[src="x"]').count()).toBe(0);
  await page.locator('#cercaInput').fill('orche');
  await expect(page.locator('#cercaRisultati .dash-cerca-voce').first()).toBeVisible();
  expect(await page.locator('#cercaRisultati img[src="x"]').count()).toBe(0);
  await page.screenshot({ path: `${SHOTS}/v869-markup.png` });
  // La voce javascript: nella ricerca non apre niente
  const js = page.locator('#cercaRisultati .dash-cerca-pagina', { hasText: 'orche js' });
  if (await js.count()) await js.click();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__pwn || 0)).toBe(0);
});

test('una pagina tolta dal filo mentre la sua scheda è ancora aperta, chiusa dopo, torna nella ricerca?', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const url = testServer.html('<title>orche marine</title><p>le orche</p>');
  const p = await openTab(url);
  await p.waitForFunction(() => document.title === 'orche marine');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.pagine()).length)).toBeGreaterThan(0);
  const page = await openTab('filo://newtab/');
  const riga = page.locator('.dash-pagine').last();
  await riga.locator('.dash-pagine-testa').click();
  const orche = riga.locator('.dash-pagina', { hasText: 'orche marine' });
  await orche.click({ button: 'right' });
  await page.locator('.sn-menu').getByText('Togli dal filo', { exact: true }).click();
  await expect(orche).toHaveCount(0);
  // Chiudo la scheda di orche
  await shell.evaluate(async (u) => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.find((x) => x.url === u);
    await window.filoShell.tabs.close(t.id);
  }, url);
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).length), { timeout: 10_000 }).toBeGreaterThan(0).catch(() => {});
  await page.bringToFront();
  await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.filter((x) => String(x.url).startsWith('filo://newtab')).pop();
    await window.filoShell.tabs.activate(t.id);
  });
  await page.locator('#cercaInput').fill('orche');
  await expect(page.locator('#cercaRisultati')).toBeVisible();
  await page.waitForTimeout(800);
  const testo = await page.locator('#cercaRisultati').textContent();
  console.log('RICERCA', testo);
  await expect(page.locator('#cercaRisultati .dash-cerca-niente')).toBeVisible();
});
