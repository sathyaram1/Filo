// Verifica #869 giro 2, rilievo 1: un evento di adesso che si fonde col saluto di stamattina finisce al posto del saluto,
// sopra le pagine visitate nel frattempo, invece che in fondo al filo.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

async function modelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const tutto = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      let text = '{}';
      if (tutto.includes('preparare la dashboard')) {
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

test('r1 il timer che suona adesso, dopo ore di pagine visitate dal saluto, compare in fondo al filo e non al posto del saluto', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const ora = Date.now();
  // Saluto e pagine nello stesso giorno: il saluto all'inizio della giornata, le pagine dopo, il timer adesso.
  const inizio = new Date(ora);
  inizio.setHours(0, 5, 0, 0);
  const passo = Math.max(60_000, Math.floor((ora - inizio.getTime()) / 5));
  await app.evaluate(async (_e, d) => {
    const E = globalThis.SN_FILO_EVENTI;
    const qui = await globalThis.SN_IL_FILO.dispositivo();
    const msg = { role: 'filo', text: 'Buongiorno.', spontaneo: true, motivi: [{ tipo: 'giornata' }] };
    const ev = [
      E.crea(E.TIPI.CHAT_APERTA, { chat: 'mattina' }, { ts: d.saluto, dispositivo: qui }),
      E.crea(E.TIPI.MESSAGGIO, { chat: 'mattina', msg }, { ts: d.saluto, dispositivo: qui, autore: 'filo' }),
    ];
    for (const p of d.pagine) ev.push(E.crea(E.TIPI.NAVIGAZIONE, { url: p.url, titolo: p.titolo }, { ts: p.ts, dispositivo: qui }));
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  }, {
    saluto: inizio.toISOString(),
    pagine: [1, 2, 3, 4].map((k) => ({ url: `https://esempio.it/${k}`, titolo: `pagina ${k}`, ts: new Date(inizio.getTime() + k * passo).toISOString() })),
  });
  await home(app);
  await modelli(app);
  await app.evaluate(() => globalThis.SN_FILO_PARLA.giro({ subito: [{ tipo: 'timer', testo: 'timer «pasta»' }] }));
  const page = await openTab('filo://newtab/');
  const timer = page.locator('.dash-bubble-filo[data-spontaneo="1"]', { hasText: 'pasta' });
  await expect(timer).toBeVisible({ timeout: 15_000 });
  // Il messaggio di adesso viene dopo le pagine visitate stamattina, non prima.
  const dopoLePagine = await page.evaluate(() => {
    const figli = [...document.querySelectorAll('#bubbles > *')];
    const t = figli.findIndex((n) => n.classList.contains('dash-bubble') && /pasta/.test(n.textContent || ''));
    const p = figli.findIndex((n) => n.classList.contains('dash-pagine'));
    return t > p && p >= 0;
  });
  expect(dopoLePagine).toBe(true);
});
