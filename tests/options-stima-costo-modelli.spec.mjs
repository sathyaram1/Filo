// #819 — dove si sceglie il modello di una funzione, accanto a ogni modello quanto costa un uso tipico, dal listino di
// OpenRouter; un modello che costa più di 5 volte il predefinito porta una riga coi messaggi che bastano, e la scelta
// resta salvata. Con la chiave propria dollari e niente avviso; senza listino nessuna cifra inventata. In chat, la
// conferma e l'esito dicono le stesse cifre. Senza il fix accanto ai modelli non c'è niente.

import { test, expect } from './fixtures/electron.mjs';
import { clickConfirm, confirmText, scrollConfirmToEnd, CONFIRM_HOST } from './helpers/confirm.mjs';
import { livelloAutonomia } from './helpers/autonomia.mjs';

const OPTIONS_URL = 'filo://options/options.html';
const CHAT = 'Home — chat con Filo';

// Come li manda /api/v1/models: dollari per token.
const CATALOGO = [
  { id: 'deepseek/deepseek-v4-pro', pricing: { prompt: '0.0000004', completion: '0.0000008' } },
  { id: 'deepseek/deepseek-v4-flash', pricing: { prompt: '0.00000009', completion: '0.00000018' } },
  { id: 'google/gemma-4-31b-it', pricing: { prompt: '0.0000001', completion: '0.0000003' } },
  { id: 'google/gemma-4-26b-a4b-it', pricing: { prompt: '0.00000004', completion: '0.00000012' } },
  { id: 'anthropic/claude-haiku-4.5', pricing: { prompt: '0.000001', completion: '0.000005' } },
  { id: 'anthropic/claude-opus-4.5', pricing: { prompt: '0.000005', completion: '0.000025' } },
];
const OPUS = { label: 'Claude Opus 4.5', provider: 'openrouter', model: 'anthropic/claude-opus-4.5', inputs: ['text', 'image'], outputs: ['text'] };
// Un messaggio in chat senza storia d'uso: 16.000 token in entrata e 900 in uscita (media prudente), crediti locali a
// 0,92 €/$ e 0,0008 € a credito.
const CREDITI_PER_DOLLARO = 0.92 / 0.0008;
const OPUS_MSG = (16000 * 0.000005 + 900 * 0.000025) * CREDITI_PER_DOLLARO; // 117,875

async function listino(app, { rotto = false, lento = 0 } = {}) {
  await app.evaluate((_e, { catalogo, rotto: giu, lento: ms }) => {
    const vero = globalThis.fetch;
    globalThis.__listinoChiesto = 0;
    globalThis.fetch = async (input, init) => {
      const url = String((input && input.url) || input);
      if (/^https:\/\/openrouter\.ai\/api\/v1\/models/.test(url)) {
        globalThis.__listinoChiesto += 1;
        if (ms) await new Promise((r) => setTimeout(r, ms));
        if (giu) return new Response('giù', { status: 503 });
        const data = url.includes('output_modalities') ? [] : catalogo;
        return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return vero(input, init);
    };
  }, { catalogo: CATALOGO, rotto, lento });
}

async function configura(app, extra = {}) {
  await app.evaluate(async (_e, x) => {
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      modelRegistry: { ...T.registry, opus: x.opus },
      models: { ...T.models, ...(x.models || {}) },
      apiKeys: { openrouter: x.chiave || '' },
    });
  }, { opus: OPUS, ...extra });
}

const cellaDi = (page, nome) => page.locator('#modelsGrid > div').filter({ has: page.locator('label', { hasText: nome }) });
const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
const saldoLocale = (app) => app.evaluate(async () => (await globalThis.SN_CREDITS.getPublic()).balance);
const intero = (n) => Math.floor(n).toLocaleString('it-IT', { useGrouping: true });

test('Opzioni: ogni modello ha il suo costo in crediti, e un modello grande per la chat dice per quanti messaggi bastano', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await listino(app);
  await configura(app);
  const page = await openTab(OPTIONS_URL);
  await expect(page.locator('#useDefaultModels')).not.toBeChecked({ timeout: 8_000 });

  const chat = cellaDi(page, CHAT);
  const costo = chat.locator('.sn-chain-cost').first();
  // DeepSeek V4 Pro: (16.000 × 0,4 + 900 × 0,8) milionesimi di dollaro, in crediti locali.
  await expect(costo).toHaveText('≈ 8,2 crediti', { timeout: 8_000 });
  await expect(costo).toHaveAttribute('title', /^Circa 8,2 crediti per messaggio, dal listino di OpenRouter/);
  await expect(chat.locator('.sn-chain-costo')).toBeHidden();

  // Ogni modello di ogni funzione ha la sua riga: una cifra, o perché non c'è.
  const righe = await page.evaluate(() => [...document.querySelectorAll('#modelsGrid .sn-chain-seg')]
    .filter((seg) => seg.querySelector('.sn-chain-input').value.trim())
    .map((seg) => { const t = seg.querySelector('.sn-chain-cost'); return `${seg.querySelector('.sn-chain-input').value} ${t && !t.hidden ? t.textContent : '(niente)'}`; }));
  expect(righe.length).toBeGreaterThan(30);
  for (const r of righe) expect(r).toMatch(/ (≈ [\d,.]+ credit[oi]|meno di 0,1 crediti|prezzo non noto|costo da misurare)$/);

  // Nella tendina ogni modello ha la cifra per questa funzione.
  const input = chat.locator('.sn-chain-input').first();
  await input.focus();
  const pop = chat.locator('.sn-chain-seg').first().locator('.sn-chain-pop');
  await expect(pop).toBeVisible({ timeout: 4_000 });
  const opzione = pop.locator('.sn-select-option').filter({ has: page.locator('.sn-chain-opt-nick', { hasText: /^opus$/ }) });
  await expect(opzione.locator('.sn-chain-opt-cost')).toHaveText('≈ 118 crediti');
  await page.screenshot({ path: 'tests/.shots/stima-costo-tendina.png' });

  await input.fill('opus');
  await opzione.click();
  await expect(costo).toHaveText('≈ 118 crediti');
  const saldo = await saldoLocale(app);
  const avviso = chat.locator('.sn-chain-costo');
  await expect(avviso).toHaveText(`Con opus i tuoi ${intero(saldo)} crediti bastano per circa ${Math.floor(saldo / OPUS_MSG)} messaggi.`);
  // L'avviso informa: la scelta è salvata.
  await expect.poll(async () => (await impostazioni(app)).models.filo_chat, { timeout: 5_000 }).toBe('opus, gemma');
  await page.screenshot({ path: 'tests/.shots/stima-costo-avviso.png' });

  // La soglia si cambia: sopra il rapporto l'avviso se ne va, e resta salvata.
  await page.locator('#costWarnRatio').fill('20');
  await expect(avviso).toBeHidden();
  await page.locator('#costWarnRatio').press('Tab');
  await expect.poll(async () => (await impostazioni(app)).costoModelli.soglia, { timeout: 5_000 }).toBe(20);
  await page.locator('#costWarnRatio').fill('5');
  await page.locator('#costWarnRatio').press('Tab');
  await expect.poll(async () => (await impostazioni(app)).costoModelli.soglia, { timeout: 5_000 }).toBe(5);

  // Riaprendo la pagina la scelta e l'avviso ci sono ancora.
  await page.reload();
  await expect(cellaDi(page, CHAT).locator('.sn-chain-input').first()).toHaveValue('opus', { timeout: 8_000 });
  await expect(cellaDi(page, CHAT).locator('.sn-chain-costo')).toContainText('bastano per circa', { timeout: 8_000 });
});

test('Opzioni con la chiave propria: costo in dollari e nessun avviso, anche col modello grande', async ({ app, openTab }) => {
  await listino(app);
  await configura(app, { chiave: 'sk-or-v1-mia-chiave-di-prova', models: { filo_chat: 'opus' } });
  const page = await openTab(OPTIONS_URL);
  const chat = cellaDi(page, CHAT);
  await expect(chat.locator('.sn-chain-cost').first()).toHaveText('≈ 0,1 $', { timeout: 8_000 });
  await expect(chat.locator('.sn-chain-cost').first()).toHaveAttribute('title', /^Circa 0,1 \$ per messaggio/);
  await expect(chat.locator('.sn-chain-costo')).toBeHidden();
  await page.screenshot({ path: 'tests/.shots/stima-costo-dollari.png' });

  // Tolta la chiave, la stessa pagina torna ai crediti e l'avviso compare.
  await page.locator('#apiKey').fill('');
  await page.locator('#apiKey').press('Tab');
  await expect(chat.locator('.sn-chain-cost').first()).toHaveText('≈ 118 crediti', { timeout: 8_000 });
  await expect(chat.locator('.sn-chain-costo')).toContainText('Con opus i tuoi');
});

test('Opzioni senza listino: nessuna cifra inventata, la riga dice che il listino non c\'è', async ({ app, openTab }) => {
  await listino(app, { rotto: true });
  await configura(app, { models: { filo_chat: 'opus' } });
  const page = await openTab(OPTIONS_URL);
  const chat = cellaDi(page, CHAT);
  const costo = chat.locator('.sn-chain-cost').first();
  await expect(costo).toHaveText('listino non disponibile', { timeout: 8_000 });
  await expect(costo).toHaveAttribute('title', /Listino di OpenRouter non disponibile/);
  await expect(chat.locator('.sn-chain-costo')).toBeHidden();
  await expect(page.locator('#modelsGrid .sn-chain-cost', { hasText: /\d/ })).toHaveCount(0);
});

test('Opzioni: la cifra accanto ai modelli non manda a capo una catena che senza ci stava su una riga', async ({ app, openTab }) => {
  await listino(app);
  await configura(app);
  const page = await openTab(OPTIONS_URL);
  await expect(cellaDi(page, CHAT).locator('.sn-chain-cost').first()).toHaveText('≈ 8,2 crediti', { timeout: 8_000 });
  const righe = () => page.evaluate(() => [...document.querySelectorAll('#modelsGrid > div')].map((cell) => {
    const segs = [...cell.querySelectorAll('.sn-chain-seg')];
    return { nome: (cell.querySelector('label') || {}).textContent, segs: segs.length, righe: new Set(segs.map((s) => Math.round(s.getBoundingClientRect().top))).size };
  }).filter((x) => x.segs > 1));
  const con = await righe();
  await page.addStyleTag({ content: '.sn-chain-cost{display:none!important}' });
  await expect.poll(async () => (await righe()).map((r) => r.righe).join()).toBeTruthy();
  const senza = await righe();
  expect(con.length).toBeGreaterThan(10);
  expect(con.filter((c, k) => c.righe > senza[k].righe).map((c) => c.nome)).toEqual([]);
});

// ── In chat ───────────────────────────────────────────────────────────────────

async function homeDi(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab') && !w.url().includes('incognito'); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}

async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    globalThis.__costo_tool = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const ultimo = [...messages].reverse().find((m) => m.role === 'tool');
      if (ultimo) globalThis.__costo_tool.push(String(ultimo.content || ''));
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}
const cambia = (valore, id = 'm1') => ({ toolCalls: [{ id, name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'modello_funzione', valore }) }] });

async function scrivi(page, testo) {
  await page.bringToFront();
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('Chat: «usa opus per la chat» chiede l\'OK con il costo e l\'avviso, salva, e l\'esito porta le stesse cifre', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await livelloAutonomia(app, 'conservativo'); // il popup di un costo 2 si prova a Conservativo (#530)
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await listino(app);
  // La chiave dei test fa partire la chat; per le stime è quella di Filo, quindi si parla di crediti.
  await configura(app, { chiave: 'k-test', models: { filo_chat: 'deepseek-flash' } });
  await app.evaluate(() => { globalThis.SN_WALLET_MAIN.keySource = async () => 'factory'; });

  // Una lettura nel giro rimanda l'esito al modello: il cambio fermo sulla conferma da solo chiuderebbe il turno (#1130).
  const leggi = { id: 'c1', name: 'CAPACITA_DETTAGLIO', arguments: '{"ids":["save-for-later"]}' };
  await modelloFinto(app, [{ toolCalls: [leggi, ...cambia('Chat con Filo: opus').toolCalls] }, { text: 'Ti chiedo conferma.' }, { text: 'Fatto.' }]);
  await scrivi(chat, 'usa opus per la chat');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Ti chiedo conferma.' })).toBeVisible({ timeout: 10_000 });
  const saldo = await saldoLocale(app);
  const riga = `Circa 118 crediti per messaggio. Con opus i tuoi ${intero(saldo)} crediti bastano per circa ${Math.floor(saldo / OPUS_MSG)} messaggi.`;
  await expect.poll(() => confirmText(chat), { timeout: 8_000 }).toContain(riga);
  expect((await impostazioni(app)).models.filo_chat).toBe('deepseek-flash');
  await chat.screenshot({ path: 'tests/.shots/stima-costo-chat-conferma.png' });

  // Cambiare modello non abbassa una difesa: basta l'OK, senza scrivere «conferma».
  expect((await confirmText(chat))).not.toMatch(/abbassa una difesa/);
  await scrollConfirmToEnd(chat);
  await clickConfirm(chat, 'ok');
  await expect.poll(async () => (await impostazioni(app)).models.filo_chat, { timeout: 5_000 }).toBe('opus');
  // Al modello torna la riga da ripetere, e la traccia in chat la porta comunque.
  await expect.poll(async () => (await app.evaluate(() => globalThis.__costo_tool)).join('\n'), { timeout: 10_000 }).toContain(riga);
  await expect(chat.locator('.dash-activity', { hasText: 'Circa 118 crediti per messaggio' }).first()).toBeAttached({ timeout: 10_000 });
});

test('Chat coi modelli predefiniti: il cambio non parte e Filo sa perché, senza chiedere un OK a vuoto', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await listino(app);
  await configura(app, { chiave: 'k-test' });
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ useDefaultModels: true }));
  const prima = (await impostazioni(app)).models.filo_chat;

  await modelloFinto(app, [cambia('Chat con Filo: opus'), { text: 'Coi predefiniti non posso.' }]);
  await scrivi(chat, 'usa opus per la chat');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Coi predefiniti non posso.' })).toBeVisible({ timeout: 10_000 });
  await expect(chat.locator(CONFIRM_HOST)).toBeHidden();
  const esito = (await app.evaluate(() => globalThis.__costo_tool)).join('\n');
  expect(esito).toContain('NON applicata: stai usando i modelli predefiniti');
  expect((await impostazioni(app)).models.filo_chat).toBe(prima);
});

test('Chat col listino lento: il cambio parte e la risposta dice che il costo non è arrivato, non tace', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await listino(app, { lento: 6000 });
  await configura(app, { chiave: 'k-test', models: { filo_chat: 'deepseek-flash' } });
  await app.evaluate(() => { globalThis.SN_WALLET_MAIN.keySource = async () => 'factory'; });

  await modelloFinto(app, [cambia('Chat con Filo: opus'), { text: 'Fatto.' }]);
  await scrivi(chat, 'usa opus per la chat');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await impostazioni(app)).models.filo_chat, { timeout: 5_000 }).toBe('opus');
  const ritardo = /listino di OpenRouter non è arrivato in tempo/;
  expect((await app.evaluate(() => globalThis.__costo_tool)).join('\n')).toMatch(ritardo);
  await expect(chat.locator('.dash-activity', { hasText: ritardo }).first()).toBeAttached({ timeout: 5_000 });
});
