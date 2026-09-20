// #567.5, secondo giro — l'evento si aggiunge (il primo giro l'ha verificato):
// qui si guarda cosa succede DOPO averlo aggiunto.
//
// Le porte contate: un secondo click sul bottone, che il bottone stesso invita
// a fare («un altro click lo riapre»); il racconto del diario e del riassunto
// una volta che l'evento è davvero nel calendario.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, fakeProvider, restore, chiedi } from './aiuto.mjs';

async function fingiApertura(app, esito = '') {
  await app.evaluate(({ shell }, e) => {
    if (!globalThis.__v567g2orig) globalThis.__v567g2orig = shell.openPath;
    globalThis.__v567g2aperti = [];
    shell.openPath = async (p) => { globalThis.__v567g2aperti.push(p); return e; };
  }, esito);
}
const cartellaEventi = async (app) => join(await app.evaluate(({ app: a }) => a.getPath('temp')), 'filo-eventi');
const elencoIcs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.ics')) : []);
const nuoviIcs = (dir, prima) => elencoIcs(dir).filter((f) => !prima.includes(f));
const uidDi = (testo) => (/^UID:(.*)$/m.exec(testo.replace(/\r\n /g, '')) || [])[1] || '';

const EVENTO = '{"titolo":"Cena con Anna","data":"2026-10-02","ora":"20:30","durata_min":90,"luogo":"Da Mario"}';

test('riaprire l\'evento col bottone non deve infilare un secondo evento nel calendario', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await fingiApertura(app, '');

  await fakeProvider(app, [
    { toolCalls: [{ id: 'g2a', name: 'EVENTO_CALENDARIO', arguments: EVENTO }] },
    { text: 'Ecco la cena.' },
  ], '__v567g2a');

  await chiedi(page, 'segnami la cena con Anna venerdì alle 20:30');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco la cena.' })).toBeVisible({ timeout: 10_000 });

  const dir = await cartellaEventi(app);
  const prima = elencoIcs(dir);
  const btn = page.locator('.dash-action-btn', { hasText: 'Aggiungi al calendario' });
  await expect(btn).toBeVisible();
  await btn.click();

  const riaperto = page.locator('.dash-action-btn', { hasText: 'Aperto nel calendario' });
  await expect(riaperto).toBeVisible({ timeout: 10_000 });
  // Il bottone invita esplicitamente a ricliccarlo per riaprire il calendario.
  await expect(riaperto).toHaveAttribute('title', /riapre/i);

  await riaperto.click();
  await expect(page.locator('.dash-action-btn', { hasText: 'Aperto nel calendario' })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);

  const nati = nuoviIcs(dir, prima);
  const uid = nati.map((f) => uidDi(readFileSync(join(dir, f), 'utf8')));
  const distinti = new Set(uid.filter(Boolean));
  expect(distinti.size, `riaprendo, il calendario deve rivedere LO STESSO evento, non un secondo: uid trovati ${JSON.stringify([...distinti])}`).toBe(1);

  await restore(app, '__v567g2a');
});

test('una volta aggiunto, il diario non deve continuare a chiamarlo soltanto una proposta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await fingiApertura(app, '');

  await fakeProvider(app, [
    { toolCalls: [{ id: 'g2b', name: 'EVENTO_CALENDARIO', arguments: EVENTO }] },
    { text: 'Ecco la cena.' },
  ], '__v567g2b');

  await chiedi(page, 'segnami la cena con Anna venerdì alle 20:30');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco la cena.' })).toBeVisible({ timeout: 10_000 });

  const btn = page.locator('.dash-action-btn', { hasText: 'Aggiungi al calendario' });
  await btn.click();
  await expect(page.locator('.dash-action-btn', { hasText: 'Aperto nel calendario' })).toBeVisible({ timeout: 10_000 });

  const activity = page.locator('.dash-activity');
  await activity.locator('.dash-activity-head').click();
  const righe = await activity.locator('.dash-activity-body .dash-activity-row').allTextContents();
  const parlaDiAggiunto = righe.some((t) => /aggiunt|calendario/i.test(t) && !/^\s*Evento proposto/.test(t));
  expect(parlaDiAggiunto, `dopo l'aggiunta il diario dice solo: ${JSON.stringify(righe)}`).toBe(true);

  await restore(app, '__v567g2b');
});

test('a «l\'hai aggiunto?» Filo deve sapere che l\'utente l\'ha aggiunto', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await fingiApertura(app, '');

  // Come fakeProvider, ma mette da parte i messaggi con cui il turno riparte.
  await app.evaluate(async (_e, EV) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__v567g2c_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__v567g2c_msg = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis.__v567g2c_msg.push(JSON.stringify(
        (messages || []).filter((m) => m.role === 'assistant').map((m) => String(m.content || '')),
      ));
      n += 1;
      const calls = n === 1 ? [{ id: 'g2c', name: 'EVENTO_CALENDARIO', arguments: EV }] : [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      const text = calls.length ? '' : 'Rispondo.';
      if (text) { try { onDelta && onDelta(text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text, toolCalls: calls, reasoningDetails: [],
        finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, EVENTO);

  await chiedi(page, 'segnami la cena con Anna venerdì alle 20:30');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Rispondo.' })).toBeVisible({ timeout: 10_000 });

  await page.locator('.dash-action-btn', { hasText: 'Aggiungi al calendario' }).click();
  await expect(page.locator('.dash-action-btn', { hasText: 'Aperto nel calendario' })).toBeVisible({ timeout: 10_000 });

  await app.evaluate(() => { globalThis.__v567g2c_msg = []; });
  await chiedi(page, 'l\'hai aggiunto al calendario?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Rispondo.' }).nth(1)).toBeVisible({ timeout: 10_000 });

  // Un'impostazione confermata nel popup arriva al modello al turno dopo
  // («l'utente ha confermato, è già fatto»). L'evento aggiunto col bottone no:
  // nel contesto del turno seguente non ne resta niente.
  const visto = await app.evaluate(() => (globalThis.__v567g2c_msg || []).join('\n'));
  expect(visto, 'il modello non trova traccia dell\'evento aggiunto dall\'utente')
    .toMatch(/aggiunt\w*\s+(al\s+)?calendario|l.ha aggiunto|Cena con Anna/i);

  await app.evaluate(() => { try { globalThis.__v567g2c_restore?.(); } catch (_) {} });
});
