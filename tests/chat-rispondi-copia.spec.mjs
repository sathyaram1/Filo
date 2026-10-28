// #1620 — passando sopra una risposta di Filo compaiono sotto Copia e Rispondi. Copia mette negli appunti il testo
// come si legge; Rispondi cita la risposta sopra il campo e in testa al messaggio che parte, come nelle app di
// messaggi: il modello sa a quale risposta si risponde, e la citazione resta riaprendo la home. Il modello è finto.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const RISPOSTA = '**Tre idee** per cena:\n\n1. Pasta al pomodoro\n2. Risotto ai funghi\n3. Zuppa di lenticchie';
const COME_SI_LEGGE = 'Tre idee per cena:\n\n1. Pasta al pomodoro\n2. Risotto ai funghi\n3. Zuppa di lenticchie';

async function preparaModello(app, copione) {
  await app.evaluate(async (_e, copione) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__copione = copione.slice();
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const chat = messages.some((m) => m.role === 'user' && String(m.content).startsWith('═══ CONTESTO DI ADESSO'));
      if (!chat) return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      globalThis.__chiamate.push(JSON.parse(JSON.stringify(messages)));
      const r = globalThis.__copione.shift() || { text: 'ok' };
      try { onDelta && onDelta(r.text); } catch (_) {}
      return { ...base, text: r.text, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, copione);
}

const testo = (m) => (typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n'));
const ultimaDomanda = async (app) => {
  const tutte = await app.evaluate(() => globalThis.__chiamate);
  const msgs = tutte[tutte.length - 1];
  return testo(msgs[msgs.length - 1]);
};

async function apriHome(openTab) {
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  return home;
}

async function scrivi(home, cosa) {
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  await home.locator('#input').fill(cosa);
  await home.locator('#input').press('Enter');
}

// Le sole parole dell'utente nella bolla: la citazione sta negli attributi, non nel testo.
const paroleDellaBolla = (bolla) => bolla.evaluate((el) => el.textContent.trim());

test('Copia e Rispondi sotto una risposta di Filo: la citazione parte col messaggio, il modello la legge e resta riaprendo la home', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await preparaModello(app, [{ text: RISPOSTA }, { text: 'Ottima scelta: il risotto.' }, { text: 'Prego!' }]);
  const home = await apriHome(openTab);
  await scrivi(home, 'cosa cucino stasera?');

  const risposta = home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Risotto ai funghi' });
  await expect(risposta).toBeVisible({ timeout: 20_000 });
  const domanda = home.locator('#bubbles > .dash-bubble-user', { hasText: 'cosa cucino stasera?' });
  await expect(domanda).toBeVisible();
  // Anche formattata, la risposta appena scritta prende il suo posto nel filo: è quello che la citazione salva.
  await expect(risposta).toHaveAttribute('data-key', /^m:/, { timeout: 10_000 });

  // Al passaggio del mouse i tasti compaiono SOTTO la risposta, e niente si sposta.
  const prima = await risposta.boundingBox();
  await risposta.hover();
  const barra = risposta.locator('.dash-msg-azioni');
  await expect(barra).toBeVisible();
  const copia = barra.getByRole('button', { name: 'Copia' });
  const rispondi = barra.getByRole('button', { name: 'Rispondi' });
  await expect(copia).toBeVisible();
  await expect(rispondi).toBeVisible();
  const dopo = await risposta.boundingBox();
  expect(dopo).toEqual(prima);
  const sotto = await barra.boundingBox();
  expect(sotto.y).toBeGreaterThanOrEqual(dopo.y + dopo.height - 1);
  await home.screenshot({ path: 'tests/.shots/chat-rispondi-copia-tasti.png' });

  // Copia: negli appunti il testo come si legge, e il tasto lo dice.
  await copia.click();
  await expect(barra.getByRole('button', { name: 'Copiato' })).toBeVisible();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(COME_SI_LEGGE);

  // Rispondi: la citazione sopra il campo, e il fuoco nel campo.
  await rispondi.click();
  const citazione = home.locator('#citazione');
  await expect(citazione).toBeVisible();
  await expect(citazione).toContainText('Filo');
  await expect(citazione).toContainText('Risotto ai funghi');
  await expect(home.locator('#input')).toBeFocused();
  await home.screenshot({ path: 'tests/.shots/chat-rispondi-copia-campo.png' });

  await home.locator('#input').fill('la seconda');
  await home.locator('#input').press('Enter');
  await expect(citazione).toBeHidden();
  const mia = home.locator('#bubbles > .dash-bubble-user').last();
  await expect(mia.locator('.dash-citata')).toHaveAttribute('data-testo', COME_SI_LEGGE);
  await expect(mia.locator('.dash-citata')).toHaveAttribute('data-chi', 'Filo');
  expect(await paroleDellaBolla(mia)).toBe('la seconda');
  await expect(home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Ottima scelta' })).toBeVisible({ timeout: 20_000 });

  // Nel filo il messaggio tiene il posto della risposta citata, non una sua copia.
  const salvata = await app.evaluate(async () => {
    const chats = await globalThis.SN_IL_FILO.chats();
    const mia = chats.flatMap((c) => c.messages).find((m) => m.role === 'user' && m.text === 'la seconda');
    const r = mia && mia.rispostaA;
    const citata = r && chats.find((c) => c.id === r.chat);
    return { r, testo: citata ? citata.messages[r.i].text : null };
  });
  expect(salvata.r.testo).toBeUndefined();
  expect(salvata.testo).toBe(RISPOSTA);

  // Il modello sa a quale risposta si risponde: la citazione in testa alle parole dell'utente.
  const detta = await ultimaDomanda(app);
  expect(detta).toContain("l'utente risponde al tuo messaggio");
  expect(detta).toContain('Risotto ai funghi');
  expect(detta.trim().endsWith('la seconda')).toBe(true);
  await home.screenshot({ path: 'tests/.shots/chat-rispondi-copia-bolla.png' });

  // Al messaggio dopo il filo che il modello ha davanti la ricorda ancora.
  await scrivi(home, 'grazie');
  await expect(home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Prego!' })).toBeVisible({ timeout: 20_000 });
  const tutte = await app.evaluate(() => globalThis.__chiamate);
  const storia = tutte[tutte.length - 1].filter((m) => m.role === 'user').map(testo).find((t) => t.trim().endsWith('la seconda')) || '';
  expect(storia).toContain("l'utente risponde al tuo messaggio");
  expect(storia).toContain('Risotto ai funghi');

  // Riaprendo la home la citazione torna dal filo, e un clic porta alla risposta citata.
  await home.reload();
  const riaperta = home.locator('#bubbles > .dash-bubble-user', { hasText: 'la seconda' });
  await expect(riaperta.locator('.dash-citata')).toHaveAttribute('data-testo', COME_SI_LEGGE, { timeout: 15_000 });
  expect(await paroleDellaBolla(riaperta)).toBe('la seconda');
  await riaperta.locator('.dash-citata').click();
  await expect(home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Risotto ai funghi' })).toHaveClass(/dash-trovato/);
});

test('Esc e la crocetta lasciano la citazione: il messaggio dopo parte senza', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await preparaModello(app, [{ text: 'Domani piove.' }, { text: 'Sì.' }]);
  const home = await apriHome(openTab);
  await scrivi(home, 'che tempo fa domani?');
  const risposta = home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Domani piove.' });
  await expect(risposta).toBeVisible({ timeout: 20_000 });
  const citazione = home.locator('#citazione');

  await risposta.hover();
  await risposta.getByRole('button', { name: 'Rispondi' }).click();
  await expect(citazione).toBeVisible();
  await home.locator('#input').press('Escape');
  await expect(citazione).toBeHidden();

  await risposta.hover();
  await risposta.getByRole('button', { name: 'Rispondi' }).click();
  await expect(citazione).toBeVisible();
  await citazione.getByRole('button', { name: 'Non rispondere' }).click();
  await expect(citazione).toBeHidden();
  await expect(home.locator('#input')).toBeFocused();

  await scrivi(home, 'ok');
  await expect(home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Sì.' })).toBeVisible({ timeout: 20_000 });
  await expect(home.locator('#bubbles > .dash-bubble-user').last().locator('.dash-citata')).toHaveCount(0);
  expect(await ultimaDomanda(app)).not.toContain("l'utente risponde");
});

test('dal tasto destro di una risposta: Rispondi e Copia il messaggio fanno quello dei tasti', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await preparaModello(app, [{ text: 'Il **treno** parte alle 9.' }]);
  const home = await apriHome(openTab);
  await scrivi(home, 'a che ora parte il treno?');
  const risposta = home.locator('#bubbles > .dash-bubble-filo', { hasText: 'parte alle 9' });
  await expect(risposta).toBeVisible({ timeout: 20_000 });

  await risposta.click({ button: 'right' });
  await menuDi(home).voce('Copia il messaggio').first().click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Il treno parte alle 9.');

  await risposta.click({ button: 'right' });
  await menuDi(home).voce('Rispondi').first().click();
  await expect(home.locator('#citazione')).toContainText('Il treno parte alle 9.');
});
