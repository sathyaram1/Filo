// #1166 — le foto mandate in chat restano davanti al modello ai messaggi dopo, attaccate al loro messaggio. Un modello
// che non le prende non blocca la conversazione, e quando non tornano più una nota dice che c'erano.
// Il modello è finto: si guarda cosa gli arriva e cosa vede l'utente.

import { test, expect } from './fixtures/electron.mjs';

async function preparaModello(app, copione, { rifiuta = null } = {}) {
  await app.evaluate(async (_e, { copione, rifiuta }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__copione = copione.slice();
    globalThis.__chiamate = [];
    globalThis.__rifiutate = 0;
    const foto = (messages) => messages.reduce((n, m) => n + (Array.isArray(m.content) ? m.content.filter((p) => p && p.type === 'image_url').length : 0), 0);
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const chat = String((messages[0] && messages[0].content) || '').startsWith('Sei Filo, un assistente personale.');
      if (!chat) return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      // Come i fornitori veri: un modello di solo testo, o uno che regge al più una foto per richiesta.
      if (rifiuta === 'testo' && foto(messages) > 0) {
        globalThis.__rifiutate++;
        const err = new Error('OpenRouter 404: {"error":{"message":"No endpoints found that support image input","code":404}}');
        err.status = 404;
        throw err;
      }
      if (rifiuta === 'una' && foto(messages) > 1) {
        globalThis.__rifiutate++;
        const err = new Error('OpenRouter 400: {"error":{"message":"At most 1 image(s) may be provided in one request."}}');
        err.status = 400;
        throw err;
      }
      globalThis.__chiamate.push(JSON.parse(JSON.stringify(messages)));
      const r = globalThis.__copione.shift() || { text: 'ok' };
      try { onDelta && onDelta(r.text); } catch (_) {}
      return { ...base, text: r.text, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, { copione, rifiuta });
}

async function apriHome(openTab) {
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeVisible({ timeout: 10_000 });
  return home;
}

// Foto vere, fatte da un canvas e incollate come dagli appunti.
async function incollaFoto(home, colori) {
  await home.evaluate(async (colori) => {
    const dt = new DataTransfer();
    for (const [i, c] of colori.entries()) {
      const cv = new OffscreenCanvas(16, 16);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 16, 16);
      const blob = await cv.convertToBlob({ type: 'image/png' });
      dt.items.add(new File([blob], `foto${i}.png`, { type: 'image/png' }));
    }
    document.getElementById('inputForm').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, colori);
  await expect(home.locator('#imgPreviews .dash-img-preview img')).toHaveCount(colori.length, { timeout: 5000 });
}

async function scrivi(home, testo) {
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  await home.locator('#input').fill(testo);
  await home.locator('#sendBtn').click();
}

const chiamate = (app) => app.evaluate(() => globalThis.__chiamate);
const testo = (m) => (typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n'));
const fotoDi = (m) => (Array.isArray(m.content) ? m.content.filter((p) => p.type === 'image_url').map((p) => p.image_url.url) : []);
// La domanda di adesso (SPEC-CONTESTO fase 3): l'ultimo messaggio dell'utente con l'ora e la chat in testa.
const INTESTAZIONE = /^\[\w{3} \d+ \w{3} \d{4}, \d\d:\d\d · chat \w{4}\]/;
const posDomanda = (msgs) => {
  for (let i = msgs.length - 1; i > 0; i--) if (msgs[i].role === 'user' && INTESTAZIONE.test(typeof msgs[i].content === 'string' ? msgs[i].content : ((msgs[i].content || [])[0] || {}).text || '')) return i;
  return -1;
};

test('le foto mandate in chat il modello le ha ancora davanti al messaggio dopo, e a quello dopo ancora', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await preparaModello(app, [
    { text: 'Vedo farina, uova e un barattolo di ceci.' },
    { text: 'Con i ceci della seconda foto ci fai un hummus.' },
    { text: 'Le uova della prima bastano per una frittata.' },
  ]);
  const home = await apriHome(openTab);
  await incollaFoto(home, ['#c0392b', '#2e86c1']);
  await scrivi(home, 'cosa c’è nella mia dispensa?');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Vedo farina' })).toBeVisible({ timeout: 15_000 });
  await scrivi(home, 'e con i ceci cosa ci faccio?');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'hummus' })).toBeVisible({ timeout: 15_000 });
  await scrivi(home, 'e con le uova?');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'frittata' })).toBeVisible({ timeout: 15_000 });

  const [primo, secondo, terzo] = await chiamate(app);
  const mandate = fotoDi(primo[primo.length - 1]);
  expect(mandate).toHaveLength(2);
  expect(mandate[0]).toMatch(/^data:image\/png;base64,/);

  // Al secondo turno le due foto stanno sul messaggio che le portava, prima della domanda nuova.
  const conFoto = secondo.filter((m) => fotoDi(m).length);
  expect(conFoto).toHaveLength(1);
  expect(testo(conFoto[0])).toContain('cosa c’è nella mia dispensa?');
  expect(fotoDi(conFoto[0])).toEqual(mandate);
  expect(secondo.indexOf(conFoto[0])).toBeLessThan(posDomanda(secondo));
  const domanda = testo(secondo[secondo.length - 1]);
  expect(domanda).toMatch(/^\[[^\]]+\] e con i ceci cosa ci faccio\?/);
  // L'esito delle etichette d'origine viaggia ancora, e non dice più che le immagini non arrivano.
  expect(domanda).toContain('etichette di origine');
  expect(domanda).not.toContain('non ti arrivano');
  expect(JSON.stringify(secondo)).not.toContain('non hai più davanti');

  // Al terzo ci sono ancora, e quello che il secondo turno aveva davanti è rimasto identico: la cache lo riusa.
  const n = posDomanda(secondo) + 1;
  expect(JSON.stringify(terzo.slice(0, n))).toBe(JSON.stringify(secondo.slice(0, n)));
  expect(terzo.filter((m) => fotoDi(m).length).flatMap(fotoDi)).toEqual(mandate);
});

test('un modello di solo testo non blocca la conversazione dopo una foto: le foto lasciano la nota', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await preparaModello(app, [
    { text: 'Con i ceci ci fai un hummus.' },
    { text: 'Anche una zuppa.' },
  ], { rifiuta: 'testo' });
  const home = await apriHome(openTab);
  await incollaFoto(home, ['#c0392b']);
  await scrivi(home, 'cosa c’è qui?');
  // La foto il modello non la prende: quel turno non può riuscire, e l'utente lo vede.
  await expect.poll(() => app.evaluate(() => globalThis.__rifiutate), { timeout: 15_000 }).toBeGreaterThan(0);

  await scrivi(home, 'va bene, dimmi una ricetta coi ceci');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'hummus' })).toBeVisible({ timeout: 15_000 });
  // Le chiamate rifiutate non si contano: questa è la prima riuscita.
  const [riuscita] = await chiamate(app);
  expect(JSON.stringify(riuscita)).not.toContain('image_url');
  const conNota = riuscita.find((m) => m.role === 'user' && testo(m).includes('cosa c’è qui?'));
  expect(testo(conNota)).toContain('un\'immagine che non hai più davanti');

  // Il rifiuto si ricorda: il messaggio dopo parte già senza foto, senza un tentativo a vuoto.
  const prima = await app.evaluate(() => globalThis.__rifiutate);
  await scrivi(home, 'e un\'altra?');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'zuppa' })).toBeVisible({ timeout: 15_000 });
  expect(await app.evaluate(() => globalThis.__rifiutate)).toBe(prima);
});

test('un modello che regge una foto per volta: la foto nuova arriva, quella di prima lascia la nota', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await preparaModello(app, [
    { text: 'Una scatola di ceci.' },
    { text: 'Un pacco di farina.' },
  ], { rifiuta: 'una' });
  const home = await apriHome(openTab);
  await incollaFoto(home, ['#c0392b']);
  await scrivi(home, 'cos’è questa?');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'ceci' })).toBeVisible({ timeout: 15_000 });
  await incollaFoto(home, ['#2e86c1']);
  await scrivi(home, 'e questa?');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'farina' })).toBeVisible({ timeout: 15_000 });

  const [, secondo] = await chiamate(app);
  expect(fotoDi(secondo[secondo.length - 1])).toHaveLength(1);
  expect(secondo.slice(0, -1).some((m) => fotoDi(m).length)).toBe(false);
  expect(testo(secondo.find((m) => testo(m).includes('cos’è questa?')))).toContain('un\'immagine che non hai più davanti');
});

test('foto non più in memoria (Filo riaperto): al loro posto il modello legge che c\'erano', async ({ app }) => {
  test.setTimeout(60_000);
  await preparaModello(app, [{ text: 'Tre etichette: farina, riso, ceci.' }, { text: 'Le avevo lette dalle foto.' }]);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await app.evaluate(async (_e, png) => {
    await globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'leggi le etichette', threadHistory: [], chatId: 'c-foto', images: [png, png, png] });
    // Quello che una riapertura di Filo perde: le immagini stanno solo in memoria.
    globalThis.SN_CONTESTO_FILO.dimentica('c-foto');
    await globalThis.SN_HANDLE_FILO_CHAT({
      userMessage: 'erano giuste?', chatId: 'c-foto',
      threadHistory: [{ role: 'user', text: 'leggi le etichette', images: 3 }, { role: 'filo', text: 'Tre etichette: farina, riso, ceci.' }],
    });
  }, png);
  const [, secondo] = await chiamate(app);
  expect(JSON.stringify(secondo)).not.toContain('data:image');
  const u = secondo.find((m) => m.role === 'user' && testo(m).includes('leggi le etichette'));
  expect(testo(u)).toContain('3 immagini che non hai più davanti: quello che ne hai scritto dopo l\'avevi letto da lì');
});

test('le foto di una chat in incognito se ne vanno con l\'incognito, quelle delle altre chat restano', async ({ app }) => {
  test.setTimeout(60_000);
  await preparaModello(app, []);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const n = await app.evaluate(async (_e, png) => {
    const S = globalThis.__filoStorage;
    const chat = (chatId, userMessage, images) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage, threadHistory: [], chatId, ...(images ? { images } : {}) });
    await chat('c-normale', 'guarda questa', [png]);
    await S.runIncognito(() => chat('c-segreta', 'e questa?', [png]));
    // Quello che fa la chiusura dell'ultima finestra in incognito, prima di buttare il suo filo.
    globalThis.SN_CONTESTO_FILO.dimenticaIncognito();
    const prima = globalThis.__chiamate.length;
    await S.runIncognito(() => chat('c-segreta', 'cosa c\'era?'));
    await chat('c-normale', 'e adesso?');
    return prima;
  }, png);
  const [segreta, normale] = (await chiamate(app)).slice(n);
  expect(JSON.stringify(segreta)).not.toContain('data:image');
  expect(testo(segreta.find((m) => testo(m).includes('e questa?')))).toContain('un\'immagine che non hai più davanti');
  expect(normale.filter((m) => fotoDi(m).length).flatMap(fotoDi)).toEqual([png]);
});

test('la chat riaperta con Filo ancora acceso mostra le foto che il modello ha ancora davanti', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await preparaModello(app, [{ text: 'Vedo ceci e farina.' }, { text: 'Ancora ceci.' }]);
  const home = await apriHome(openTab);
  await incollaFoto(home, ['#c0392b', '#2e86c1']);
  await scrivi(home, 'cosa vedi?');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Vedo ceci' })).toBeVisible({ timeout: 15_000 });
  const [primo] = await chiamate(app);
  const mandate = fotoDi(primo[primo.length - 1]);
  const id = await app.evaluate(async () => (await globalThis.SN_FILO_CHATS.list()).map((c) => c.id).find(Boolean));
  // La stessa chat riaperta (dalla Cronologia, o la home ricaricata).
  await home.goto(`filo://newtab/?chat=${encodeURIComponent(id)}`);
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Vedo ceci' })).toBeVisible({ timeout: 15_000 });
  const viste = home.locator('.dash-bubble-user img.dash-bubble-img');
  await expect(viste).toHaveCount(2);
  expect(await viste.evaluateAll((els) => els.map((e) => e.getAttribute('src')))).toEqual(mandate);
  await expect(home.locator('.dash-bubble-note', { hasText: 'non conservat' })).toHaveCount(0);
  await scrivi(home, 'e adesso?');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Ancora' })).toBeVisible({ timeout: 15_000 });
  const [, secondo] = await chiamate(app);
  expect(secondo.filter((m) => fotoDi(m).length).flatMap(fotoDi)).toEqual(mandate);

  // Tolte dalla memoria (Filo riaperto), la chat torna a dire quante erano.
  await app.evaluate((_e, id) => globalThis.SN_CONTESTO_FILO.dimentica(id), id);
  await home.goto(`filo://newtab/?chat=${encodeURIComponent(id)}`);
  await expect(home.locator('.dash-bubble-note', { hasText: '2 immagini, non conservate' })).toBeVisible({ timeout: 15_000 });
  await expect(viste).toHaveCount(0);
});
