// #1685 — la chat della home racconta com'è andata ogni azione e cosa aspetta il sì: riaperta, dopo un riavvio, in
// un'altra conversazione (#1130.2, #1294); dopo l'OK riprende da sola solo se il lavoro non era finito (#1373); una
// conversazione chiusa in una home non la continua un'altra (#1443.2). Modello finto, nessuna rete.

import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from './helpers/chatFinta.mjs';
import { livelloAutonomia } from './helpers/autonomia.mjs';
import { clickConfirm, scrollConfirmToEnd, fillConfirmInput, CONFIRM_HOST } from './helpers/confirm.mjs';

const chatsDellaHome = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app)));
const chatCon = async (app, testo) => (await chatsDellaHome(app)).find((c) => c.messages.some((m) => m.text === testo)) || null;
// La memoria del main come dopo un riavvio: al modello resta solo quello che l'archivio ha scritto su disco.
const dimenticaLaMemoria = (app, id) => app.evaluate((_e, c) => globalThis.SN_CONTESTO_FILO.dimentica(c), id);
async function riapri(app, page, id) {
  await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(id)}`);
}
// Il turno di Filo che risponde a un messaggio, come il modello lo riceve: tutto quello che c'è fra quel messaggio e il
// prossimo dell'utente.
function rispostaA(storia, testo) {
  const i = storia.findIndex((m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes(testo));
  const dopo = [];
  for (const m of storia.slice(i + 1)) {
    if (m.role === 'user') break;
    dopo.push(typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''));
    if (Array.isArray(m.tool_calls)) dopo.push(JSON.stringify(m.tool_calls));
  }
  return dopo.join('\n');
}
const turniVuoti = (storia) => storia.filter((m) => m.role === 'assistant' && !(Array.isArray(m.tool_calls) && m.tool_calls.length)
  && (!String(typeof m.content === 'string' ? m.content : '').trim() || m.content === '(nessun testo)'));

// Senza modalità terminale un comando non parte: un'azione che non riesce, col suo perché.
const terminaleSpento = (app) => app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: false } }));

const FEEDBACK = { id: 'f1', name: 'INVIA_FEEDBACK', arguments: '{"testo":"Il timer non suona.","titolo":"Timer muto"}' };

test('#1130.2 una proposta ferma sulla conferma, senza testo, resta nella chat riaperta e nel contesto dopo un riavvio', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await livelloAutonomia(app, 'conservativo');
  await modelloFinto(app, [{ text: '', toolCalls: [FEEDBACK] }, { text: 'Va bene, aggiungo anche il volume.' }]);
  await chiedi(page, 'segnala che il timer non suona');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await clickConfirm(page, 'cancel');
  const chat = await chatCon(app, 'segnala che il timer non suona');
  const risposta = chat.messages[chat.messages.length - 1];
  expect(risposta.role).toBe('filo');
  expect(risposta.esiti, 'l\'archivio sa che era una proposta ferma sulla conferma').toEqual([
    expect.objectContaining({ type: 'INVIA_FEEDBACK', esito: 'chiesto', riga: expect.stringMatching(/feedback/i) }),
  ]);

  await dimenticaLaMemoria(app, chat.id);
  await riapri(app, page, chat.id);
  await expect(page.locator('.dash-bubble-user', { hasText: 'segnala che il timer non suona' })).toBeVisible({ timeout: 8_000 });
  const bolla = page.locator('.dash-bubble-filo');
  await expect(bolla, 'riaperta, la chat mostra la risposta di Filo a quel messaggio').toHaveCount(1);
  await expect(bolla.locator('.dash-activity-row')).toHaveText(/Conferma chiesta · .*feedback/i);
  await page.screenshot({ path: 'tests/.shots/chat-esiti-proposta-riaperta.png' });

  const prima = (await chiamateAlModello(app)).length;
  await chiedi(page, 'aggiungi che succede col volume basso');
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBeGreaterThan(prima);
  const ch = await chiamateAlModello(app);
  const storia = ch[ch.length - 1];
  expect(rispostaA(storia, 'segnala che il timer non suona'), 'il modello sa cosa aveva proposto, e che non è fatto')
    .toMatch(/NON fatta: chiesta la conferma.*feedback/is);
  expect(turniVuoti(storia), 'nessun turno vuoto va al modello').toEqual([]);
  await ripristina(app);
});

test('#1294 riaperta, la chat racconta la cosa fatta e quella non riuscita col perché, e il modello lo legge', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await terminaleSpento(app);
  await modelloFinto(app, [
    { toolCalls: [
      { id: 't1', name: 'TIMER', arguments: '{"secondi":300,"etichetta":"Pasta"}' },
      { id: 'c1', name: 'ESEGUI_COMANDO', arguments: '{"comando":"ls","spiegazione":"Elenco i file"}' },
    ] },
    { text: 'Il timer è partito, il comando no.' },
    { text: 'Ok.' },
  ]);
  await chiedi(page, 'timer di 5 minuti per la pasta e lancia ls');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Il timer è partito' })).toBeVisible({ timeout: 10_000 });
  const chat = await chatCon(app, 'timer di 5 minuti per la pasta e lancia ls');
  await dimenticaLaMemoria(app, chat.id);
  await riapri(app, page, chat.id);
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'Il timer è partito' });
  await expect(bolla).toBeVisible({ timeout: 8_000 });
  await expect(bolla.locator('.dash-activity-row', { hasText: 'Pasta' })).toBeVisible();
  await expect(bolla.locator('.dash-activity-row', { hasText: /Non riuscita · .*la modalità terminale è spenta/ })).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/chat-esiti-riaperta.png' });

  const prima = (await chiamateAlModello(app)).length;
  await chiedi(page, 'e il comando?');
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBeGreaterThan(prima);
  const ch = await chiamateAlModello(app);
  const detto = rispostaA(ch[ch.length - 1], 'timer di 5 minuti per la pasta');
  expect(detto).toMatch(/fatta: .*Pasta/);
  expect(detto).toMatch(/NON riuscita: .*\(perché: la modalità terminale è spenta\)/);
  await ripristina(app);
});

test('#1373 un comando secco confermato non richiama il modello: il bottone dice cosa è stato fatto', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await livelloAutonomia(app, 'conservativo');
  await modelloFinto(app, [{ text: '', toolCalls: [FEEDBACK] }, { text: 'GIRO IN PIÙ' }]);
  await chiedi(page, 'segnala che il timer non suona');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'ok');
  await expect(page.locator('.dash-action-btn', { hasText: /^✓/ })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  expect((await chiamateAlModello(app)).length, 'nessun giro dopo l\'OK: il lavoro era finito').toBe(1);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'GIRO IN PIÙ' })).toHaveCount(0);
  const chat = await chatCon(app, 'segnala che il timer non suona');
  expect(chat.messages.flatMap((m) => m.esiti || []).map((v) => `${v.type}:${v.esito}`)).toEqual(['INVIA_FEEDBACK:chiesto', 'INVIA_FEEDBACK:fatto']);
  await ripristina(app);
});

test('#1373 dopo l\'OK che sblocca un passo rimasto indietro Filo riprende da solo, senza un «vai avanti»', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await terminaleSpento(app);
  await modelloFinto(app, [
    { toolCalls: [
      { id: 'c1', name: 'ESEGUI_COMANDO', arguments: '{"comando":"echo ciao","spiegazione":"Scrivo ciao"}' },
      { id: 'p1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"modalita_terminale","valore":true}' },
    ] },
    { text: 'Accendo il terminale e poi lo lancio.' },
    { text: 'RIPRESO DA SOLO dopo il sì.' },
  ]);
  await chiedi(page, 'lancia echo ciao');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Accendo il terminale' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
  await fillConfirmInput(page, 'conferma');
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'danger');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RIPRESO DA SOLO' })).toBeVisible({ timeout: 10_000 });
  const ch = await chiamateAlModello(app);
  expect(ch).toHaveLength(3);
  expect(JSON.stringify(ch[2])).toContain('ha CONFERMATO');
  await ripristina(app);
});

test('#1294 la conferma data dopo aver cambiato conversazione resta in quella dove è nato il bottone', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await livelloAutonomia(app, 'conservativo');
  await modelloFinto(app, [{ text: '', toolCalls: [FEEDBACK] }]);
  await chiedi(page, 'segnala che il timer non suona');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await clickConfirm(page, 'cancel');
  const nata = await chatCon(app, 'segnala che il timer non suona');
  await chiedi(page, '/clear');
  await page.locator('.dash-action-btn', { hasText: /feedback/i }).click();
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'ok');
  await expect(page.locator('.dash-action-btn', { hasText: /^✓/ })).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => {
    const c = (await chatsDellaHome(app)).find((x) => x.id === nata.id);
    return c.messages.flatMap((m) => m.esiti || []).map((v) => v.esito);
  }, { timeout: 5_000 }).toEqual(['chiesto', 'fatto']);
  const altre = (await chatsDellaHome(app)).filter((c) => c.id !== nata.id);
  expect(altre.flatMap((c) => c.messages.flatMap((m) => m.esiti || [])), 'nessuna conversazione nuova con dentro solo la conferma').toEqual([]);
  await ripristina(app);
});

test('#1443.2 chiusa in una home, la conversazione non la continua un\'altra home già aperta su di essa', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'f1', name: 'COMANDO_FINESTRA', arguments: '{"comando":"home"}' }] },
    { text: 'Sei già qui, nella home.' },
    { text: 'Di niente.' },
  ]);
  await chiedi(page, 'portami alla home');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sei già qui' })).toBeVisible({ timeout: 10_000 });

  const b = await openTab('filo://newtab/');
  await expect(b.locator('#input')).toBeVisible();
  await expect(b.locator('.dash-bubble-user', { hasText: 'portami alla home' })).toBeVisible({ timeout: 10_000 });
  await shell.locator('.tab').first().click();
  await page.locator('.dash-action-btn', { hasText: 'Chiudi la conversazione' }).click();
  const chiusa = (await chatCon(app, 'portami alla home')).id;
  await expect.poll(async () => (await chatsDellaHome(app)).find((c) => c.id === chiusa)?.finita).toBe(true);
  await shell.locator('.tab').nth(1).click();
  await expect(b.locator('.dash-bubble-note', { hasText: 'chiusa in un\'altra scheda' })).toBeVisible({ timeout: 5_000 });
  await chiedi(b, 'grazie');
  await expect(b.locator('.dash-bubble-filo', { hasText: 'Di niente.' })).toBeVisible({ timeout: 10_000 });
  const dove = await chatCon(app, 'grazie');
  expect(dove && dove.id, 'il messaggio dopo apre una conversazione nuova').not.toBe(chiusa);
  await ripristina(app);
});
