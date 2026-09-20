// #525 — giro 6. Il giro 4 aveva trovato che «riprendi la discussione di ieri
// sulla coscienza» non trovava niente: pretendere TUTTE le parole della frase
// faceva sparire la chat. La correzione allarga la ricerca alle parole «che
// distinguono» — ma solo a quelle più lunghe di tre lettere. Qui si prova cosa
// resta fuori: un argomento che si chiama con una parola corta (Zen, SQL, Mac).
//
// E poi la promessa: il manifesto di cosa sa fare Filo dice che nessuna chat
// esce dal computer. Alla chiusura di ogni chat la trascrizione va a un
// modello, che di computer è un altro.

import { test, expect } from '../../fixtures/electron.mjs';

const ARCHIVE = 'filo://archive/archive.html';

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

// Il provider finto tiene anche il REGISTRO di cosa gli è arrivato: serve alla
// prova sulla promessa del manifesto.
async function stubProvider(app, triage) {
  await app.evaluate(async (_e, { triage }) => {
    globalThis.__filoTriage = triage;
    globalThis.__filoInviato = [];
    const rispondi = async ({ attempts, messages }) => {
      const joined = messages
        .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join('\n');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (joined.includes('Classifichi le conversazioni')) {
        globalThis.__filoInviato.push(joined);
        for (const [ago, risposta] of Object.entries(globalThis.__filoTriage || {})) {
          if (joined.includes(ago)) return { ...base, text: JSON.stringify(risposta) };
        }
        return { ...base, text: JSON.stringify({ tipo: 'conversazione', titolo: 'Senza etichetta' }) };
      }
      return { ...base, text: JSON.stringify({ text: 'Va bene, ci penso.', actions: [] }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = rispondi;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = rispondi;
  }, { triage });
}

const turno = (app, chatId, userMessage) => app.evaluate(
  (_e, { chatId, userMessage }) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage, threadHistory: [], chatId }),
  { chatId, userMessage },
);

const cercaComeFilo = (app, query) => app.evaluate(
  (_e, q) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'CERCA_CHAT', query: q }),
  query,
);

const leggiArchivio = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list());

// ─────────────────────────────────────────────────────────────────────────────

test('un argomento dal nome corto: Filo non ritrova la chat che c’è', async ({ app }) => {
  test.setTimeout(120_000);
  await configura(app);
  await stubProvider(app, {
    Zen: { tipo: 'conversazione', titolo: 'Meditazione Zen e respiro' },
    SQL: { tipo: 'conversazione', titolo: 'Indici SQL e prestazioni' },
  });

  await turno(app, 'c-zen', 'Parliamo di Zen: come si imposta la meditazione sul respiro?');
  await app.evaluate(() => globalThis.SN_CLOSE_FILO_CHAT('c-zen'));
  await turno(app, 'c-sql', 'Spiegami gli indici SQL e quando conviene metterli');
  await app.evaluate(() => globalThis.SN_CLOSE_FILO_CHAT('c-sql'));
  await expect.poll(async () => (await leggiArchivio(app)).filter((c) => c.kind).length, { timeout: 30_000 }).toBe(2);

  // La parola sola la trova: il problema non è l'archivio, è la frase.
  const solaZen = await cercaComeFilo(app, 'Zen');
  expect(((solaZen.output || {}).results || []).map((r) => r.id)).toContain('c-zen');

  // Come l'utente la chiede davvero — è la forma che il feedback stesso nomina.
  const esiti = {};
  for (const [q, atteso] of [
    ['riprendi la discussione di ieri sullo Zen', 'c-zen'],
    ['la chat su SQL', 'c-sql'],
    ['riprendi la discussione sugli indici SQL', 'c-sql'],
  ]) {
    const r = await cercaComeFilo(app, q);
    esiti[q] = { trovati: ((r.output || {}).results || []).map((x) => x.id), atteso };
  }
  console.log('CERCA CON UNA PAROLA CORTA:', JSON.stringify(esiti, null, 1));
  for (const [q, { trovati, atteso }] of Object.entries(esiti)) {
    expect(trovati, `query: ${q}`).toContain(atteso);
  }
});

test('Cronologia: una frase con dentro una parola corta non trova la chat', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await configura(app);
  await stubProvider(app, { Zen: { tipo: 'conversazione', titolo: 'Meditazione Zen e respiro' } });

  await turno(app, 'c-zen', 'Parliamo di Zen: come si imposta la meditazione sul respiro?');
  await app.evaluate(() => globalThis.SN_CLOSE_FILO_CHAT('c-zen'));
  await expect.poll(async () => (await leggiArchivio(app)).filter((c) => c.kind).length, { timeout: 30_000 }).toBe(1);

  const page = await openTab(ARCHIVE);
  await expect(page.locator('.arc-chat').first()).toBeVisible({ timeout: 20_000 });

  await page.locator('#search').fill('la chat sullo Zen');
  await page.waitForTimeout(1200);
  const conFrase = {
    righe: await page.locator('.arc-chat').count(),
    vuoto: (await page.locator('#chatEmpty').textContent()) || '',
  };
  console.log('RICERCA A FRASE:', JSON.stringify(conFrase));

  await page.screenshot({ path: 'tests/.shots/525-giro6-ricerca-frase.png', fullPage: true });

  expect(conFrase.righe, `la pagina dice: ${conFrase.vuoto}`).toBeGreaterThan(0);
});

test('Cronologia: «cerca nei contenuti» e la chat che intanto è lì sopra', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await configura(app);
  await stubProvider(app, { coscienza: { tipo: 'conversazione', titolo: 'La coscienza' } });

  await turno(app, 'c-cosc', 'Parliamo della coscienza e del libero arbitrio');
  await app.evaluate(() => globalThis.SN_CLOSE_FILO_CHAT('c-cosc'));
  await expect.poll(async () => (await leggiArchivio(app)).filter((c) => c.kind).length, { timeout: 30_000 }).toBe(1);

  const page = await openTab(ARCHIVE);
  await expect(page.locator('.arc-chat').first()).toBeVisible({ timeout: 20_000 });

  await page.locator('#search').fill('coscienza');
  await page.waitForTimeout(900);
  await page.locator('#search').press('Enter');
  await page.waitForTimeout(1500);

  const esito = await page.evaluate(() => ({
    righeChat: document.querySelectorAll('.arc-chat').length,
    nota: (document.getElementById('searchNote').hidden
      ? '' : document.getElementById('searchNote').textContent) || '',
  }));
  console.log('INVIO NEL CAMPO DI RICERCA:', JSON.stringify(esito));
  await page.screenshot({ path: 'tests/.shots/525-giro6-invio-ricerca.png', fullPage: true });

  // Con una chat trovata a schermo, la riga in cima non deve dire il contrario.
  expect(/nessun risultato/i.test(esito.nota) && esito.righeChat > 0,
    `la pagina dice «${esito.nota}» con ${esito.righeChat} chat in elenco`).toBeFalsy();
});

test('il manifesto dice che nessuna chat esce dal computer: alla chiusura ci esce', async ({ app }) => {
  test.setTimeout(120_000);
  await configura(app);
  await stubProvider(app, { segreto: { tipo: 'conversazione', titolo: 'Una cosa privata' } });

  // Una frase che l'utente non si aspetta di veder partire da nessuna parte.
  const confidenza = 'Il mio segreto e che ho paura di volare, non dirlo a nessuno';
  await turno(app, 'c-privata', confidenza);
  await app.evaluate(() => globalThis.SN_CLOSE_FILO_CHAT('c-privata'));
  await expect.poll(async () => (await leggiArchivio(app)).filter((c) => c.kind).length, { timeout: 30_000 }).toBe(1);

  const inviato = await app.evaluate(() => globalThis.__filoInviato || []);
  const uscita = inviato.some((t) => t.includes('paura di volare'));
  console.log('LA CONFIDENZA E ARRIVATA A UN MODELLO:', uscita);

  const promessa = await app.evaluate(() => {
    const C = globalThis.SN_CAPABILITIES;
    const voci = (C.all ? C.all() : C.CAPABILITIES) || [];
    const trovate = [];
    for (const v of voci) {
      const testo = `${v.desc || ''} ${v.doesNot || ''}`;
      if (!/chat|conversazion/i.test(testo)) continue;
      if (/nessuna chat esce dal tuo computer|niente di quello che scrivi finisce altrove/i.test(testo)) {
        trovate.push(v.id);
      }
    }
    return trovate;
  });
  console.log('VOCI DEL MANIFESTO CHE PROMETTONO IL CONTRARIO:', JSON.stringify(promessa));

  // O la chat non esce, o il manifesto non promette che non esce.
  expect(uscita && promessa.length > 0,
    `la trascrizione va a un modello e il manifesto lo nega in: ${promessa.join(', ')}`).toBeFalsy();
});
