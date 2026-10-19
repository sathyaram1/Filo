// #1118: la ricerca fra i feedback usa un classificatore (Jev) in parallelo, sul main vero con Firestore e OpenRouter
// finti. Il classificatore legge ogni feedback, le richieste partono insieme, i risultati arrivano ordinati per
// probabilità; se il classificatore non risponde, li ordina il modello della ricerca e la pagina lo dice.
import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';

const URL = 'filo://manage/manage.html';

// Quaranta feedback, tre sul tasto di chiusura scritti con parole diverse: il classificatore li riconosce dal senso.
function feedbacks(n = 40) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      _id: `fb-${i}`, name: `Feedback qualunque ${i}`, text: `Una richiesta che parla d'altro, numero ${i}.`,
      seq: 500 + i, subSeq: 0, status: i % 3 ? 'new' : 'archived',
      clientId: 't@example.com', createdAt: '2026-06-03T10:00:00Z', images: [],
    });
  }
  out[7] = { ...out[7], name: 'La X non chiude', text: 'Premo la crocetta in alto e la scheda resta lì.' };
  out[23] = { ...out[23], name: 'Pulsante di chiusura morto', text: 'Il tasto per chiudere non risponde.' };
  out[31] = { ...out[31], name: 'Chiudere è difficile', text: 'Forse il bottone di chiusura è troppo piccolo.' };
  return out;
}

async function preparaOwner(app, { supportDoc, rispostaDecisioni = 'ok', openWeightsOnly = false, latenza = 300 }) {
  await app.evaluate(async (electron, { supportDoc, rispostaDecisioni, openWeightsOnly, latenza }) => {
    const { createRequire } = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = createRequire(path.join(electron.app.getAppPath(), 'package.json'));
    const auth = req(path.join(electron.app.getAppPath(), 'src/main/auth/google-auth.js'));
    const toFs = (v) => {
      if (typeof v === 'string') return { stringValue: v };
      const fields = {}; for (const [k, x] of Object.entries(v)) fields[k] = toFs(x);
      return { mapValue: { fields } };
    };
    const g = globalThis.__g1118 = {
      docs: {
        'config/supportModels': { fields: toFs(supportDoc).mapValue.fields },
        'config/judgeSecrets': { fields: { openrouterKey: { stringValue: 'sk-giudici' } } },
      },
      decisioni: [], chat: [], inVolo: 0, picco: 0, piccoTardi: 0, t0: 0, patch: [],
    };
    auth.getIdToken = async () => 'finto';
    auth.isAdmin = () => true;
    auth.isSignedIn = () => true;
    auth.getProfile = () => ({ email: 'owner@example.com', name: 'Owner' });
    const risposta = (ok, corpo, status, headers) => ({
      ok, status: status || (ok ? 200 : 404), headers: new Map(Object.entries(headers || {})),
      clone() { return this; }, async json() { return corpo; }, async text() { return JSON.stringify(corpo); },
    });
    const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      const m = u.match(/documents\/(config\/[A-Za-z]+)/);
      if (m) {
        if ((init.method || 'GET') === 'PATCH') {
          const body = JSON.parse(init.body);
          const cur = g.docs[m[1]] || { fields: {} };
          for (const k of new URL(u).searchParams.getAll('updateMask.fieldPaths')) cur.fields[k] = body.fields[k];
          g.docs[m[1]] = cur;
          g.patch.push(m[1]);
          return risposta(true, cur);
        }
        return g.docs[m[1]] ? risposta(true, g.docs[m[1]]) : risposta(false, {}, 404);
      }
      if (u.includes('/endpoints')) return risposta(true, { data: { endpoints: [{ provider_name: 'TypeSafe', tag: 'typesafe' }] } });
      if (u.includes('openrouter.ai/api/alpha/decisions')) {
        const body = JSON.parse(init.body || '{}');
        g.decisioni.push(body);
        g.inVolo++; g.picco = Math.max(g.picco, g.inVolo);
        if (!g.t0) g.t0 = Date.now();
        if (Date.now() - g.t0 > 4500) g.piccoTardi = Math.max(g.piccoTardi, g.inVolo);
        try {
          const n = g.decisioni.length;
          if (rispostaDecisioni === 'uno-giu' && n === 1) return risposta(false, { error: { message: 'upstream' } }, 502);
          await pausa(latenza);
          if (rispostaDecisioni === 'piano' && n <= 4) return risposta(false, { error: { message: 'rate limited' } }, 429, { 'retry-after': '0.3' });
          // Troppe richieste per i primi due secondi, con l'attesa chiesta o senza: il servizio c'è, si aspetta.
          if (n === 1) g.primo = Date.now();
          if (/^piano-2s/.test(rispostaDecisioni) && Date.now() - g.primo < 2000) {
            return risposta(false, { error: { message: 'rate limited' } }, 429, rispostaDecisioni === 'piano-2s' ? { 'retry-after': '2' } : {});
          }
          if (rispostaDecisioni === 'sempre429') return risposta(false, { error: { message: 'rate limited' } }, 429, {});
          if (rispostaDecisioni === 'rifiuta') return risposta(false, { error: { message: 'not a decisions model' } }, 400);
          if (rispostaDecisioni === 'guasto') return risposta(false, { error: { message: 'upstream error' } }, 503);
          if (rispostaDecisioni === 'rete') throw new TypeError('fetch failed');
          const answers = {};
          for (const [nome, q] of Object.entries(body.questions || {})) {
            const t = String(q.instructions || '');
            const p = /crocetta/.test(t) ? 0.97 : /chiudere non risponde/.test(t) ? 0.88 : /bottone di chiusura/.test(t) ? 0.71 : 0.04;
            answers[nome] = { type: 'noul', noul: p };
          }
          return risposta(true, { model: body.model, answers, usage: { input_tokens: 300, output_tokens: 0, cost: 0.00002 } });
        } finally { g.inVolo--; }
      }
      if (u.includes('openrouter.ai/api/v1/chat/completions')) {
        const body = JSON.parse(init.body || '{}');
        // Solo le chiamate della ricerca: l'app ne fa altre per conto suo (la home, per esempio).
        if (JSON.stringify(body.messages || []).includes('motore di ricerca semantica')) g.chat.push(body.model);
        const content = JSON.stringify([{ id: 'fb-23', reason: 'dal modello' }, { id: 'fb-7', reason: 'dal modello' }]);
        return risposta(true, { id: 'x', model: body.model, choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
      }
      return risposta(false, {}, 503);
    };
    req(path.join(electron.app.getAppPath(), 'src/main/services/supportModelsStore.js')).invalidaCache();
    await globalThis.SN_HANDLE_MESSAGE({
      type: 'update_settings', settings: { apiKeys: { openrouter: 'sk-owner' }, openWeightsOnly },
    }, { url: 'filo://options/options.html' });
  }, { supportDoc, rispostaDecisioni, openWeightsOnly, latenza });
}

async function cerca(page, testo, n) {
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), feedbacks(n));
  await page.click('#mgSearchToggle');
  await page.fill('#mgSearchInput', testo);
  await page.press('#mgSearchInput', 'Enter');
}

test('il classificatore legge tutti i feedback in parallelo e mostra quelli giusti, dal più probabile', async ({ app, openTab }) => {
  await preparaOwner(app, { supportDoc: { manageSearchClassifier: 'typesafe/jev-1.13' } });
  const page = await openTab(URL);
  await page.waitForFunction(() => window.filo && window.__mgTest);
  await cerca(page, 'quella volta che la x per chiudere non andava');

  // Mentre legge, la barra dice a che punto è.
  await expect(page.locator('#mgSearchProgress')).toBeVisible();
  await expect(page.locator('#mgSearchMsg')).toContainText(/Letti \d+ di 40/);

  await expect(page.locator('.mg-item--result')).toHaveCount(3, { timeout: 10000 });
  await expect(page.locator('#mgSearchProgress')).toBeHidden();
  const ordine = await page.locator('.mg-item--result').evaluateAll((els) => els.map((e) => e.dataset.id));
  expect(ordine).toEqual(['fb-7', 'fb-23', 'fb-31']);
  await expect(page.locator('.mg-item--result').first()).toHaveAttribute('title', /pertinenza 97%/);
  await expect(page.locator('#mgListHead')).toHaveText(/Ricerca.*3/);
  await expect(page.locator('#mgSearchMsg')).toHaveText('');

  const giro = await app.evaluate(() => {
    const g = globalThis.__g1118;
    const domande = g.decisioni.flatMap((b) => Object.values(b.questions || {}));
    return {
      richieste: g.decisioni.length, domande: domande.length, picco: g.picco, chat: g.chat.length,
      modello: g.decisioni[0] && g.decisioni[0].model, ricerca: g.decisioni[0] && g.decisioni[0].state && g.decisioni[0].state.ricerca,
      tipi: [...new Set(domande.map((q) => q.type))],
    };
  });
  expect(giro.domande).toBe(40);
  expect(giro.richieste).toBeGreaterThan(1);
  expect(giro.picco, 'le richieste partono insieme').toBeGreaterThan(1);
  expect(giro.modello).toBe('typesafe/jev-1.13');
  expect(giro.ricerca).toBe('quella volta che la x per chiudere non andava');
  expect(giro.tipi).toEqual(['noul']);
  expect(giro.chat, 'col classificatore che risponde il modello della ricerca non serve').toBe(0);

  // Il clic su un risultato apre il feedback giusto.
  await page.locator('.mg-item--result').nth(1).click();
  await expect(page.locator('#mgThread')).toContainText('Il tasto per chiudere non risponde.');
});

test('con il classificatore mai scelto la ricerca parte già con Jev', async ({ app, openTab }) => {
  await preparaOwner(app, { supportDoc: { manageSearch: 'vendor/testo' } });
  const page = await openTab(URL);
  await page.waitForFunction(() => window.filo && window.__mgTest);
  await cerca(page, 'quella volta che la x per chiudere non andava');
  await expect(page.locator('.mg-item--result')).toHaveCount(3, { timeout: 10000 });
  const g = await app.evaluate(() => ({ decisioni: globalThis.__g1118.decisioni, chat: globalThis.__g1118.chat }));
  expect(g.decisioni.length).toBeGreaterThan(0);
  expect(g.decisioni[0].model).toBe('typesafe/jev-1.13');
  expect(g.chat).toEqual([]);
});

test('classificatore che non risponde: li ordina il modello della ricerca, e la pagina lo dice', async ({ app, openTab }) => {
  await preparaOwner(app, {
    supportDoc: { manageSearchClassifier: 'vendor/non-classifica', manageSearch: 'vendor/testo' },
    rispostaDecisioni: 'rifiuta',
  });
  const page = await openTab(URL);
  await page.waitForFunction(() => window.filo && window.__mgTest);
  await cerca(page, 'il tasto chiudi');

  await expect(page.locator('.mg-item--result')).toHaveCount(2, { timeout: 10000 });
  const ordine = await page.locator('.mg-item--result').evaluateAll((els) => els.map((e) => e.dataset.id));
  expect(ordine).toEqual(['fb-23', 'fb-7']);
  await expect(page.locator('#mgSearchMsg')).toContainText('Classificatore:');
  await expect(page.locator('#mgSearchMsg')).toContainText('Li ha ordinati il modello della ricerca.');
  const chat = await app.evaluate(() => globalThis.__g1118.chat);
  expect(chat).toEqual(['vendor/testo']);
});

for (const guasto of ['guasto', 'rete']) {
  test(`classificatore giù (${guasto}): i risultati del modello arrivano subito, senza aspettare i tentativi`, async ({ app, openTab }) => {
    await preparaOwner(app, {
      supportDoc: { manageSearchClassifier: 'typesafe/jev-1.13', manageSearch: 'vendor/testo' },
      rispostaDecisioni: guasto,
    });
    const page = await openTab(URL);
    await page.waitForFunction(() => window.filo && window.__mgTest);
    const t0 = Date.now();
    await cerca(page, 'il tasto chiudi');
    await expect(page.locator('.mg-item--result')).toHaveCount(2, { timeout: 10000 });
    const secondi = (Date.now() - t0) / 1000;
    expect(secondi, `risultati dopo ${secondi.toFixed(1)} s`).toBeLessThan(4);
    await expect(page.locator('#mgSearchMsg')).toContainText('Classificatore:');
    await expect(page.locator('#mgSearchMsg')).toContainText('Li ha ordinati il modello della ricerca.');
  });
}

for (const [intoppo, rispostaDecisioni] of [
  ['troppe richieste alla prima ondata', 'piano'],
  ['troppe richieste per due secondi, con attesa chiesta di due secondi', 'piano-2s'],
  ['troppe richieste per due secondi, senza attesa chiesta', 'piano-2s-muto'],
  ['una sola richiesta in errore prima delle altre', 'uno-giu'],
]) {
  test(`${intoppo}: si riprova, e i risultati li dà il classificatore`, async ({ app, openTab }) => {
    await preparaOwner(app, { supportDoc: { manageSearchClassifier: 'typesafe/jev-1.13', manageSearch: 'vendor/testo' }, rispostaDecisioni });
    const page = await openTab(URL);
    await page.waitForFunction(() => window.filo && window.__mgTest);
    await cerca(page, 'la x per chiudere');
    await expect(page.locator('#mgSearchProgress')).toBeHidden({ timeout: 20000 });
    const ordine = await page.locator('.mg-item--result').evaluateAll((els) => els.map((e) => e.dataset.id));
    expect(ordine).toEqual(['fb-7', 'fb-23', 'fb-31']);
    await expect(page.locator('#mgSearchMsg')).toHaveText('');
    expect(await app.evaluate(() => globalThis.__g1118.chat)).toEqual([]);
  });
}

// Con i feedback veri dell'owner (centinaia) le domande non partono tutte nella prima ondata: è lì che si vede se il
// parallelismo torna dopo una raffica di rifiuti, e se un servizio che rifiuta sempre lascia la pagina ferma.
test('troppe richieste per due secondi su 800 feedback: passata la raffica si torna a leggere in parallelo', async ({ app, openTab }) => {
  await preparaOwner(app, { supportDoc: { manageSearchClassifier: 'typesafe/jev-1.13', manageSearch: 'vendor/testo' }, rispostaDecisioni: 'piano-2s-muto', latenza: 400 });
  const page = await openTab(URL);
  await page.waitForFunction(() => window.filo && window.__mgTest);
  await cerca(page, 'la x per chiudere', 800);
  await expect(page.locator('#mgSearchProgress')).toBeHidden({ timeout: 30000 });
  await expect(page.locator('.mg-item--result')).toHaveCount(3);
  await expect(page.locator('#mgSearchMsg')).toHaveText('');
  const g = await app.evaluate(() => ({ piccoTardi: globalThis.__g1118.piccoTardi, chat: globalThis.__g1118.chat }));
  expect(g.piccoTardi, 'dopo la raffica le domande tornano a partire insieme').toBeGreaterThanOrEqual(6);
  expect(g.chat).toEqual([]);
});

test('troppe richieste di continuo su 800 feedback: si ripiega sul modello in pochi secondi, non in minuti', async ({ app, openTab }) => {
  await preparaOwner(app, { supportDoc: { manageSearchClassifier: 'typesafe/jev-1.13', manageSearch: 'vendor/testo' }, rispostaDecisioni: 'sempre429', latenza: 400 });
  const page = await openTab(URL);
  await page.waitForFunction(() => window.filo && window.__mgTest);
  const t0 = Date.now();
  await cerca(page, 'la x per chiudere', 800);
  await expect(page.locator('.mg-item--result').first()).toBeVisible({ timeout: 25000 });
  const secondi = (Date.now() - t0) / 1000;
  expect(secondi, `risultati dopo ${secondi.toFixed(1)} s`).toBeLessThan(20);
  await expect(page.locator('#mgSearchMsg')).toContainText('Classificatore:');
  await expect(page.locator('#mgSearchMsg')).toContainText('Li ha ordinati il modello della ricerca.');
  const g = await app.evaluate(() => ({ decisioni: globalThis.__g1118.decisioni.length, chat: globalThis.__g1118.chat }));
  expect(g.decisioni, 'oltre la prima ondata non si rifà la scala di attese per ogni domanda').toBeLessThan(60);
  expect(g.chat).toEqual(['vendor/testo']);
});

// #814.7: dalle quattro cifre il conto della lettura prende il punto delle migliaia, come ogni numero di Filo.
test('con migliaia di feedback il conto della lettura scrive i numeri col punto delle migliaia', async ({ app, openTab }) => {
  await preparaOwner(app, { supportDoc: { manageSearchClassifier: 'typesafe/jev-1.13' } });
  const page = await openTab(URL);
  await page.waitForFunction(() => window.filo && window.__mgTest);
  await cerca(page, 'la x per chiudere', 1200);
  await expect(page.locator('#mgSearchMsg')).toHaveText(/^Letti (\d{1,3}|1\.\d{3}) di 1\.200$/);
  await expect(page.locator('.mg-item--result')).toHaveCount(3, { timeout: 20000 });
  await expect(page.locator('#mgSearchProgress')).toBeHidden();
});

test('con «solo modelli a pesi aperti» il classificatore resta spento e la ricerca funziona lo stesso', async ({ app, openTab }) => {
  await preparaOwner(app, {
    supportDoc: { manageSearchClassifier: 'typesafe/jev-1.13', manageSearch: 'deepseek/deepseek-v4-flash' },
    openWeightsOnly: true,
  });
  const page = await openTab(URL);
  await page.waitForFunction(() => window.filo && window.__mgTest);
  await cerca(page, 'il tasto chiudi');

  await expect(page.locator('.mg-item--result')).toHaveCount(2, { timeout: 10000 });
  await expect(page.locator('#mgSearchMsg')).toContainText('pesi aperti');
  const g = await app.evaluate(() => ({ decisioni: globalThis.__g1118.decisioni.length, chat: globalThis.__g1118.chat }));
  expect(g.decisioni, 'un modello proprietario non parte con l\'interruttore acceso').toBe(0);
  expect(g.chat).toEqual(['deepseek/deepseek-v4-flash']);
});

test('una ricerca nuova ferma il giro di quella prima, e chiudere la ricerca ferma il suo', async ({ app, openTab }) => {
  await preparaOwner(app, { supportDoc: { manageSearchClassifier: 'typesafe/jev-1.13' } });
  const page = await openTab(URL);
  await page.waitForFunction(() => window.filo && window.__mgTest);
  const tanti = [];
  for (let i = 0; i < 400; i++) tanti.push({ _id: `fb-${i}`, name: `Altro ${i}`, text: `niente ${i}`, seq: i + 1, subSeq: 0, status: 'new', clientId: 't@example.com', createdAt: '2026-06-03T10:00:00Z', images: [] });
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), tanti);
  const perRicerca = (q) => app.evaluate((_e, x) => globalThis.__g1118.decisioni.filter((b) => b.state && b.state.ricerca === x).length, q);

  await page.click('#mgSearchToggle');
  await page.fill('#mgSearchInput', 'prima ricerca');
  await page.press('#mgSearchInput', 'Enter');
  await expect(page.locator('#mgSearchProgress')).toBeVisible();
  await page.fill('#mgSearchInput', 'seconda ricerca');
  await page.press('#mgSearchInput', 'Enter');
  await expect.poll(() => perRicerca('seconda ricerca')).toBeGreaterThan(0);
  const prima = await perRicerca('prima ricerca');
  expect(prima, 'la prima ricerca non arriva in fondo: 400 feedback sono 25 richieste').toBeLessThan(25);

  // Chiusa la ricerca a metà, il main smette di mandare richieste.
  await page.click('#mgSearchClose');
  await expect(page.locator('#mgSearchProgress')).toBeHidden();
  await page.waitForTimeout(400);
  const dopoChiusura = await perRicerca('seconda ricerca');
  await page.waitForTimeout(800);
  expect(await perRicerca('seconda ricerca')).toBe(dopoChiusura);
  expect(dopoChiusura).toBeLessThan(25);
  expect(await perRicerca('prima ricerca')).toBe(prima);
});

test('il classificatore si sceglie in Modelli di supporto e la scelta si salva', async ({ app, openTab }) => {
  await preparaOwner(app, { supportDoc: { judge1: 'flash' } });
  const page = await openTab(URL);
  await page.waitForFunction(() => window.filo && window.__mgTest);
  await apriScheda(page, 'automation');
  await expect(page.locator('#mgSmEditor')).toBeVisible({ timeout: 8000 });
  const slot = page.locator('.mg-sm-slot[data-slot="manageSearchClassifier"]');
  await expect(slot.locator('label')).toHaveText('Classificatore della ricerca');
  const campo = slot.locator('.sn-chain-input').first();
  // Mai scelto: mostra quello che la ricerca usa già.
  await expect(campo).toHaveValue('typesafe/jev-1.13');
  await campo.fill('typesafe/jev-1.13-20260917');
  await campo.press('Tab');
  await page.click('#mgSmSaveBtn');
  await expect(page.locator('#mgSmStatus')).toHaveText('Salvato.', { timeout: 5000 });
  const salvato = await app.evaluate(() => {
    const f = globalThis.__g1118.docs['config/supportModels'].fields.manageSearchClassifier;
    return f && f.stringValue;
  });
  expect(salvato).toBe('typesafe/jev-1.13-20260917');
});
