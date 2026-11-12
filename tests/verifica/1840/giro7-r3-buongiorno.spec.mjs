// Verifica #1840 giro 7, rilievo 3: in una home vera Filo scrive da sé nel filo (il buongiorno, un timer o un download
// finiti, la fine del benvenuto). Quel suo messaggio non può bastare a far ricevere il no a una richiesta vera fatta in
// una conversazione nuova che non ha letto niente: la strada B la manda al riquadro con la parola.
import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState, clickConfirm } from '../../helpers/confirm.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

const chiamata = (id, name, args) => ({ toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });

// Il modello della home scrive il saluto del mattino, come in home-coda-del-filo.spec.mjs.
async function buongiorno(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      autonomia: { livello: 'default' },
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const tutto = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const text = tutto.includes('preparare la dashboard') ? JSON.stringify({ message: 'Buongiorno.', suggestions: [] }) : '{}';
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });
  await app.evaluate(() => globalThis.SN_FILO_PARLA.giro({ subito: [{ tipo: 'giornata' }] }));
}

test('r3 dopo il buongiorno di Filo, «mettiti in modalità automatica» in una conversazione nuova apre il riquadro con la parola', async ({ app }) => {
  const page = await home(app);
  await buongiorno(app);
  await expect(page.locator('.dash-bubble-filo[data-spontaneo="1"]', { hasText: 'Buongiorno.' })).toBeVisible({ timeout: 15000 });
  try {
    await modelloFinto(app, [chiamata('a1', 'IMPOSTA_PREFERENZA', { chiave: 'autonomia', valore: 'automatico' }), { text: 'Fatto il possibile.' }]);
    await chiedi(page, 'mettiti in modalità automatica');
    const no = page.locator('.dash-activity').filter({ hasText: 'Dopo aver letto cose scritte da altri' });
    await expect(page.locator(CONFIRM_HOST).or(no)).toBeVisible({ timeout: 15000 });
    await expect(no, 'il solo saluto di Filo non è una lettura che toglie la parola').toHaveCount(0);
    expect((await confirmState(page)).hasInput).toBe(true);
    await clickConfirm(page, 'cancel');
  } finally {
    await ripristina(app);
  }
});
