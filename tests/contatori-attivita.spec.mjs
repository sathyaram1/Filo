// I contatori delle attività (#1467) nell'app vera: una sessione dell'Aiuto si conta alla chiusura coi suoi passi e le
// sue ricerche web (il ripiego di Tavily e il tetto compresi), una dettatura con quello che è successo al testo, le
// lezioni, il riordino e le righe tolte e rimesse dal quaderno, un giro di pulizia e la scheda riaperta, la home senza
// modello e il suggerimento usato. Mai il testo: le chiavi sono nomi da elenchi chiusi. Forma e regole: tests/unit/.

import { test, expect } from './fixtures/electron.mjs';

// Le ore di oggi sommate, per misura delle attività.
const oggi = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const C = globalThis.SN_CONTATORI;
  const g = C.giornoDi(Date.now());
  const out = Object.fromEntries(C.MISURE_ATTIVITA.map((m) => [m, {}]));
  for (const [k, ora] of Object.entries(s.ore || {})) {
    if (!k.startsWith(`${g}T`)) continue;
    for (const m of C.MISURE_ATTIVITA) for (const [c, n] of Object.entries(ora[m] || {})) out[m][c] = (out[m][c] || 0) + n;
  }
  return out;
});
const misura = async (app, m) => (await oggi(app))[m];
const tutteLeChiavi = async (app) => Object.values(await oggi(app)).flatMap((x) => Object.keys(x)).join('\n');

async function trovaPagina(app, prova, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina non trovata');
}

// ── L'Aiuto e le sue ricerche web ─────────────────────────────────────────
// Il modello dell'Aiuto, finto nella pagina: alla domanda chiede tre ricerche di fila (la terza oltre il tetto di due),
// poi risponde e chiude. Le ricerche vanno al main vero: Tavily risponde 500, DuckDuckGo due risultati.
async function aiutoFinto(page) {
  await page.evaluate(() => {
    window.__turni = 0;
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, ...rest) => {
      if (msg && msg.type === 'ai_request') {
        window.__turni += 1;
        if (window.__turni <= 3) return Promise.resolve({ ok: true, text: `{"action":"web_search","query":"come si disdice ${window.__turni}"}` });
        return Promise.resolve({ ok: true, text: '{"text":"Ecco come si fa.","status":"done"}' });
      }
      if (msg && msg.type === 'capture_visible_tab') return Promise.resolve({ ok: false });
      return orig(msg, ...rest);
    };
  });
}
async function ricercheFinte(app) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { tavily: 'tv-prova' } });
    const vero = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.startsWith('https://api.tavily.com/')) return new Response('giù', { status: 500 });
      if (u.startsWith('https://html.duckduckgo.com/')) {
        const voce = (n) => `<a rel="nofollow" class="result__a" href="https://esempio.it/${n}">Guida ${n}</a><a class="result__snippet" href="x">passo ${n}</a>`;
        return new Response(`<html><body>${voce(1)}${voce(2)}</body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      return vero(url, init);
    };
  });
}

test('l’Aiuto chiuso conta la sessione: com’è finita e i passi da solo; le sue ricerche contano il ripiego e il tetto', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await ricercheFinte(app);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => typeof window.SN_SIDEBAR?.open === 'function', null, { timeout: 8000 });
  await aiutoFinto(page);
  await page.evaluate(() => window.SN_SIDEBAR.open());
  await page.fill('.sn-sidebar-input textarea', 'come disdico l\'abbonamento?');
  await page.press('.sn-sidebar-input textarea', 'Enter');
  // La risposta arriva a schermo: la persona legge e chiude.
  await expect(page.locator('.sn-sidebar-conv')).toContainText('Ecco come si fa.', { timeout: 20_000 });
  await expect(page.locator('.sn-sidebar-conv')).toContainText('ricerca web: limite raggiunto');
  // Aperta, non è ancora una sessione finita.
  expect(await misura(app, 'aiuto')).toEqual({});
  await page.locator('.sn-sidebar-close').click();
  await expect(page.locator('.sn-sidebar')).toHaveCount(0);

  // Tre turni fatti da solo dopo la domanda (le due ricerche e il tetto), nessun clic, niente da trovare.
  await expect.poll(() => misura(app, 'aiuto'), { timeout: 5_000 }).toEqual({ 'fatto|p2_5|p0|n0|n0': 1 });
  // Le due ricerche partite: Tavily giù, ha risposto DuckDuckGo; la terza, oltre il tetto, è il tetto.
  expect(await misura(app, 'ricercaWeb')).toEqual({ 'aiuto|duckduckgo|si|r1_2': 2, 'aiuto|al_tetto': 1 });
  const chiavi = await tutteLeChiavi(app);
  expect(chiavi).not.toMatch(/disdic|esempio\.it|Guida/);

  // Riaperta e chiusa senza chiedere niente: una sessione lasciata prima.
  await page.evaluate(() => window.SN_SIDEBAR.open());
  await page.locator('.sn-sidebar-close').click();
  await expect.poll(() => misura(app, 'aiuto'), { timeout: 5_000 }).toEqual({ 'fatto|p2_5|p0|n0|n0': 1, 'chiusa_prima|p0|p0|n0|n0': 1 });
});

// Chiudere una scheda non dà alla pagina nessun evento: la sessione aperta la conta il main, com'era.
const chiudiScheda = (app, url) => app.evaluate(({ BrowserWindow }, u) => {
  const tm = BrowserWindow.getAllWindows().find((w) => !w._filoIncognito && w._filoTabs)._filoTabs;
  tm.closeTab(tm.tabs.find((t) => t.url === u).id);
}, url);

test('l’Aiuto aperto su una scheda che si chiude conta la sessione, una volta', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const url = 'filo://newtab/?prova=aiuto-chiusa';
  const page = await openTab(url);
  await page.waitForFunction(() => typeof window.SN_SIDEBAR?.open === 'function', null, { timeout: 8000 });
  await page.evaluate(() => {
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, ...rest) => {
      if (msg && msg.type === 'ai_request') return Promise.resolve({ ok: true, text: '{"text":"Ecco come si fa.","status":"done"}' });
      if (msg && msg.type === 'capture_visible_tab') return Promise.resolve({ ok: false });
      return orig(msg, ...rest);
    };
  });
  await page.evaluate(() => window.SN_SIDEBAR.open());
  await page.fill('.sn-sidebar-input textarea', 'come disdico l\'abbonamento?');
  await page.press('.sn-sidebar-input textarea', 'Enter');
  await expect(page.locator('.sn-sidebar-conv')).toContainText('Ecco come si fa.', { timeout: 20_000 });
  expect(await misura(app, 'aiuto')).toEqual({});
  await chiudiScheda(app, url);
  await expect.poll(() => misura(app, 'aiuto'), { timeout: 8_000 }).toEqual({ 'fatto|p0|p0|n0|n0': 1 });
  await new Promise((r) => setTimeout(r, 500));
  expect(await misura(app, 'aiuto')).toEqual({ 'fatto|p0|p0|n0|n0': 1 });
});

test('l’Aiuto in una finestra in incognito non conta sessioni né ricerche', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await ricercheFinte(app);
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs)), { timeout: 15_000 }).toBe(true);
  // Una home sua, con un indirizzo che la distingue da quella della finestra normale.
  const url = 'filo://newtab/?prova=incognito';
  await app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows().find((w) => w._filoIncognito)._filoTabs.openTab(u), url);
  const incog = await trovaPagina(app, (u) => u === url, 15_000);
  await incog.waitForFunction(() => typeof window.SN_SIDEBAR?.open === 'function', null, { timeout: 10_000 });
  await aiutoFinto(incog);
  await incog.evaluate(() => window.SN_SIDEBAR.open());
  await incog.fill('.sn-sidebar-input textarea', 'come disdico?');
  await incog.press('.sn-sidebar-input textarea', 'Enter');
  await expect(incog.locator('.sn-sidebar-conv')).toContainText('Ecco come si fa.', { timeout: 20_000 });
  await incog.locator('.sn-sidebar-close').click();
  await new Promise((r) => setTimeout(r, 800));
  expect(await misura(app, 'aiuto')).toEqual({});
  expect(await misura(app, 'ricercaWeb')).toEqual({});
});

// ── La dettatura ─────────────────────────────────────────────────────────
const DETTO = 'che tempo fa domani a Lisbona';
async function vocePronta(app, { autoSend = true } = {}) {
  await app.evaluate(async (_e, { detto, autoSend }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      dictation: { autoSend },
    });
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async () => ({ text: ` ${detto} `, usage: { seconds: 1, costUsd: 0.00001 }, generationId: null });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      try { onDelta && onDelta('Domani c\'è il sole.'); } catch (_) {}
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: 'Domani c\'è il sole.', toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, { detto: DETTO, autoSend });
}
async function microfonoFinto(page) {
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      osc.frequency.value = 220;
      const gain = ac.createGain();
      gain.gain.value = 0.4;
      const dest = ac.createMediaStreamDestination();
      osc.connect(gain); gain.connect(dest); osc.start();
      try { await ac.resume(); } catch (_) {}
      window.__mic = { gain };
      return dest.stream;
    };
  });
}
async function parla(page, mic) {
  await page.evaluate(() => { if (window.__mic) window.__mic.gain.gain.value = 0.4; });
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__mic.gain.gain.value = 0; });
}

test('una dettatura in chat si conta quando il testo parte: da solo, mandato com’era o corretto prima, mai le parole', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await vocePronta(app);
  const page = await trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito'));
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  await microfonoFinto(page);
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  const chiavi = async () => Object.keys(await misura(app, 'dettatura'));

  // Parte da sola dopo l'attimo per annullare.
  await mic.click();
  await parla(page, mic);
  await expect(page.locator('.dash-bubble-user', { hasText: DETTO })).toBeVisible({ timeout: 15_000 });
  await expect.poll(chiavi, { timeout: 5_000 }).toHaveLength(1);
  expect((await chiavi())[0]).toMatch(/^(finito|utente)\|f(1|2_5)\|da_sola\|no$/);

  // Fermata nell'attimo: il testo resta, e non si conta finché non parte. Mandato com'era, è «a mano».
  await mic.click();
  await parla(page, mic);
  await expect(mic).toHaveAttribute('data-stato', 'attesa', { timeout: 10_000 });
  await mic.click();
  await expect(page.locator('#input')).toHaveValue(DETTO);
  await page.waitForTimeout(500);
  expect(await chiavi()).toHaveLength(1);
  await page.locator('#input').press('Enter');
  await expect.poll(async () => (await chiavi()).some((k) => /\|a_mano\|no$/.test(k)), { timeout: 5_000 }).toBe(true);

  // Esc mentre ascolta tiene il testo; corretto e poi mandato è «cambiata».
  await expect(page.locator('#input')).toHaveValue('', { timeout: 10_000 });
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  await page.waitForTimeout(1500);
  await page.locator('#input').press('Escape');
  await expect(page.locator('#input')).toHaveValue(DETTO, { timeout: 10_000 });
  await page.locator('#input').fill(`${DETTO}, in Portogallo`);
  await page.locator('#input').press('Enter');
  await expect.poll(async () => (await chiavi()).some((k) => /^utente\|f(1|2_5)\|cambiata\|no$/.test(k)), { timeout: 5_000 }).toBe(true);
  expect(Object.values(await misura(app, 'dettatura')).reduce((a, n) => a + n, 0)).toBe(3);
  expect(await tutteLeChiavi(app)).not.toMatch(/Lisbona|tempo fa|Portogallo/);
});

test('col «manda da solo» spento, la trascrizione corretta a mano e poi inviata si conta «cambiata»', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await vocePronta(app, { autoSend: false });
  const page = await trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito'));
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  await microfonoFinto(page);
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await mic.click();
  await parla(page, mic);
  await expect(page.locator('#input')).toHaveValue(DETTO, { timeout: 15_000 });
  await expect(mic).not.toHaveAttribute('data-stato', 'ascolta', { timeout: 10_000 });
  await page.locator('#input').fill(`${DETTO}, in Portogallo`);
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-user', { hasText: 'Portogallo' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => Object.keys(await misura(app, 'dettatura')), { timeout: 5_000 }).toEqual([expect.stringMatching(/\|cambiata\|no$/)]);
});

// Una pagina che se ne va nella stessa scheda (ricaricata, un'altra pagina) non chiude la scheda: la dettatura rimasta
// a metà la conta lei, subito e una volta. Il testo lasciato nella casella è «tenuta», quello che aspettava l'invio è «annullata».
test('una dettatura rimasta a metà si conta quando la pagina se ne va, anche ricaricata, una volta sola', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await vocePronta(app, { autoSend: false });
  const url = 'filo://newtab/?prova=dettatura-ricarica';
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  await microfonoFinto(page);
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await mic.click();
  await parla(page, mic);
  await expect(page.locator('#input')).toHaveValue(DETTO, { timeout: 15_000 });
  await expect(mic).not.toHaveAttribute('data-stato', 'ascolta', { timeout: 10_000 });
  expect(await misura(app, 'dettatura')).toEqual({});
  await page.reload();
  await expect.poll(async () => Object.keys(await misura(app, 'dettatura')), { timeout: 8_000 }).toEqual([expect.stringMatching(/\|tenuta\|no$/)]);

  // Col «manda da solo» acceso, la scheda chiusa mentre aspetta l'invio: il testo non parte, «annullata».
  await vocePronta(app, { autoSend: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  await microfonoFinto(page);
  await mic.click();
  await parla(page, mic);
  await expect(mic).toHaveAttribute('data-stato', 'attesa', { timeout: 10_000 });
  await chiudiScheda(app, url);
  await expect.poll(async () => Object.values(await misura(app, 'dettatura')).reduce((a, n) => a + n, 0), { timeout: 8_000 }).toBe(2);
  expect(Object.keys(await misura(app, 'dettatura')).filter((k) => /\|annullata\|no$/.test(k))).toHaveLength(1);
  await new Promise((r) => setTimeout(r, 500));
  expect(Object.values(await misura(app, 'dettatura')).reduce((a, n) => a + n, 0)).toBe(2);
});

// ── La lettura ad alta voce ──────────────────────────────────────────────
test('una lettura fermata conta la voce, il perché del ripiego e fin dove è arrivata', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => typeof window.SN_TTS?.readAloud === 'function', null, { timeout: 8000 });
  const TESTO = 'Il gatto dorme sul divano. Fuori piove da stamattina, e la casa è silenziosa.';

  // La voce del modello (l'audio di prova, muto): letta per un attimo e fermata.
  await app.evaluate(() => { globalThis.__filoTestTtsCanned = true; });
  await page.evaluate((t) => { window.SN_TTS.readAloud(t); }, TESTO);
  await expect.poll(() => page.evaluate(() => window.SN_TTS.ttsBusy()), { timeout: 8_000 }).toBe(true);
  await page.evaluate(() => window.SN_TTS.stopReading());
  await expect.poll(async () => Object.keys(await misura(app, 'lettura')), { timeout: 5_000 }).toHaveLength(1);
  expect(Object.keys(await misura(app, 'lettura'))[0]).toMatch(/^modello\|nessuno\|q(25|50|75|100)$/);

  // Senza un modello per la voce: il sistema legge, e si conta perché.
  await app.evaluate(async () => {
    globalThis.__filoTestTtsCanned = false;
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: '' } });
  });
  await page.evaluate((t) => { window.SN_TTS.readAloud(t); }, TESTO);
  await page.waitForTimeout(800);
  await page.evaluate(() => window.SN_TTS.stopReading());
  await expect.poll(async () => Object.keys(await misura(app, 'lettura')).filter((k) => k.startsWith('browser|')), { timeout: 5_000 }).toHaveLength(1);
  const ripiego = Object.keys(await misura(app, 'lettura')).find((k) => k.startsWith('browser|'));
  expect(ripiego.split('|')[1], 'il motivo del ripiego, dall’elenco').not.toBe('nessuno');
  expect(await tutteLeChiavi(app)).not.toMatch(/gatto|divano/);
});

test('una lettura in corso su una scheda che si chiude si conta, fin dove era arrivata', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const url = 'filo://newtab/?prova=lettura-chiusa';
  const page = await openTab(url);
  await page.waitForFunction(() => typeof window.SN_TTS?.readAloud === 'function', null, { timeout: 8000 });
  await app.evaluate(() => { globalThis.__filoTestTtsCanned = true; });
  await page.evaluate(() => { window.SN_TTS.readAloud('Il gatto dorme sul divano. Fuori piove da stamattina, e la casa è silenziosa.'); });
  await expect.poll(() => page.evaluate(() => window.SN_TTS.ttsBusy()), { timeout: 8_000 }).toBe(true);
  expect(await misura(app, 'lettura')).toEqual({});
  await chiudiScheda(app, url);
  await expect.poll(async () => Object.keys(await misura(app, 'lettura')), { timeout: 8_000 }).toEqual([expect.stringMatching(/^modello\|nessuno\|q(25|50|75|100)$/)]);
});

// ── Lezioni, riordino e quaderno ────────────────────────────────────────
async function memoriaFinta(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
        [C.ACTIONS.FILO_LESSON]: 'deepseek-flash', [C.ACTIONS.FILO_COMPACT]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const rispondi = async ({ attempts, messages }) => {
      const joined = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
      if (joined.includes('analizzare l\'ultima interazione')) {
        return { ...base, text: /UTENTE: [^\n]*vegetarian/i.test(joined) ? `LEZIONE: L’utente è vegetariano.\nLEZIONE: ${'x'.repeat(3000)}` : 'NULLA DA IMPARARE' };
      }
      if (joined.includes('integrare le nuove lezioni')) return { ...base, text: 'PREFERENZE:\nÈ vegetariano (fonti: L1)' };
      if (joined.includes('Classifichi le conversazioni')) return { ...base, text: JSON.stringify({ tipo: 'conversazione', titolo: 'Cibo' }) };
      return { ...base, text: 'Ne terrò conto.' };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = rispondi;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = rispondi;
  });
}
const turno = (app, chatId, userMessage) => app.evaluate(
  (_e, a) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: a.userMessage, threadHistory: [], chatId: a.chatId }),
  { chatId, userMessage },
);

test('le lezioni scritte e scartate, il riordino e le righe tolte e rimesse dal quaderno si contano senza il testo', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await memoriaFinta(app);
  await turno(app, 'chat-cibo', 'ciao, come va?');
  await expect.poll(() => misura(app, 'lezioni'), { timeout: 10_000 }).toEqual({ nulla: 1 });
  await turno(app, 'chat-cibo', 'sono vegetariano');
  // Una lezione scritta, una scartata dal tetto di lunghezza.
  await expect.poll(() => misura(app, 'lezioni'), { timeout: 10_000 }).toEqual({ nulla: 1, 'l1|l1': 1 });

  const page = await openTab('filo://quaderno/quaderno.html');
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'filo_compact_memory' }));
  await expect.poll(() => misura(app, 'compattazioni'), { timeout: 10_000 }).toEqual({ 'applicata|r0': 1 });
  const nota = page.locator('.qd-riga').filter({ has: page.locator('.qd-testo', { hasText: /^È vegetariano$/ }) });
  await expect(nota).toHaveCount(1, { timeout: 8_000 });
  await nota.hover();
  await nota.locator('.qd-tasto[title="Togli dalla memoria"]').click();
  await expect(page.locator('#esito')).toContainText('Tolta');
  await expect.poll(() => misura(app, 'memoria'), { timeout: 5_000 }).toEqual({ 'quaderno|togli|preferenze|giorno': 1 });
  const nascoste = page.locator('.qd-gruppo[data-gruppo="nascoste"]');
  await nascoste.locator('summary').click();
  await nota.hover();
  await nascoste.locator('.qd-tasto[title="Rimetti in memoria"]').click();
  await expect.poll(() => misura(app, 'memoria'), { timeout: 5_000 })
    .toEqual({ 'quaderno|togli|preferenze|giorno': 1, 'quaderno|ripristina|preferenze|giorno': 1 });
  expect(await tutteLeChiavi(app)).not.toMatch(/vegetarian/i);
});

// ── La pulizia delle schede e la scheda riaperta ─────────────────────────
test('un giro di pulizia conta candidate, chiuse e doppie; la scheda riaperta dice chi l’aveva chiusa e da quanto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const url = testServer.html('<title>Ricetta</title><p>La ricetta della pasta.</p>', { pubblico: true });
  await openTab(url);
  await openTab(url);
  const home = await openTab('filo://newtab/');
  const r = await home.evaluate(() => chrome.runtime.sendMessage({ type: 'run_tab_triage' }));
  expect(r.archived, 'la doppia si chiude per regola, anche senza un modello').toBeGreaterThanOrEqual(1);
  const giri = await misura(app, 'pulizia');
  expect(Object.keys(giri)).toHaveLength(1);
  // Quante ne ha chiuse il giro e quante erano doppie, nelle fasce di quello che dice l'archivio.
  const archivio = await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).map((t) => ({ id: t.id, reason: t.reason })));
  const fascia = (n) => (n === 0 ? 's0' : n === 1 ? 's1' : n <= 5 ? 's2_5' : 's6_20');
  const doppie = archivio.filter((t) => t.reason === 'duplicato');
  expect(doppie.length).toBeGreaterThanOrEqual(1);
  // Le doppie sono di più di quelle archiviate: una home doppia si chiude, ma le pagine di Filo non vanno in archivio.
  expect(Object.keys(giri)[0]).toMatch(new RegExp(`^manual\\|s[0-9_]+\\|${fascia(r.archived)}\\|s(1|2_5)\\|${r.giudizioMancato ? 'si' : 'no'}$`));

  const voce = doppie[0];
  const riaperta = await home.evaluate((id) => chrome.runtime.sendMessage({ type: 'reopen_archived_tab', id }), voce.id);
  expect(riaperta.ok).toBe(true);
  await expect.poll(() => misura(app, 'riaperte'), { timeout: 5_000 }).toEqual({ 'duplicato|min10': 1 });
  expect(await tutteLeChiavi(app)).not.toMatch(/Ricetta|127\.0\.0\.1|localhost/);
});

test('la scheda chiusa si conta fra le riaperte da ogni strada: il clic sulla sua voce nella home e la chat che la riapre', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const url = testServer.html('<title>Ricetta</title><p>La ricetta della pasta.</p>', { pubblico: true });
  await openTab(url);
  await openTab(url);
  const prima = await openTab('filo://newtab/?prova=pulizia');
  const r = await prima.evaluate(() => chrome.runtime.sendMessage({ type: 'run_tab_triage' }));
  expect(r.archived).toBeGreaterThanOrEqual(1);
  expect(await misura(app, 'riaperte')).toEqual({});

  // Dalla home: il gruppo delle pagine nel filo, e il clic sulla pagina.
  const home = await openTab('filo://newtab/?prova=riapri');
  const voce = home.locator(`.dash-pagina[href="${url}"]`).first();
  await expect(voce).toHaveCount(1, { timeout: 15_000 });
  await home.locator('.dash-pagine', { has: voce }).first().locator('.dash-pagine-testa').click();
  await voce.click();
  await expect.poll(() => misura(app, 'riaperte'), { timeout: 8_000 }).toEqual({ 'duplicato|min10': 1 });

  // Dalla chat: Filo l'ha trovata fra le chiuse e la apre col suo indirizzo.
  const aperta = await app.evaluate((_e, u) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url: u, label: 'Ricetta' }), url);
  expect(aperta.executed).toBe(true);
  await expect.poll(() => misura(app, 'riaperte'), { timeout: 8_000 }).toEqual({ 'duplicato|min10': 2 });
  // Un indirizzo mai chiuso non è una riaperta.
  await app.evaluate((_e, u) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url: u, label: 'Altra' }), testServer.html('<p>altra</p>', { pubblico: true }));
  await new Promise((res) => setTimeout(res, 500));
  expect(await misura(app, 'riaperte')).toEqual({ 'duplicato|min10': 2 });
});

// ── La home senza un modello e il suggerimento usato ─────────────────────
test('la home senza un modello conta il suo motivo all’apertura; le pagine salvate che mostra al posto dei suggerimenti non sono suggerimenti usati', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: '' }, useDefaultModels: true });
    await globalThis.SN_SAVED_PAGES.save({ url: 'https://salvata.test/ricetta', title: 'La ricetta salvata' });
  });
  // La home dell'avvio può contare la sua apertura dopo: si parte da un conto fermo da un secondo.
  let prima = -1;
  await expect.poll(async () => {
    const ora = (await misura(app, 'home')).senza_ai_chiave || 0;
    const fermo = ora === prima;
    prima = ora;
    return fermo;
  }, { timeout: 10_000, intervals: [1000] }).toBe(true);
  const home = await openTab('filo://newtab/?prova=home-senza-chiave');
  await expect.poll(async () => (await misura(app, 'home')).senza_ai_chiave || 0, { timeout: 8_000 }).toBe(prima + 1);
  const voce = home.locator('.dash-carta[data-tipo="suggerimenti"] .dash-carta-voce', { hasText: 'La ricetta salvata' });
  await expect(voce).toBeVisible({ timeout: 10_000 });
  await voce.click();
  await new Promise((r) => setTimeout(r, 800));
  expect(await misura(app, 'suggerimenti')).toEqual({});
});

test('la home senza un modello suo (la chat ne ha uno) conta il motivo; con i suggerimenti di un modello, ogni apertura conta «generata»', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'modello-che-non-esiste' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  const servibili = await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const s = await globalThis.SN_STORAGE.getSettings();
    return { home: C.canServeAction(s, C.ACTIONS.FILO_DASHBOARD), chat: C.canServeAction(s, C.ACTIONS.FILO_CHAT) };
  });
  expect(servibili).toEqual({ home: false, chat: true });
  const prima = await misura(app, 'home');
  await openTab('filo://newtab/?prova=home-senza-modello');
  await expect.poll(async () => (await misura(app, 'home')).senza_ai_modelli || 0, { timeout: 8_000 }).toBe((prima.senza_ai_modelli || 0) + 1);

  // Un modello per la home e i suoi suggerimenti già pronti: ogni scheda nuova che li mostra è una home scritta da lui.
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const s = await globalThis.SN_STORAGE.getSettings();
    await globalThis.SN_STORAGE.updateSettings({ models: { ...s.models, [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' } });
    await globalThis.SN_FILO_MEMORY.setDashboardCache({
      message: 'Buongiorno.',
      suggestions: [{ icon: 'web', text: 'Le notizie', action: { type: 'NAVIGA', url: 'https://notizie.test/' }, importance: 3 }],
    });
  });
  const generate = (await misura(app, 'home')).generata || 0;
  await openTab('filo://newtab/?prova=home-1');
  const home = await openTab('filo://newtab/?prova=home-2');
  await expect.poll(async () => (await misura(app, 'home')).generata || 0, { timeout: 8_000 }).toBe(generate + 2);

  // Il suggerimento del modello usato: il posto, il tipo e l'età, mai il testo né l'indirizzo.
  const voce = home.locator('.dash-carta[data-tipo="suggerimenti"] .dash-carta-voce', { hasText: 'Le notizie' });
  await expect(voce).toBeVisible({ timeout: 10_000 });
  await voce.click();
  await expect.poll(() => misura(app, 'suggerimenti'), { timeout: 5_000 }).toEqual({ 'NAVIGA|1|ora': 1 });
  expect(await tutteLeChiavi(app)).not.toMatch(/notizie/i);
});
