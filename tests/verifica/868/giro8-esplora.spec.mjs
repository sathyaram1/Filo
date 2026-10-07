// Esplorazione del giro 8 di #868: ricordo con più tratti della stessa conversazione, prefisso dopo una lettura,
// aspetto della sezione in Preferenze.

import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

async function newtabs(app) {
  return app.windows().filter((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
}
async function primaScheda(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const [win] = await newtabs(app);
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

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
    const TEMI = ['lisbona', 'ristorante', 'orche', 'fisica', 'esame', 'gatto', 'briciola', 'taberna'];
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => ({
      vectors: texts.map((t) => {
        const s = String(t).toLowerCase();
        const v = TEMI.map((w) => (s.includes(w) ? 1 : 0));
        v.push(0.05);
        return v;
      }),
    });
    globalThis.__copione = copione.slice();
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const chat = messages.some((m) => m.role === 'user' && String(m.content).startsWith('═══ CONTESTO DI ADESSO'));
      if (!chat) return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      globalThis.__chiamate.push(JSON.parse(JSON.stringify(messages)));
      const r = globalThis.__copione.shift() || { text: 'ok' };
      if (r.text) { try { onDelta && onDelta(r.text); } catch (_) {} }
      return {
        ...base, text: r.text || '',
        toolCalls: (r.tools || []).map((t, i) => ({ id: `t${globalThis.__chiamate.length}_${i}`, name: t.name, arguments: JSON.stringify(t.args || {}) })),
        reasoningDetails: [], finishReason: r.tools ? 'tool_calls' : 'stop',
      };
    };
  }, copione);
}

async function semina(app, { chat = [] }) {
  await app.evaluate(async (_e, { chat, ora }) => {
    const E = globalThis.SN_FILO_EVENTI;
    const T = E.TIPI;
    const ev = [];
    const ts = (oreFa, piu = 0) => new Date(ora - oreFa * 3600000 + piu).toISOString();
    for (const c of chat) {
      ev.push(E.crea(T.CHAT_APERTA, { chat: c.id }, { ts: ts(c.oreFa), dispositivo: 'prova', autore: 'utente' }));
      c.scambi.forEach(([u, f], i) => {
        ev.push(E.crea(T.MESSAGGIO, { chat: c.id, msg: { role: 'user', text: u } }, { ts: ts(c.oreFa, i * 60000 + 1000), dispositivo: 'prova', autore: 'utente' }));
        ev.push(E.crea(T.MESSAGGIO, { chat: c.id, msg: { role: 'filo', text: f } }, { ts: ts(c.oreFa, i * 60000 + 5000), dispositivo: 'prova', autore: 'filo' }));
      });
      ev.push(E.crea(T.CHAT_CHIUSA, { chat: c.id }, { ts: ts(c.oreFa, 3600000), dispositivo: 'prova', autore: 'utente' }));
      if (c.titolo) ev.push(E.crea(T.CHAT_TITOLO, { chat: c.id, title: c.titolo, kind: 'conversazione' }, { ts: ts(c.oreFa, 3600000), dispositivo: 'prova', autore: 'filo' }));
    }
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  }, { chat, ora: Date.now() });
}

async function scrivi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}
const chiamate = (app) => app.evaluate(() => globalThis.__chiamate);
const testo = (m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
const posContesto = (msgs) => msgs.findIndex((m) => m.role === 'user' && testo(m).startsWith('═══ CONTESTO DI ADESSO'));

test('esplora: tre tratti della stessa conversazione ricordati insieme', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await primaScheda(app);
  await semina(app, {
    chat: [{
      id: 'viaggio-lisbona', oreFa: 6 * 24, titolo: 'Viaggio a Lisbona',
      scambi: [
        ['segnati il ristorante di Lisbona: Taberna da Rua', 'Fatto, il ristorante è Taberna da Rua.'],
        ['a Lisbona il ristorante apre alle 19?', 'Sì, il ristorante apre alle 19.'],
        ['quanto costa il ristorante a Lisbona?', 'Il ristorante costa circa 30 euro.'],
      ],
    }],
  });
  await preparaModello(app, [{ text: 'Si chiamava Taberna da Rua.' }]);
  await scrivi(page, 'come si chiamava il ristorante di Lisbona?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Si chiamava Taberna da Rua.' })).toBeVisible({ timeout: 15_000 });
  const blocco = page.locator('.dash-activity');
  await blocco.locator('.dash-activity-head').click();
  const riga = blocco.locator('.dash-activity-row', { hasText: 'Ricordato dal filo' });
  console.log('RIGA:', await riga.innerText());
  await blocco.screenshot({ path: 'tests/.shots/868-g8-ricordo-tre.png' });
});

test('esplora: dopo una lettura nella scheda, due turni di fila hanno lo stesso prefisso', async ({ app }) => {
  test.setTimeout(120_000);
  const page = await primaScheda(app);
  const casa = cartellaInCasa('filo-g8-');
  const doc = join(casa, 'nota.txt');
  writeFileSync(doc, 'Appunto: la riunione è giovedì alle 15 in sala Verde.');
  try {
    await preparaModello(app, [
      { text: '', tools: [{ name: 'LEGGI_DOCUMENTO', args: { percorso: doc } }] },
      { text: 'Ho letto la nota.' },
      { text: 'Primo seguito.' },
      { text: 'Secondo seguito.' },
    ]);
    await scrivi(page, `leggi ${doc}`);
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Ho letto la nota.' })).toBeVisible({ timeout: 20_000 });
    await scrivi(page, 'grazie');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Primo seguito.' })).toBeVisible({ timeout: 20_000 });
    await scrivi(page, 'e poi?');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Secondo seguito.' })).toBeVisible({ timeout: 20_000 });
    const c = await chiamate(app);
    console.log('CHIAMATE', c.length);
    const t2 = c[c.length - 2];
    const t3 = c[c.length - 1];
    const k2 = posContesto(t2);
    const pref2 = t2.slice(0, k2);
    const pref3 = t3.slice(0, k2);
    let primo = -1;
    for (let i = 0; i < pref2.length; i++) if (JSON.stringify(pref2[i]) !== JSON.stringify(pref3[i])) { primo = i; break; }
    console.log('PRIMO DIVERSO', primo, 'su', pref2.length);
    if (primo >= 0) {
      console.log('T2:', JSON.stringify(pref2[primo]).slice(0, 1500));
      console.log('T3:', JSON.stringify(pref3[primo]).slice(0, 1500));
    }
    console.log('LETTURA IN T3:', t3.map(testo).join('\n').includes('sala Verde'));
    expect(primo).toBe(-1);
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
});

for (const tema of ['light', 'dark']) {
  test(`esplora: sezione «Quanto ricorda la chat» in Preferenze, tema ${tema}`, async ({ app, shell, openTab }) => {
    test.setTimeout(60_000);
    await shell.evaluate((t) => window.filoShell.message({ type: 'update_settings', settings: { theme: t } }), tema);
    const page = await openTab('filo://preferences/preferences.html');
    await page.waitForLoadState('domcontentloaded');
    const sez = page.locator('#sec-contesto');
    await sez.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await sez.screenshot({ path: `tests/.shots/868-g8-pref-${tema}.png` });
    for (const [v, atteso] of [['abc', ''], ['0', '0.5'], ['1000', '365'], ['  2  ', '2'], ['1,5', '1.5']]) {
      await page.locator('#contestoGiorni').fill(v);
      await page.locator('#contestoGiorni').blur();
      await page.waitForTimeout(200);
      console.log(`giorni «${v}» →`, JSON.stringify(await page.locator('#contestoGiorni').inputValue()),
        JSON.stringify(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).contestoFilo)));
    }
  });
}
