// Spec TEMPORANEO della verifica indipendente (#521). Da cancellare a fine giro.
import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const NEWTAB = 'filo://newtab/';
const OUT = 'tests/agent/.out';
mkdirSync(OUT, { recursive: true });

// Stub del provider nel main: una SEQUENZA di turni. Ogni turno:
//   { reasoning: [chunk...], gapMs, text: <string JSON>, deltaChunk, throwAfterReasoning, beforeMs }
async function stubProvider(app, turns, extra = {}) {
  await app.evaluate(async (_e, { turns, extra }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
      ...(extra.settings || {}),
    });
    globalThis.__vTurn = 0;
    globalThis.__vTurns = turns;
    globalThis.__vMsgs = [];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onReasoning, onDelta }) => {
      const n = globalThis.__vTurn++;
      globalThis.__vMsgs[n] = JSON.stringify(messages || []);
      const t = globalThis.__vTurns[Math.min(n, globalThis.__vTurns.length - 1)];
      if (t.beforeMs) await sleep(t.beforeMs);
      for (const chunk of (t.reasoning || [])) {
        onReasoning && onReasoning(chunk);
        await sleep(t.gapMs || 60);
      }
      if (t.throwAfterReasoning) throw new Error(t.throwAfterReasoning);
      const text = typeof t.text === 'string' ? t.text : JSON.stringify(t.text);
      const step = t.deltaChunk || 12;
      for (let i = 0; i < text.length; i += step) {
        onDelta && onDelta(text.slice(i, i + step));
        await sleep(t.deltaGapMs || 15);
      }
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ text: '', actions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    if (globalThis.SN_WEB_SEARCH) {
      globalThis.SN_WEB_SEARCH.search = async () => ({ ok: true, provider: 'stub', results: [
        { title: 'Risultato uno', url: 'https://example.com/1', snippet: 'uno' },
      ] });
    }
  }, { turns, extra });
}

const J = (text, actions = []) => JSON.stringify({ text, actions });

async function sendMsg(page, text) {
  await page.locator('#input').fill(text);
  await page.locator('#sendBtn').click();
}

test.describe.configure({ timeout: 120_000 });

test('1. attesa, ragionamento, click apre/chiude, riassunto con durata', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await stubProvider(app, [{
    beforeMs: 1200,
    reasoning: ['Devo capire cosa chiede. ', 'L\'utente saluta, quindi rispondo con un saluto. ', 'Meglio breve. ', 'Ultima frase del ragionamento qui.'],
    gapMs: 500,
    text: J('Ciao! Come posso aiutarti?'),
  }]);
  await sendMsg(page, 'ciao');
  // Attesa: nessuna frase a caso, solo "Aspetto la risposta…"
  const label = page.locator('.dash-activity-label');
  await expect(label).toHaveText('Aspetto la risposta…');
  await page.screenshot({ path: `${OUT}/verif-1-attesa.png` });
  const bodyText = await page.locator('#bubbles').innerText();
  expect(bodyText).not.toMatch(/Consulto|Penso|Rifletto|Elaboro|Analizzo/i);
  // Ragionamento in streaming: la riga mostra "Sta ragionando · <ultima frase>"
  await expect(label).toContainText('Sta ragionando');
  await expect(label).toContainText('Ultima frase del ragionamento qui.', { timeout: 6000 });
  await page.screenshot({ path: `${OUT}/verif-1-ragiona.png` });
  // Blocco chiuso di default
  const body = page.locator('.dash-activity-body');
  await expect(body).toBeHidden();
  // Click apre, mostra il ragionamento completo
  await page.locator('.dash-activity-head').click();
  await expect(body).toBeVisible();
  await expect(body).toContainText('Devo capire cosa chiede.');
  await expect(body).toContainText('Ultima frase del ragionamento qui.');
  await page.screenshot({ path: `${OUT}/verif-1-aperto-durante.png` });
  // Click chiude
  await page.locator('.dash-activity-head').click();
  await expect(body).toBeHidden();
  // Fine: riassunto con durata
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Come posso aiutarti' })).toBeVisible({ timeout: 15000 });
  await expect(label).toHaveText(/^Ragionamento · \d+ s$/, { timeout: 10000 });
  await expect(page.locator('.dash-activity')).toHaveCount(1);
  await expect(body).toBeHidden();
  await page.screenshot({ path: `${OUT}/verif-1-fine.png` });
  await page.locator('.dash-activity-head').click();
  await expect(body).toBeVisible();
  await page.screenshot({ path: `${OUT}/verif-1-fine-aperto.png` });
  // Il blocco sta SOPRA la risposta
  const yBlock = (await page.locator('.dash-activity').boundingBox()).y;
  const yAns = (await page.locator('.dash-bubble-filo').last().boundingBox()).y;
  expect(yBlock).toBeLessThan(yAns);
});

test('2. azioni come righe + lavoro in due turni = un blocco, una risposta', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await stubProvider(app, [
    { reasoning: ['Serve un timer e una ricerca. '], gapMs: 100,
      text: J('Metto il timer e cerco, un attimo.', [
        { type: 'TIMER', seconds: 300, label: 'Pasta' },
        { type: 'SVEGLIA', time: '07:30', label: 'palestra' },
        { type: 'CERCA_WEB', query: 'ricetta pasta' },
      ]) },
    { reasoning: ['Ho i risultati. Rispondo. '], gapMs: 100,
      text: J('RISPOSTA_FINALE: timer avviato, ecco la ricetta.') },
  ]);
  await sendMsg(page, 'timer pasta 5 min e cerca una ricetta');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA_FINALE' })).toBeVisible({ timeout: 20000 });
  const label = page.locator('.dash-activity-label');
  await expect(label).toHaveText(/^Ha .* · \d+ s$/, { timeout: 10000 });
  console.log('RIASSUNTO 2:', await label.textContent());
  expect(await app.evaluate(() => globalThis.__vTurn)).toBe(2);
  await expect(page.locator('.dash-activity')).toHaveCount(1);
  await expect(page.locator('.dash-bubble-filo')).toHaveCount(1);
  await expect(page.locator('.dash-bubble-user')).toHaveCount(1);
  await page.locator('.dash-activity-head').click();
  const body = page.locator('.dash-activity-body');
  await expect(body).toBeVisible();
  const txt = await body.innerText();
  console.log('CRONOLOGIA 2:\n' + txt);
  expect(txt).toContain('Serve un timer');
  expect(txt).toContain('Metto il timer e cerco');
  expect(txt).toContain('Timer avviato');
  expect(txt).toContain('Sveglia impostata');
  expect(txt).toContain('Cerco sul web');
  expect(txt).toContain('Ho i risultati');
  // ordine: ragionamento1 < nota < righe < ragionamento2
  const i1 = txt.indexOf('Serve un timer'), i2 = txt.indexOf('Metto il timer'), i3 = txt.indexOf('Timer avviato'), i4 = txt.indexOf('Ho i risultati');
  expect(i1 < i2 && i2 < i3 && i3 < i4).toBe(true);
  await expect(page.locator('.dash-activity-row-icon').first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/verif-2-aperto.png` });
  // il timer esiste davvero nella colonna live?
  const live = await page.locator('#live').innerText();
  console.log('LIVE 2:', live.slice(0, 200));
});

test('3. CAPACITA_DETTAGLIO in due turni: un blocco e una risposta; testo intermedio nel blocco', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await stubProvider(app, [
    { reasoning: ['Controllo le capacità.'], text: J('Verifico un attimo cosa so fare.', [{ type: 'CAPACITA_DETTAGLIO', ids: ['save-for-later'] }]) },
    { reasoning: ['Ora so.'], text: J('FINALE: sì, posso salvare pagine per dopo.') },
  ]);
  await sendMsg(page, 'sai salvare pagine per dopo?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'FINALE' })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.dash-activity-label')).toHaveText(/^Ha .* · \d+ s$/, { timeout: 10000 });
  console.log('RIASSUNTO 3:', await page.locator('.dash-activity-label').textContent());
  await expect(page.locator('.dash-activity')).toHaveCount(1);
  await expect(page.locator('.dash-bubble-filo')).toHaveCount(1);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Verifico un attimo' })).toHaveCount(0);
  await page.locator('.dash-activity-head').click();
  const txt = await page.locator('.dash-activity-body').innerText();
  console.log('CRONOLOGIA 3:\n' + txt);
  expect(txt).toContain('Verifico un attimo cosa so fare.');
  expect(txt).toContain('Verifico cosa so fare');
  // il secondo turno ha ricevuto il dettaglio?
  const m1 = await app.evaluate(() => globalThis.__vMsgs[1] || '');
  expect(m1.toLowerCase()).toContain('save-for-later');
  await page.screenshot({ path: `${OUT}/verif-3-aperto.png` });
});

test('4. conversazione lunga + campo su più righe: il campo resta nella finestra', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  const long = 'Riga di risposta abbastanza lunga per occupare spazio. '.repeat(12);
  await stubProvider(app, [{ reasoning: ['Penso. '.repeat(20)], gapMs: 5, text: J(long), deltaChunk: 400, deltaGapMs: 1 }]);
  for (let i = 0; i < 10; i++) {
    await sendMsg(page, `messaggio numero ${i} ` + 'bla '.repeat(30));
    await expect(page.locator('.dash-bubble-filo')).toHaveCount(i + 1, { timeout: 20000 });
    await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 20000 });
  }
  const vp = page.viewportSize() || await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const input = page.locator('#input');
  await input.click();
  for (let i = 0; i < 12; i++) {
    await input.type(`riga ${i}`);
    await input.press('Shift+Enter');
  }
  await page.screenshot({ path: `${OUT}/verif-4-lungo-multiriga.png` });
  const ib = await input.boundingBox();
  const sb = await page.locator('#sendBtn').boundingBox();
  console.log('VIEWPORT', vp, 'INPUT', ib, 'SEND', sb);
  expect(ib.y + ib.height).toBeLessThanOrEqual(vp.height + 1);
  expect(sb.y + sb.height).toBeLessThanOrEqual(vp.height + 1);
  expect(ib.y).toBeGreaterThanOrEqual(0);
  await expect(page.locator('#sendBtn')).toBeVisible();
  // il fondo della conversazione resta raggiungibile?
  const bub = page.locator('#bubbles');
  const reach = await bub.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, st: el.scrollTop, rect: el.getBoundingClientRect().toJSON() }));
  console.log('BUBBLES', reach);
  expect(reach.rect.bottom).toBeLessThanOrEqual(ib.y + 1);
  // Nessun blocco spurio: 10 blocchi per 10 domande
  await expect(page.locator('.dash-activity')).toHaveCount(10);
  // scroll orizzontale della pagina?
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflowX).toBe(false);
});

test('5. risposta di sola azione; errore del provider a metà; Riprova', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await stubProvider(app, [{ reasoning: ['Solo un timer.'], text: J('', [{ type: 'TIMER', seconds: 60, label: 'Uovo' }]) }]);
  await sendMsg(page, 'timer 1 minuto uovo');
  await expect(page.locator('.dash-activity-label')).toHaveText(/^Ha avviato un timer · \d+ s$/, { timeout: 15000 });
  await page.screenshot({ path: `${OUT}/verif-5-sola-azione.png` });
  const bubbles = await page.locator('.dash-bubble-filo').evaluateAll((els) => els.map((e) => ({ cls: e.className, text: e.textContent, h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width, vis: getComputedStyle(e).display })));
  console.log('BOLLE 5:', JSON.stringify(bubbles));

  // Errore a metà: ragionamento poi eccezione
  await stubProvider(app, [{ reasoning: ['Sto per rispondere ma… '], throwAfterReasoning: 'fetch failed' }]);
  await sendMsg(page, 'domanda che fallisce');
  await expect(page.locator('.dash-action-btn', { hasText: 'Riprova' })).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: `${OUT}/verif-5-errore.png` });
  const labels = await page.locator('.dash-activity-label').allTextContents();
  console.log('LABEL dopo errore:', labels);
  const errText = await page.locator('.dash-bubble-filo').last().innerText();
  console.log('ERRORE:', errText);
  expect(errText).not.toContain('fetch failed');
  // Riprova con provider che funziona
  await stubProvider(app, [{ reasoning: ['Ok ora va.'], text: J('Risposta dopo il riprova.') }]);
  await page.locator('.dash-action-btn', { hasText: 'Riprova' }).click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta dopo il riprova' })).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: `${OUT}/verif-5-riprova.png` });
  console.log('BLOCCHI dopo riprova:', await page.locator('.dash-activity-label').allTextContents());
  console.log('USER bubbles:', await page.locator('.dash-bubble-user').count());
});

test('6. ragionamento lunghissimo + HTML; azione livello 2 resta cliccabile fuori dal blocco', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  const huge = ('Frase di ragionamento numero X. ').repeat(1500) + '<script>alert(1)</script><b>grassetto</b> ' + 'parolalunghissimasenzaspazi'.repeat(40) + ' fine.';
  await stubProvider(app, [{ reasoning: [huge.slice(0, 20000), huge.slice(20000)], gapMs: 200, text: J('Fatto: attivo la modalità terminale.', [{ type: 'IMPOSTA_PREFERENZA', chiave: 'modalita_terminale', valore: true }]) }]);
  await sendMsg(page, 'attiva la modalità terminale');
  await expect(page.locator('.dash-activity-label')).toContainText('Sta ragionando', { timeout: 10000 });
  await page.screenshot({ path: `${OUT}/verif-6-lungo-riga.png` });
  const headBox = await page.locator('.dash-activity-head').boundingBox();
  const bubBox = await page.locator('#bubbles').boundingBox();
  console.log('HEAD', headBox, 'BUBBLES', bubBox);
  expect(headBox.width).toBeLessThanOrEqual(bubBox.width + 1);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto' })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.dash-activity-label')).toHaveText(/·\s\d+ s$/, { timeout: 10000 });
  await page.screenshot({ path: `${OUT}/verif-6-fine.png` });
  // l'azione di livello 2: un bottone FUORI dal blocco
  const btnInBlock = await page.locator('.dash-activity-body .dash-action-btn').count();
  const btns = await page.locator('.dash-bubble-filo .dash-action-btn, .dash-bubble-actions .dash-action-btn').allTextContents();
  console.log('BTN fuori:', btns, 'dentro blocco:', btnInBlock);
  expect(btnInBlock).toBe(0);
  const noScript = await page.evaluate(() => !!document.querySelector('.dash-activity-body script') || document.querySelector('.dash-activity-body b') !== null);
  expect(noScript).toBe(false);
  await page.locator('.dash-activity-head').click();
  await page.screenshot({ path: `${OUT}/verif-6-aperto.png` });
  const body = page.locator('.dash-activity-body');
  const dims = await body.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth }));
  console.log('BODY dims', dims);
  expect(dims.sw).toBeLessThanOrEqual(dims.cw + 1);
  const popup = await page.locator('.dash-confirm, .dash-popup, [class*="confirm"]').count();
  console.log('popup conferma:', popup, await page.locator('body').innerText().then((t) => t.slice(-400)));
  await page.screenshot({ path: `${OUT}/verif-6-popup.png` });
});

test('7. tema scuro + storico: replay del thread / riapertura', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await stubProvider(app, [{ reasoning: ['Ragiono al buio.'], text: J('Risposta scura.', [{ type: 'TIMER', seconds: 120, label: 'Tè' }]) }], { settings: { theme: 'dark' } });
  await page.reload();
  await page.waitForTimeout(800);
  await sendMsg(page, 'timer tè due minuti');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta scura' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.dash-activity-label')).toHaveText(/·\s\d+ s$/, { timeout: 10000 });
  await page.locator('.dash-activity-head').click();
  await page.screenshot({ path: `${OUT}/verif-7-scuro-aperto.png` });
  // Stessa domanda di nuovo (cache): cosa mostra il blocco?
  await sendMsg(page, 'timer tè due minuti');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/verif-7-cache.png` });
  console.log('turni provider:', await app.evaluate(() => globalThis.__vTurn));
  console.log('labels:', await page.locator('.dash-activity-label').allTextContents());
  console.log('bolle filo:', await page.locator('.dash-bubble-filo').count());
});
