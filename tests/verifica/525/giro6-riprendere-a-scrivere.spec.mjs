// #525 — giro 6. «Ogni chat … si riapre per intero; da lì si può continuare a
// scrivere.» È l'ultima metà della frase, e nei giri passati è stata provata
// solo la prima: che la conversazione torni a schermo. Qui si scrive DENTRO
// quella conversazione riaperta e si controlla che il filo resti uno solo —
// niente chat gemella, niente messaggi che si perdono, e Filo che la ritrova
// ancora dopo.

import { test, expect } from '../../fixtures/electron.mjs';

const DASH = 'filo://dashboard/dashboard.html';

async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
        [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
        [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

async function stubProvider(app) {
  await app.evaluate(async () => {
    const rispondi = async ({ attempts, messages }) => {
      const joined = messages
        .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join('\n');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (joined.includes('Classifichi le conversazioni')) {
        return { ...base, text: JSON.stringify({ tipo: 'conversazione', titolo: 'Spinoza e la sostanza' }) };
      }
      return { ...base, text: JSON.stringify({ text: 'Va bene, ci penso.', actions: [] }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = rispondi;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = rispondi;
  });
}

const leggiArchivio = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list());

test('una chat riaperta si continua: un filo solo, e Filo la ritrova ancora', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  await configura(app);
  await stubProvider(app);

  // Una conversazione fatta e chiusa, come la farebbe l'utente.
  await app.evaluate(() => globalThis.SN_HANDLE_FILO_CHAT({
    userMessage: 'Parliamo di Spinoza e della sostanza unica', threadHistory: [], chatId: 'c-spinoza',
  }));
  await app.evaluate(() => globalThis.SN_CLOSE_FILO_CHAT('c-spinoza'));
  await expect.poll(async () => ((await leggiArchivio(app))[0] || {}).kind || '', { timeout: 30_000 })
    .toBe('conversazione');

  // La si riapre da Cronologia (è il link che quella pagina apre) e si scrive.
  const dash = await openTab(`${DASH}?chat=c-spinoza`);
  await expect(dash.locator('.dash-bubble').first()).toBeVisible({ timeout: 30_000 });
  const bolleRiaperte = await dash.locator('.dash-bubble').count();

  await dash.locator('#input').fill('E il conatus come ci entra?');
  await dash.locator('#input').press('Enter');
  await expect.poll(async () => dash.locator('.dash-bubble').count(), { timeout: 40_000 })
    .toBeGreaterThan(bolleRiaperte + 1);

  // Si torna alla home: la conversazione si chiude di nuovo.
  await dash.locator('#input').fill('/home');
  await dash.locator('#input').press('Enter');
  await dash.waitForTimeout(1500);

  const chats = await leggiArchivio(app);
  console.log('ARCHIVIO DOPO LA RIPRESA:', JSON.stringify(chats.map((c) => ({
    id: c.id, titolo: c.title, tipo: c.kind, chiusa: !!c.closedAt,
    testi: (c.messages || []).map((m) => `${m.role}: ${m.text.slice(0, 40)}`),
  })), null, 1));

  // Un filo solo: la ripresa non deve aver aperto una chat gemella.
  expect(chats.length, 'la ripresa ha aperto una seconda chat').toBe(1);
  const testi = (chats[0].messages || []).map((m) => m.text).join('\n');
  expect(testi, 'il primo messaggio della chat non c’è più').toContain('Spinoza');
  expect(testi, 'il messaggio scritto dopo la riapertura non è stato archiviato').toContain('conatus');
  expect(!!chats[0].closedAt, 'la chat ripresa non si è richiusa').toBeTruthy();

  // E Filo la ritrova ancora: una chat ripresa non deve uscire dal suo raggio.
  const r = await app.evaluate(
    () => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'CERCA_CHAT', query: 'conatus' }),
  );
  const ids = ((r.output || {}).results || []).map((x) => x.id);
  console.log('FILO RITROVA LA CHAT RIPRESA:', JSON.stringify(ids));
  expect(ids).toContain('c-spinoza');
});
