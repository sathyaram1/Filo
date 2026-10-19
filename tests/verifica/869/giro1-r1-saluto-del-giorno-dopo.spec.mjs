// Verifica #869, giro 1, rilievo 1: il saluto della giornata si fonde col messaggio spontaneo di ieri.
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

test('r1 il saluto di oggi non riracconta il timer suonato ieri sera, e il messaggio di ieri resta sotto «ieri»', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await semina(app, [
    { tipo: 'CHAT_APERTA', dati: { chat: 'ieri' }, ts: alle(1, 20) },
    { tipo: 'MESSAGGIO', dati: { chat: 'ieri', msg: { role: 'filo', text: 'Il timer della pasta è suonato.', spontaneo: true, motivi: [{ tipo: 'timer', testo: 'timer «pasta»' }] } }, ts: alle(1, 20), autore: 'filo' },
  ]);
  await home(app);
  await modelli(app);
  await app.evaluate(() => globalThis.SN_FILO_PARLA.giro({ subito: [{ tipo: 'giornata' }] }));
  const page = await openTab('filo://newtab/');
  // Il saluto di oggi sta sotto «oggi», non sbiadito; il messaggio di ieri resta com'era sotto «ieri».
  const saluto = page.locator('.dash-bubble-filo[data-spontaneo="1"]').last();
  await expect(saluto).toHaveText('Buongiorno.');
  await expect(saluto).not.toHaveClass(/dash-vecchio/);
  await expect(page.locator('.dash-bubble-filo.dash-vecchio', { hasText: 'Il timer della pasta è suonato.' })).toHaveCount(1);
  const perche = await app.evaluate(() => globalThis.__perche.join('\n'));
  expect(perche).not.toContain('pasta');
});
