// Verifica #869, giro 1: prove avversariali sulla coda del filo nella home.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi } from '../../helpers/chatFinta.mjs';

async function modelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__perche = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const tutto = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      let text = '{}';
      if (tutto.includes('preparare la dashboard')) {
        const i = tutto.indexOf('PERCHÉ SCRIVI ADESSO:');
        const perche = i >= 0 ? tutto.slice(i, tutto.indexOf('\n\n', i)) : '';
        globalThis.__perche.push(perche);
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

async function semina(app, eventi) {
  await app.evaluate(async (_e, dati) => {
    const E = globalThis.SN_FILO_EVENTI;
    const qui = await globalThis.SN_IL_FILO.dispositivo();
    const ev = dati.map((x) => E.crea(E.TIPI[x.tipo], x.dati, { ts: x.ts, dispositivo: qui, ...(x.autore ? { autore: x.autore } : {}) }));
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  }, eventi);
}

test('il saluto di oggi non riracconta il timer suonato ieri sera, e il messaggio di ieri resta sotto «ieri»', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await semina(app, [
    { tipo: 'CHAT_APERTA', dati: { chat: 'ieri' }, ts: alle(1, 20) },
    { tipo: 'MESSAGGIO', dati: { chat: 'ieri', msg: { role: 'filo', text: 'Il timer della pasta è suonato.', spontaneo: true, motivi: [{ tipo: 'timer', testo: 'timer «pasta»' }] } }, ts: alle(1, 20), autore: 'filo' },
  ]);
  await home(app);
  await modelli(app);
  await app.evaluate(() => globalThis.SN_FILO_PARLA.giro({ subito: [{ tipo: 'giornata' }] }));
  const perche = await app.evaluate(() => globalThis.__perche.join('\n'));
  expect(perche).not.toContain('pasta');
  const page = await openTab('filo://newtab/');
  await expect(page.locator('.dash-bubble-filo[data-spontaneo="1"]').last()).toHaveText('Buongiorno.');
  await expect(page.locator('.dash-bubble-filo.dash-vecchio', { hasText: 'Il timer della pasta è suonato.' })).toHaveCount(1);
});

test('una pagina tolta dal filo col tasto destro non torna fra i risultati della ricerca', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const url = 'https://www.youtube.com/watch?v=orche';
  await semina(app, [{ tipo: 'NAVIGAZIONE', dati: { url, titolo: 'YouTube: orche' }, ts: alle(0, 0, 30) }]);
  await app.evaluate(async (_e, u) => { await globalThis.SN_ARCHIVED_TABS.archive({ url: u, title: 'YouTube: orche', closedAt: new Date().toISOString() }); }, url);
  const page = await openTab('filo://newtab/');
  const riga = page.locator('.dash-pagine').last();
  await riga.locator('.dash-pagine-testa').click();
  const orche = riga.locator('.dash-pagina', { hasText: 'YouTube: orche' });
  await orche.click({ button: 'right' });
  await page.locator('.sn-menu').getByText('Togli dal filo', { exact: true }).click();
  await expect(orche).toHaveCount(0);
  await page.locator('#cercaInput').fill('orche');
  await expect(page.locator('#cercaRisultati .dash-cerca-niente')).toBeVisible();
  await expect(page.locator('#cercaRisultati .dash-cerca-pagina')).toHaveCount(0);
});

test('titoli con markup restano testo nella riga delle pagine e nella ricerca', async ({ app, openTab }) => {
  const titolo = '<img src=x onerror="window.__x=1">orche';
  await semina(app, [{ tipo: 'NAVIGAZIONE', dati: { url: 'https://esempio.it/a', titolo }, ts: alle(0, 0, 30) }]);
  const page = await openTab('filo://newtab/');
  await page.locator('.dash-pagine-testa').last().click();
  await page.locator('#cercaInput').fill('orche');
  await expect(page.locator('#cercaRisultati .dash-cerca-pagina')).toHaveCount(1);
  expect(await page.evaluate(() => document.querySelectorAll('#bubbles img, #cercaRisultati img').length)).toBe(0);
  expect(await page.evaluate(() => window.__x)).toBeUndefined();
});

test('due home aperte: lo scambio scritto in una compare nell’altra e lì si continua', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const a = await home(app);
  const b = await openTab('filo://newtab/');
  await modelloFinto(app, [{ text: 'Le orche cacciano in branco.' }, { text: 'Anche le balene.' }]);
  await a.bringToFront();
  await chiedi(a, 'come cacciano le orche?');
  await expect(a.locator('.dash-bubble-filo', { hasText: 'Le orche cacciano in branco.' })).toBeVisible();
  await b.bringToFront();
  await expect(b.locator('.dash-bubble-filo', { hasText: 'Le orche cacciano in branco.' })).toHaveCount(1);
  await expect(b.locator('.dash-bubble-user', { hasText: 'come cacciano le orche?' })).toHaveCount(1);
  await chiedi(b, 'e le balene?');
  await expect(b.locator('.dash-bubble-filo', { hasText: 'Anche le balene.' })).toBeVisible();
  const chats = await app.evaluate(async () => (await globalThis.SN_IL_FILO.chats()).filter((c) => !c.app).map((c) => c.messages.length));
  expect(chats).toEqual([4]);
});
