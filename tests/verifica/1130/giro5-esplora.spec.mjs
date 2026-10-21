// #1130 giro 5: un seguito durante un comando secco (porta del giro 4) e la chat riaperta dopo un turno chiuso.

import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, copione, ripristina as ripristinaCopione, testoDellaChiamata } from '../../helpers/copione.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';

const chiamate = (app) => app.evaluate(() => globalThis.__messaggi.length);
const ultimaChiamata = (app) => app.evaluate(() => globalThis.__messaggi[globalThis.__messaggi.length - 1]);
const ultimaChat = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app)[0]));

test('un seguito scritto durante il timer è letto nello stesso turno, e l\'archivio non ha una risposta vuota in mezzo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await copione(app, [
    { pensa: ['Metto il timer. '], ogni: 200, dopoStrumenti: 1_500, strumenti: [{ id: 'b1', name: 'TIMER', arguments: '{"secondi":120,"etichetta":"Pasta"}' }] },
    { pensa: ['Ha aggiunto una cosa. '], ogni: 200, testo: 'Timer messo, e ho letto anche il seguito.' },
  ]);
  await page.locator('#input').fill('metti un timer di due minuti');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-activity').first().locator('.dash-activity-seg-head').first()).toHaveText('Avvio un timer…', { timeout: 5_000 });
  await page.locator('#input').fill('e poi dimmi anche che ore sono');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'ho letto anche il seguito' })).toBeVisible({ timeout: 10_000 });
  expect(await chiamate(app)).toBe(2);
  const seconda = await ultimaChiamata(app);
  expect(testoDellaChiamata([seconda[seconda.length - 1]])).toContain('e poi dimmi anche che ore sono');
  const archivio = () => app.evaluate(async () => (await globalThis.SN_FILO_CHATS.list())
    .filter((c) => !c.app).flatMap((c) => c.messages.map((m) => `${m.role}: ${m.text}`)));
  await expect.poll(archivio, { timeout: 5_000 }).toEqual([
    'user: metti un timer di due minuti',
    'user: e poi dimmi anche che ore sono',
    'filo: Timer messo, e ho letto anche il seguito.',
  ]);
  await ripristinaCopione(app);
});

test('esplora: comando secco fermo sulla conferma senza testo, chat riaperta senza confermare', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await livelloAutonomia(app, 'conservativo');
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'f1', name: 'INVIA_FEEDBACK', arguments: '{"testo":"Il timer non suona.","titolo":"Timer muto"}' }] },
    { text: 'Te lo mando appena confermi.' },
    { text: 'Risposta al secondo messaggio.' },
  ]);
  await chiedi(page, 'segnala che il timer non suona');
  await expect(page.locator('.dash-action-btn', { hasText: 'Inviare questo feedback' })).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: 'tests/.shots/giro5-conferma-dal-vivo.png' });
  await expect.poll(async () => ((await ultimaChat(app)) || { messages: [] }).messages.length, { timeout: 5_000 }).toBe(2);
  const chat = await ultimaChat(app);
  console.log('ARCHIVIO', JSON.stringify(chat.messages.map((m) => ({ role: m.role, text: m.text, actions: m.actions }))));
  await page.keyboard.press('Escape');
  // Il messaggio dopo: cosa vede il modello del turno chiuso.
  await chiedi(page, 'allora?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Te lo mando appena confermi.' })).toBeVisible({ timeout: 10_000 });
  const ch = await chiamateAlModello(app);
  const storia = ch[ch.length - 1].filter((m) => m.role !== 'system').map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content.slice(0, 200) : JSON.stringify(m.content).slice(0, 200)}`);
  console.log('STORIA', JSON.stringify(storia));
  await app.evaluate((_e, chatId) => globalThis.SN_CLOSE_FILO_CHAT(chatId), chat.id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(chat.id)}`);
  await page.waitForTimeout(2_000);
  console.log('RIAPERTA', JSON.stringify(await page.locator('.dash-bubble').evaluateAll((els) => els.map((e) => `${e.className}: ${e.textContent.slice(0, 120)}`))));
  await page.screenshot({ path: 'tests/.shots/giro5-conferma-riaperta.png' });
  await ripristina(app);
});

test('esplora: timer senza testo, chat riaperta e messaggio dopo', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 't1', name: 'TIMER', arguments: '{"secondi":600,"etichetta":"Tè"}' }] },
    { text: 'Risposta al secondo messaggio.' },
  ]);
  await chiedi(page, 'timer 10 minuti per il tè');
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1_000);
  await chiedi(page, 'quanto manca?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta al secondo messaggio.' })).toBeVisible({ timeout: 10_000 });
  const ch = await chiamateAlModello(app);
  const storia = ch[ch.length - 1].filter((m) => m.role !== 'system').map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content.slice(0, 300) : JSON.stringify(m.content).slice(0, 300)}`);
  console.log('STORIA-TIMER', JSON.stringify(storia));
  const chat = await ultimaChat(app);
  console.log('ARCHIVIO-TIMER', JSON.stringify(chat.messages.map((m) => ({ role: m.role, text: m.text, actions: (m.actions || []).map((a) => a.type || a) }))));
  await app.evaluate((_e, chatId) => globalThis.SN_CLOSE_FILO_CHAT(chatId), chat.id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(chat.id)}`);
  await page.waitForTimeout(2_000);
  console.log('RIAPERTA-TIMER', JSON.stringify(await page.locator('.dash-bubble').evaluateAll((els) => els.map((e) => `${e.className}: ${e.textContent.slice(0, 120)}`))));
  await page.screenshot({ path: 'tests/.shots/giro5-timer-riaperta.png' });
  await ripristina(app);
});
