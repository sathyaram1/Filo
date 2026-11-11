// #1685 — la chat della home racconta com'è andata ogni azione e cosa aspetta il sì: riaperta, dopo un riavvio, in
// un'altra conversazione (#1130.2, #1294); dopo l'OK l'esito torna al modello, che continua o chiude muto (#1373); una
// conversazione chiusa in una home non la continua un'altra (#1443.2). Modello finto e nessuna rete.

import { test, expect } from './fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from './helpers/chatFinta.mjs';
import { livelloAutonomia } from './helpers/autonomia.mjs';
import { clickConfirm, scrollConfirmToEnd, fillConfirmInput, CONFIRM_HOST } from './helpers/confirm.mjs';
import { cartellaTemporanea, togliCartella } from './helpers/percorsi.mjs';

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
  // Il turno archivia la proposta ferma, poi l'Annulla la chiude come un no: si aspetta la seconda scrittura.
  await expect.poll(async () => {
    const c = await chatCon(app, 'segnala che il timer non suona');
    const r = c && c.messages[c.messages.length - 1];
    return r && r.role === 'filo' ? (r.esiti || []).map((v) => `${v.type}:${v.esito}:${v.motivo || ''}`) : [];
  }, { timeout: 8_000, message: 'l\'archivio sa che la proposta ha avuto un no' }).toEqual(['INVIA_FEEDBACK:fallito:detto no alla conferma']);
  const chat = await chatCon(app, 'segnala che il timer non suona');
  expect(chat.messages[chat.messages.length - 1].esiti[0].riga).toMatch(/feedback/i);

  await dimenticaLaMemoria(app, chat.id);
  await riapri(app, page, chat.id);
  await expect(page.locator('.dash-bubble-user', { hasText: 'segnala che il timer non suona' })).toBeVisible({ timeout: 8_000 });
  const bolla = page.locator('.dash-bubble-filo');
  await expect(bolla, 'riaperta, la chat mostra la risposta di Filo a quel messaggio').toHaveCount(1);
  // Annullato il popup, la proposta resta scritta come un no (#1685): cosa era, e che non è partita.
  await expect(bolla.locator('.dash-activity-row')).toHaveText(/Segnalazione non inviata · detto no alla conferma/i);
  await page.screenshot({ path: 'tests/.shots/chat-esiti-proposta-riaperta.png' });

  const prima = (await chiamateAlModello(app)).length;
  await chiedi(page, 'aggiungi che succede col volume basso');
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBeGreaterThan(prima);
  const ch = await chiamateAlModello(app);
  const storia = ch[ch.length - 1];
  expect(rispostaA(storia, 'segnala che il timer non suona'), 'il modello sa cosa aveva proposto, e che non è fatto')
    .toMatch(/NON riuscita: [^\n]*feedback[^\n]*perché: detto no alla conferma/i);
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
  // Il testo scorre prima che il turno finisca: la memoria si dimentica dopo che il main l'ha scritta.
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  const chat = await chatCon(app, 'timer di 5 minuti per la pasta e lancia ls');
  await dimenticaLaMemoria(app, chat.id);
  await riapri(app, page, chat.id);
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'Il timer è partito' });
  await expect(bolla).toBeVisible({ timeout: 8_000 });
  // Le parole e i numeri del diario in diretta, mai la frase della proposta («Avviare il timer»).
  await expect(bolla.locator('.dash-activity-row', { hasText: 'Pasta' })).toHaveText(/Timer avviato · Pasta · 5 min/);
  await expect(bolla.locator('.dash-activity-row', { hasText: /Comando non eseguito · la modalità terminale è spenta/ })).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/chat-esiti-riaperta.png' });

  const prima = (await chiamateAlModello(app)).length;
  await chiedi(page, 'e il comando?');
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBeGreaterThan(prima);
  const ch = await chiamateAlModello(app);
  const detto = rispostaA(ch[ch.length - 1], 'timer di 5 minuti per la pasta');
  expect(detto).toMatch(/fatta: Timer avviato · Pasta · 5 min/);
  expect(detto).toMatch(/NON riuscita: .*\(perché: la modalità terminale è spenta\)/);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  await page.reload();
  await expect(bolla.locator('.dash-activity-row', { hasText: 'Comando non eseguito' })).toBeVisible({ timeout: 8_000 });
  await page.screenshot({ path: 'tests/.shots/chat-esiti-riaperta-scuro.png' });
  await ripristina(app);
});

test('#1294 riaperta, la chat ridà il bottone del file che la risposta mostrava', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Ricevute');
  const file = join(dir, 'ricevuta-assicurazione.pdf');
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, '%PDF-1.4\n');
  try {
    const page = await home(app);
    // Mostrare un file parla da sé (#1130): il turno si chiude col bottone, senza frase.
    await modelloFinto(app, [
      { toolCalls: [{ id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: file, etichetta: 'La ricevuta' }) }] },
    ]);
    await chiedi(page, 'dov\'è la ricevuta dell\'assicurazione?');
    await expect(page.locator('.dash-file-btn')).toHaveCount(1, { timeout: 10_000 });
    const chat = await chatCon(app, 'dov\'è la ricevuta dell\'assicurazione?');
    await dimenticaLaMemoria(app, chat.id);
    await riapri(app, page, chat.id);
    const btn = page.locator('.dash-bubble-filo .dash-file-btn');
    await expect(btn).toHaveCount(1, { timeout: 8_000 });
    await expect(btn).toHaveAttribute('data-percorso', file);
    await expect(btn.locator('.dash-file-btn-nome')).toHaveText('ricevuta-assicurazione.pdf');
    await expect(btn.locator('.dash-file-btn-etichetta')).toHaveText('La ricevuta');
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

// Accendere il terminale chiede la parola «conferma» (#530) e riesce anche senza rete.
const TERMINALE = { id: 'p1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"modalita_terminale","valore":true}' };
async function confermaScritta(page) {
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await fillConfirmInput(page, 'conferma');
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'danger');
}

// Dopo l'OK il modello riparte sempre con l'esito, come negli harness di Anthropic: a lavoro finito chiude muto.
test('#1373 un comando secco confermato: Filo riparte con l\'esito e, a lavoro finito, chiude senza una bolla in più', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await terminaleSpento(app);
  await modelloFinto(app, [{ text: '', toolCalls: [TERMINALE] }, { text: '' }]);
  await chiedi(page, 'accendi il terminale');
  await confermaScritta(page);
  await expect(page.locator('.dash-action-btn', { hasText: /^✓/ })).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 8_000, message: 'dopo l\'OK l\'esito torna al modello' }).toBe(2);
  const ch = await chiamateAlModello(app);
  const ultima = ch[1][ch[1].length - 1];
  expect(ultima.role).toBe('user');
  expect(String(ultima.content), 'il modello legge com\'è andata, non solo «riprendi»').toMatch(/conferma[\s\S]*fatta: [^\n]*terminale/i);
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);
  await expect(page.locator('.dash-bubble-filo'), 'nessuna bolla vuota né «(vuoto)» dopo il sì').toHaveCount(1);
  await expect(page.locator('.dash-bubble-filo', { hasText: '(vuoto)' })).toHaveCount(0);
  await expect(page.locator('.dash-activity')).toHaveCount(1);
  const chat = await chatCon(app, 'accendi il terminale');
  expect(chat.messages.flatMap((m) => m.esiti || []).map((v) => `${v.type}:${v.esito}`))
    .toEqual(['IMPOSTA_PREFERENZA:fatto']);
  expect(chat.messages.filter((m) => m.role === 'filo' && !String(m.text || '').trim() && !(m.esiti || []).length),
    'la ripresa muta non lascia un messaggio vuoto nella conversazione').toEqual([]);
  // Nemmeno nella scheda: il messaggio dopo non porta al modello un turno vuoto, che alcuni fornitori rifiutano.
  await chiedi(page, 'grazie');
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBe(3);
  expect(turniVuoti((await chiamateAlModello(app))[2]), 'nessun turno vuoto va al modello').toEqual([]);
  await ripristina(app);
});

test('#1373 dopo l\'OK che sblocca un passo rimasto indietro Filo riprende da solo, senza un «vai avanti»', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await terminaleSpento(app);
  await modelloFinto(app, [
    { toolCalls: [
      { id: 'c1', name: 'ESEGUI_COMANDO', arguments: '{"comando":"echo ciao","spiegazione":"Scrivo ciao"}' },
      TERMINALE,
    ] },
    { text: 'Accendo il terminale e poi lo lancio.' },
    { text: 'RIPRESO DA SOLO dopo il sì.' },
  ]);
  await chiedi(page, 'lancia echo ciao');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Accendo il terminale' })).toBeVisible({ timeout: 10_000 });
  await confermaScritta(page);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RIPRESO DA SOLO' })).toBeVisible({ timeout: 10_000 });
  const ch = await chiamateAlModello(app);
  expect(ch).toHaveLength(3);
  expect(JSON.stringify(ch[2])).toContain('ha CONFERMATO');
  await ripristina(app);
});

test('#1373 chiesti due passi, il modello propone il primo e aspetta l\'OK: dopo l\'OK Filo riprende da solo', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await terminaleSpento(app);
  await modelloFinto(app, [{ text: '', toolCalls: [TERMINALE] }, { text: 'RIPRESO DA SOLO: ora lancio ls.' }]);
  await chiedi(page, 'accendi il terminale e poi lancia ls');
  await confermaScritta(page);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RIPRESO DA SOLO' })).toBeVisible({ timeout: 10_000 });
  const ch = await chiamateAlModello(app);
  expect(ch).toHaveLength(2);
  expect(JSON.stringify(ch[1])).toContain('ha CONFERMATO');
  expect(JSON.stringify(ch[0]), 'nessun campo da dichiarare sulle azioni').not.toContain('"poi"');
  await ripristina(app);
});

test('#1373 un no alla conferma non richiama il modello, e al messaggio dopo il modello sa che non è stato fatto', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await terminaleSpento(app);
  await modelloFinto(app, [{ text: '', toolCalls: [TERMINALE] }, { text: 'Va bene.' }]);
  await chiedi(page, 'accendi il terminale');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await clickConfirm(page, 'cancel');
  await page.waitForTimeout(1500);
  expect((await chiamateAlModello(app)).length, 'dopo un no Filo aspetta l\'utente').toBe(1);
  await chiedi(page, 'lascia stare, dimmi l\'ora');
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBe(2);
  const ch = await chiamateAlModello(app);
  expect(rispostaA(ch[1], 'accendi il terminale'), 'il modello sa del no').toMatch(/detto NO alla conferma[\s\S]*terminale/i);
  await ripristina(app);
});

test('#1294 la conferma data dopo aver cambiato conversazione resta in quella dove è nato il bottone', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await terminaleSpento(app);
  await modelloFinto(app, [{ text: '', toolCalls: [TERMINALE] }]);
  await chiedi(page, 'accendi il terminale');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await clickConfirm(page, 'cancel');
  const nata = await chatCon(app, 'accendi il terminale');
  await chiedi(page, '/clear');
  await page.locator('.dash-bubble-filo .dash-action-btn-primary').click();
  await confermaScritta(page);
  await expect(page.locator('.dash-action-btn', { hasText: /^✓/ })).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => {
    const c = (await chatsDellaHome(app)).find((x) => x.id === nata.id);
    return c.messages.flatMap((m) => m.esiti || []).map((v) => v.esito);
  }, { timeout: 5_000 }).toEqual(['fatto']);
  const altre = (await chatsDellaHome(app)).filter((c) => c.id !== nata.id);
  expect(altre.flatMap((c) => c.messages.flatMap((m) => m.esiti || [])), 'nessuna conversazione nuova con dentro solo la conferma').toEqual([]);
  await page.waitForTimeout(1500);
  expect((await chiamateAlModello(app)).length, 'l\'OK della conversazione di prima non fa ripartire il lavoro in quella nuova').toBe(1);
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
  await chiedi(b, 'grazie');
  await expect(b.locator('.dash-bubble-filo', { hasText: 'Di niente.' })).toBeVisible({ timeout: 10_000 });
  const dove = await chatCon(app, 'grazie');
  expect(dove && dove.id, 'il messaggio dopo apre una conversazione nuova').not.toBe(chiusa);
  await ripristina(app);
});

// Le conferme di una stessa risposta sono un passo solo, come negli harness di Anthropic: il lavoro riprende quando
// ognuna ha la sua risposta, e un OK dato mentre Filo risponde riparte a turno finito invece di perdersi.
async function okAlBottone(page, bottone) {
  await bottone.click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
  if (await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'ok');
  await expect(bottone).toHaveText(/^✓/, { timeout: 10_000 });
}
const mkdir = (id, dir, nome) => ({ id, name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `mkdir "${join(dir, nome)}"`, spiegazione: `Creo la cartella ${nome}` }) });
const ultimoMessaggio = (c) => JSON.stringify(c[c.length - 1]);

test('#1685 due comandi da confermare nella stessa risposta: Filo riprende dopo il secondo OK, con gli esiti di tutti e due', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('esiti-conferme-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [
      { text: 'Creo le due cartelle.', toolCalls: [mkdir('c1', dir, 'uno'), mkdir('c2', dir, 'due')] },
      { text: 'Aspetto i tuoi OK.' },
      { text: 'Fatte tutte e due.' },
    ]);
    await chiedi(page, 'crea le cartelle uno e due');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Aspetto i tuoi OK' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const bottoni = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: /Creo la cartella/ });
    await okAlBottone(page, bottoni.filter({ hasText: 'uno' }));
    await page.waitForTimeout(1500);
    expect((await chiamateAlModello(app)).length, 'col secondo comando ancora da confermare il modello aspetta').toBe(2);
    await okAlBottone(page, bottoni.filter({ hasText: 'due' }));
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatte tutte e due' })).toBeVisible({ timeout: 10_000 });
    const ch = await chiamateAlModello(app);
    expect(ch).toHaveLength(3);
    expect(ultimoMessaggio(ch[2])).toMatch(/fatta: Comando eseguito · mkdir[^\n]*uno[\s\S]*fatta: Comando eseguito · mkdir[^\n]*due/);
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});

test('#1685 un OK dato mentre Filo risponde a un altro messaggio riprende il lavoro a risposta finita', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('esiti-conferme-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [
      { text: 'Creo la cartella.', toolCalls: [mkdir('c1', dir, 'tre')] },
      { text: 'Aspetto il tuo OK.' },
      { text: 'Sono le dieci.', ritardoMs: 3000 },
      { text: 'Cartella creata, ho finito.' },
    ]);
    await chiedi(page, 'crea la cartella tre');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Aspetto il tuo OK' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    await chiedi(page, 'intanto che ore sono?');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 5_000 }).toBe(3);
    await okAlBottone(page, page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Creo la cartella tre' }));
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Sono le dieci' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Cartella creata, ho finito' })).toBeVisible({ timeout: 10_000 });
    const ch = await chiamateAlModello(app);
    expect(ultimoMessaggio(ch[3])).toMatch(/fatta: Comando eseguito · mkdir[^\n]*tre/);
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});

test('#1685 chiusa in una home mentre l\'altra sta rispondendo dentro di essa: domanda e risposta restano una volta sola', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Ciao a te.' }, { text: 'Bene, grazie.', ritardoMs: 4000 }]);
  await chiedi(page, 'ciao filo');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ciao a te' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  const b = await openTab('filo://newtab/');
  await expect(b.locator('.dash-bubble-user', { hasText: 'ciao filo' })).toBeVisible({ timeout: 10_000 });
  await chiedi(b, 'come stai');
  await b.waitForTimeout(800);
  await shell.locator('.tab').first().click();
  await chiedi(page, '/clear');
  await shell.locator('.tab').nth(1).click();
  await expect(b.locator('.dash-bubble-filo', { hasText: 'Bene, grazie.' }).first()).toBeVisible({ timeout: 10_000 });
  await expect(b.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  await b.waitForTimeout(1500);
  await expect(b.locator('.dash-bubble-user', { hasText: 'come stai' })).toHaveCount(1);
  await expect(b.locator('.dash-bubble-filo', { hasText: 'Bene, grazie.' })).toHaveCount(1);
  await ripristina(app);
});

// Un sì o un no dato al bottone dopo il turno chiude la domanda nella risposta che l'aveva fatta (#1685): riaperta dopo un
// riavvio, la chat dice com'è finita con le parole del diario, e il modello non legge una conferma «non ancora data».
test('#1685 comando confermato al bottone: riaperta dopo un riavvio, la riga dice fatto e il modello lo sa', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('esiti-conferme-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [{ text: 'Creo la cartella.', toolCalls: [mkdir('c1', dir, 'nuova')] }, { text: '' }, { text: 'Ok.' }]);
    await chiedi(page, 'crea la cartella nuova');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    await okAlBottone(page, page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Creo la cartella nuova' }));
    await expect.poll(async () => (await chatCon(app, 'crea la cartella nuova'))?.messages.flatMap((m) => m.esiti || []).map((v) => v.esito), { timeout: 8_000 })
      .toEqual(['fatto']);
    const chat = await chatCon(app, 'crea la cartella nuova');
    expect(chat.messages.filter((m) => m.role === 'filo' && !String(m.text || '').trim()), 'nessuna risposta senza parole a parte').toEqual([]);
    await dimenticaLaMemoria(app, chat.id);
    await riapri(app, page, chat.id);
    const bolla = page.locator('.dash-bubble-filo', { hasText: 'Creo la cartella.' });
    await expect(bolla.locator('.dash-activity-row')).toHaveText(/Comando eseguito.*mkdir.*nuova/, { timeout: 8_000 });
    await expect(bolla).not.toContainText('Conferma chiesta');
    const prima = (await chiamateAlModello(app)).length;
    await chiedi(page, 'l\'hai creata?');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBeGreaterThan(prima);
    const ch = await chiamateAlModello(app);
    const risposta = rispostaA(ch[ch.length - 1], 'crea la cartella nuova');
    expect(risposta, 'dopo un riavvio il modello sa che è fatta').toMatch(/fatta: Comando eseguito[^\n]*nuova/);
    expect(risposta).not.toMatch(/non l'aveva ancora data|azioni di questo turno/);
    expect(turniVuoti(ch[ch.length - 1])).toEqual([]);
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});

test('#1685 un no al bottone resta un no: riaperta dopo un riavvio, la chat e il modello sanno che l\'utente ha rifiutato', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await terminaleSpento(app);
  await modelloFinto(app, [{ text: '', toolCalls: [TERMINALE] }, { text: 'Va bene.' }]);
  await chiedi(page, 'accendi il terminale');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await clickConfirm(page, 'cancel');
  await expect.poll(async () => (await chatCon(app, 'accendi il terminale'))?.messages.flatMap((m) => m.esiti || []).map((v) => v.esito), { timeout: 8_000 })
    .toEqual(['fallito']);
  const chat = await chatCon(app, 'accendi il terminale');
  await dimenticaLaMemoria(app, chat.id);
  await riapri(app, page, chat.id);
  const riga = page.locator('.dash-bubble-filo .dash-activity-row');
  await expect(riga).toHaveText(/detto no alla conferma/, { timeout: 8_000 });
  await chiedi(page, 'come va?');
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBe(2);
  const ch = await chiamateAlModello(app);
  const risposta = rispostaA(ch[1], 'accendi il terminale');
  expect(risposta).toMatch(/NON riuscita[^\n]*perché: detto no alla conferma/);
  expect(risposta).not.toMatch(/non l'aveva ancora data/);
  await ripristina(app);
});

test('#1685 un OK nel popup: riaperta, la riga dice quello che diceva il diario in diretta', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await terminaleSpento(app);
  await modelloFinto(app, [{ text: '', toolCalls: [TERMINALE] }, { text: '' }]);
  await chiedi(page, 'accendi il terminale');
  await confermaScritta(page);
  await expect(page.locator('.dash-action-btn', { hasText: /^✓/ })).toBeVisible({ timeout: 10_000 });
  const righe = await page.locator('.dash-activity-row').allTextContents();
  const detto = righe.map((t) => t.replace(/^[^A-Za-zÀ-ÿ]+/, '').trim()).find((t) => /terminale/i.test(t) && !/Conferma chiesta/.test(t));
  expect(detto, `una riga del diario racconta il terminale acceso: ${righe.join(' | ')}`).toBeTruthy();
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  const chat = await chatCon(app, 'accendi il terminale');
  await riapri(app, page, chat.id);
  await expect(page.locator('.dash-bubble-filo .dash-activity-row').first(), 'le stesse parole del diario').toContainText(detto, { timeout: 8_000 });
  await ripristina(app);
});

const EVENTO = { id: 'e1', name: 'EVENTO_CALENDARIO', arguments: '{"data":"2026-12-01","ora":"10:00","titolo":"Dentista"}' };

test('#1685 un evento proposto: riaperta, il bottone c\'è ancora; aggiunto, la chat dice aggiunto e non torna «proposto»', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Ecco l\'evento.', toolCalls: [EVENTO] }, { text: 'Ok.' }]);
  await chiedi(page, 'metti il dentista il primo dicembre');
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  const chat = await chatCon(app, 'metti il dentista il primo dicembre');
  await riapri(app, page, chat.id);
  const bottone = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Aggiungi al calendario' });
  await expect(bottone, 'riaperta, l\'evento si aggiunge ancora col bottone').toBeVisible({ timeout: 8_000 });
  await bottone.click();
  await expect(page.locator('.dash-bubble-filo .dash-action-btn', { hasText: /^✓/ })).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await chatCon(app, 'metti il dentista il primo dicembre'))?.messages.flatMap((m) => m.esiti || []).map((v) => v.esito), { timeout: 8_000 })
    .toEqual(['compiuto']);
  await dimenticaLaMemoria(app, chat.id);
  await riapri(app, page, chat.id);
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'Ecco l\'evento.' });
  await expect(bolla).toContainText('Evento aggiunto al calendario', { timeout: 8_000 });
  await expect(bolla).not.toContainText('proposto');
  await ripristina(app);
});

test('#1685 un evento che nessun programma apre: il diario, la chat salvata e il modello non lo dicono nel calendario', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(({ shell }) => {
    globalThis.__openPathVero = shell.openPath;
    shell.openPath = async () => 'nessuna applicazione';
  });
  try {
    await modelloFinto(app, [{ text: 'Ecco l\'evento.', toolCalls: [EVENTO] }, { text: 'Ok.' }]);
    await chiedi(page, 'metti il dentista il primo dicembre');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    await page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Aggiungi al calendario' }).click();
    await expect(page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Evento salvato' })).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => (await chatCon(app, 'metti il dentista il primo dicembre'))?.messages.flatMap((m) => m.esiti || []).map((v) => v.riga).join('|'), { timeout: 8_000 })
      .toMatch(/il calendario non si è aperto/);
    const chat = await chatCon(app, 'metti il dentista il primo dicembre');
    expect(JSON.stringify(chat.messages)).not.toContain('Evento aggiunto al calendario');
    await dimenticaLaMemoria(app, chat.id);
    await riapri(app, page, chat.id);
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco l\'evento.' })).toContainText('il calendario non si è aperto', { timeout: 8_000 });
    await chiedi(page, 'è in calendario?');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBe(2);
    const ch = await chiamateAlModello(app);
    expect(rispostaA(ch[1], 'metti il dentista il primo dicembre')).toMatch(/fatta: Evento salvato in un file, il calendario non si è aperto/);
  } finally {
    await app.evaluate(({ shell }) => { if (globalThis.__openPathVero) shell.openPath = globalThis.__openPathVero; });
    await ripristina(app);
  }
});

test('#1685 un evento che nessun programma apre: chiesto subito nella stessa home, il modello non lo dice nel calendario', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(({ shell }) => {
    globalThis.__openPathVero = shell.openPath;
    shell.openPath = async () => 'nessuna applicazione';
  });
  try {
    await modelloFinto(app, [{ text: 'Ecco l\'evento.', toolCalls: [EVENTO] }, { text: 'Ok.' }]);
    await chiedi(page, 'metti il dentista il primo dicembre');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    await page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Aggiungi al calendario' }).click();
    await expect(page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Evento salvato' })).toBeVisible({ timeout: 10_000 });
    await chiedi(page, 'è in calendario?');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBe(2);
    const detto = JSON.stringify((await chiamateAlModello(app))[1]);
    expect(detto, 'la scheda aperta dice al modello quello che dice il bottone').toContain('il calendario non si è aperto');
    expect(detto).not.toContain('Evento aggiunto al calendario');
  } finally {
    await app.evaluate(({ shell }) => { if (globalThis.__openPathVero) shell.openPath = globalThis.__openPathVero; });
    await ripristina(app);
  }
});

// Una cartella sotto un file non nasce su nessun sistema: il comando parte ed esce con errore, ovunque.
test('#1373 un comando che non riesce dopo l\'OK: il modello riceve il perché e lo dice in chat', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('esiti-conferme-');
  writeFileSync(join(dir, 'blocco'), 'un file, non una cartella');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    const comando = { id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `mkdir "${join(dir, 'blocco', 'sotto')}"`, spiegazione: 'Creo la sottocartella' }) };
    await modelloFinto(app, [{ text: '', toolCalls: [comando] }, { text: 'NON È ANDATO: lì c\'è un file.' }]);
    await chiedi(page, 'crea la sottocartella');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const bottone = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Creo la sottocartella' });
    await bottone.click();
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
    if (await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
    await scrollConfirmToEnd(page);
    await clickConfirm(page, 'ok');
    await expect(bottone).toHaveText(/^✗/, { timeout: 10_000 });
    await expect(page.locator('.dash-bubble-filo', { hasText: 'NON È ANDATO' }), 'il modello dice in chat cosa non è andato').toBeVisible({ timeout: 10_000 });
    const ch = await chiamateAlModello(app);
    expect(ch).toHaveLength(2);
    expect(ultimoMessaggio(ch[1]), 'il modello riceve com\'è andata, col perché').toMatch(/NON riuscita: Creo la sottocartella \(perché: uscito con codice/);
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});

// Un comando partito e uscito con errore (#1294 punto 1): riaperta dopo un riavvio la riga non dice «non eseguito» e
// porta il perché, alla chat e al modello.
test('#1685 un comando che esce con errore: riaperta dopo un riavvio, la riga e il modello dicono che è partito e perché non è riuscito', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('esiti-conferme-');
  writeFileSync(join(dir, 'blocco'), 'un file, non una cartella');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'normale');
    const cmd = { id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `ls "${join(dir, 'blocco', 'dentro')}"`, spiegazione: 'Elenco i file' }) };
    await modelloFinto(app, [{ text: '', toolCalls: [cmd] }, { text: 'Non è andata.' }, { text: 'Ok.' }]);
    await chiedi(page, 'elenca i file di quella cartella');
    await expect.poll(async () => (await chatCon(app, 'elenca i file di quella cartella'))?.messages.flatMap((m) => m.esiti || []).map((v) => v.esito), { timeout: 10_000 })
      .toEqual(['fallito']);
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const chat = await chatCon(app, 'elenca i file di quella cartella');
    await dimenticaLaMemoria(app, chat.id);
    await riapri(app, page, chat.id);
    const riga = page.locator('.dash-bubble-filo .dash-activity-row');
    await expect(riga).toHaveCount(1, { timeout: 8_000 });
    await expect(riga).toHaveText(/Comando non riuscito · uscito con codice/);
    await chiedi(page, 'quel comando è partito?');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBe(3);
    expect(rispostaA((await chiamateAlModello(app))[2], 'elenca i file di quella cartella'), 'dopo un riavvio il modello sa perché')
      .toMatch(/NON riuscita: [^\n]*\(perché: uscito con codice/);
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});

// Una segnalazione confermata che non parte: il diario, la ripresa e la chat riaperta dicono perché, con le parole
// della domanda a cui l'utente aveva risposto, mai il nome interno dell'azione.
test('#1685 una segnalazione confermata che non parte: la ripresa e la chat riaperta dicono cosa e perché', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(() => {
    globalThis.__submitVero = globalThis.SN_FEEDBACK.submit;
    globalThis.SN_FEEDBACK.submit = async () => { throw new Error('fetch failed'); };
  });
  try {
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [{ text: '', toolCalls: [FEEDBACK] }, { text: 'NON PARTITA: manca la rete.' }, { text: 'Ok.' }]);
    await chiedi(page, 'segnala che il timer non suona');
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
    if (await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
    await scrollConfirmToEnd(page);
    await clickConfirm(page, 'ok');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'NON PARTITA' })).toBeVisible({ timeout: 10_000 });
    const ch = await chiamateAlModello(app);
    expect(ultimoMessaggio(ch[1]), 'la ripresa sa cosa non è partito e perché')
      .toMatch(/NON riuscita: Inviare questo feedback[^\n]*\(perché: problema di rete/);
    expect(ultimoMessaggio(ch[1])).not.toMatch(/NON riuscita: INVIA_FEEDBACK/);
    const chat = await chatCon(app, 'segnala che il timer non suona');
    await dimenticaLaMemoria(app, chat.id);
    await riapri(app, page, chat.id);
    await expect(page.locator('.dash-bubble-filo .dash-activity-row').first()).toHaveText(/Segnalazione non inviata · problema di rete/, { timeout: 8_000 });
  } finally {
    await app.evaluate(() => { if (globalThis.__submitVero) globalThis.SN_FEEDBACK.submit = globalThis.__submitVero; });
    await ripristina(app);
  }
});

// Una conferma rimasta senza risposta (#1294 punto 5): riaperta, il bottone c'è ancora e chiede il sì come allora; dato
// il sì, il comando parte, la domanda si chiude nella sua risposta e il modello riprende.
test('#1685 un comando proposto e mai confermato: riaperta dopo un riavvio, il modello sa che aspetta e il bottone lo fa partire', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('esiti-conferme-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [
      { text: 'Creo la cartella.', toolCalls: [mkdir('c1', dir, 'tre')] }, { text: 'Aspetto il tuo OK.' },
      { text: 'Ti aspetto.' }, { text: 'Fatto, ho finito.' },
    ]);
    await chiedi(page, 'crea la cartella tre');
    await expect(page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Creo la cartella tre' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const chat = await chatCon(app, 'crea la cartella tre');
    await dimenticaLaMemoria(app, chat.id);
    await riapri(app, page, chat.id);
    const bottone = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Creo la cartella tre' });
    await expect(bottone, 'riaperta, la conferma ancora da dare ha il suo bottone').toBeVisible({ timeout: 8_000 });
    await expect(page.locator(CONFIRM_HOST), 'riaperta, il popup non si apre da solo').toHaveCount(0);
    await page.screenshot({ path: 'tests/.shots/chat-esiti-conferma-riaperta.png' });
    await chiedi(page, 'allora?');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBe(3);
    expect(rispostaA((await chiamateAlModello(app))[2], 'crea la cartella tre'), 'il modello sa che la proposta aspetta il sì')
      .toMatch(/NON fatta: chiesta la conferma all'utente, che allora non l'aveva ancora data: Creo la cartella tre/);
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    await okAlBottone(page, bottone);
    await expect.poll(() => existsSync(join(dir, 'tre')), { timeout: 10_000 }).toBe(true);
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto, ho finito.' })).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => (await chatCon(app, 'crea la cartella tre'))?.messages.flatMap((m) => m.esiti || []).map((v) => v.esito), { timeout: 8_000 })
      .toEqual(['fatto']);
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});

test('#1685 riaperta la chat, due conferme rimaste in sospeso nella stessa risposta restano un passo solo', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('esiti-conferme-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [
      { text: 'Creo le due cartelle.', toolCalls: [mkdir('c1', dir, 'quattro'), mkdir('c2', dir, 'cinque')] },
      { text: 'Aspetto i tuoi OK.' },
      { text: 'Fatte tutte e due.' },
    ]);
    await chiedi(page, 'crea le cartelle quattro e cinque');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Aspetto i tuoi OK' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const chat = await chatCon(app, 'crea le cartelle quattro e cinque');
    await dimenticaLaMemoria(app, chat.id);
    await riapri(app, page, chat.id);
    const bottoni = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: /Creo la cartella/ });
    await expect(bottoni, 'riaperta, tornano tutti e due i bottoni').toHaveCount(2, { timeout: 8_000 });
    await okAlBottone(page, bottoni.filter({ hasText: 'quattro' }));
    await page.waitForTimeout(1500);
    expect((await chiamateAlModello(app)).length, 'col secondo comando ancora da confermare il modello aspetta').toBe(2);
    await okAlBottone(page, bottoni.filter({ hasText: 'cinque' }));
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatte tutte e due' })).toBeVisible({ timeout: 10_000 });
    const ch = await chiamateAlModello(app);
    expect(ch, 'una ripresa sola, dopo il secondo OK').toHaveLength(3);
    expect(ultimoMessaggio(ch[2])).toMatch(/quattro[\s\S]*cinque/);
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});

// Il riordino e l'eliminazione dall'archivio chiedono col loro pannello: un no o un guasto restano scritti nella
// conversazione come per le altre conferme, e un guasto torna al modello (#1373).
test('#1685 il riordino: un no resta un no, e un riordino che non riesce lo sanno la chat e il modello', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__triageVero = win._filoTabs.runAutoTriage;
    win._filoTabs.runAutoTriage = async () => ({ giudizioMancato: true });
  });
  try {
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [{ toolCalls: [{ id: 'i1', name: 'PULISCI_TAB', arguments: '{}' }] }, { text: 'Valuto le schede.' }, { text: 'NON RIUSCITO, riprova.' }]);
    await chiedi(page, 'riordina le schede');
    const btn = page.locator('.dash-action-btn', { hasText: 'Riordina e archivia' });
    await expect(btn).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    await btn.click();
    await clickConfirm(page, 'cancel', { timeout: 10_000 });
    const esiti = async () => (await chatCon(app, 'riordina le schede'))?.messages.flatMap((m) => m.esiti || []);
    await expect.poll(async () => (await esiti()).map((v) => `${v.esito}:${v.motivo || ''}`), { timeout: 8_000 }).toEqual([`fallito:${'detto no alla conferma'}`]);
    await page.waitForTimeout(800);
    expect((await chiamateAlModello(app)).length, 'un no non fa ripartire il lavoro').toBe(2);
    await btn.click();
    await clickConfirm(page, 'ok', { timeout: 10_000 });
    await expect(page.locator('.dash-bubble-filo', { hasText: /NON RIUSCITO, riprova/ }), 'il guasto torna al modello').toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.dash-bubble-filo', { hasText: /NON RIUSCITO, riprova/ }), 'una bolla sola').toHaveCount(1);
    expect(ultimoMessaggio((await chiamateAlModello(app))[2])).toMatch(/NON riuscita: [^\n]*\(perché: Filo non è riuscito a valutare le schede/);
    await expect.poll(async () => (await esiti()).map((v) => v.esito), { timeout: 8_000 }).toEqual(['fallito']);
    const chat = await chatCon(app, 'riordina le schede');
    await dimenticaLaMemoria(app, chat.id);
    await riapri(app, page, chat.id);
    await expect(page.locator('.dash-bubble-filo .dash-activity-row').first()).toHaveText(/Riordino non riuscito · Filo non è riuscito a valutare le schede/, { timeout: 8_000 });
  } finally {
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
      if (globalThis.__triageVero) win._filoTabs.runAutoTriage = globalThis.__triageVero;
    });
    await ripristina(app);
  }
});

// Un no non fa ripartire il lavoro, anche quando arriva al bottone che la chat riaperta ha ridisegnato: il modello non
// va richiamato con un «continua» che non sa del no.
test('#1685 riaperta la chat, un no al bottone ridato non fa ripartire il lavoro', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('esiti-conferme-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [{ text: 'Creo la cartella.', toolCalls: [mkdir('c1', dir, 'sette')] }, { text: 'Aspetto il tuo OK.' }, { text: 'RIPARTITO DOPO IL NO' }]);
    await chiedi(page, 'crea la cartella sette');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const chat = await chatCon(app, 'crea la cartella sette');
    await riapri(app, page, chat.id);
    const bottone = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Creo la cartella sette' });
    await expect(bottone).toBeVisible({ timeout: 8_000 });
    const prima = (await chiamateAlModello(app)).length;
    await bottone.click();
    await clickConfirm(page, 'cancel', { timeout: 5_000 });
    await expect.poll(async () => (await chatCon(app, 'crea la cartella sette')).messages.flatMap((m) => m.esiti || []).map((v) => `${v.esito}:${v.motivo || ''}`), { timeout: 8_000 })
      .toEqual(['fallito:detto no alla conferma']);
    await page.waitForTimeout(1500);
    expect(existsSync(join(dir, 'sette'))).toBe(false);
    expect((await chiamateAlModello(app)).length, 'un no non richiama il modello, come in diretta').toBe(prima);
    await expect(page.locator('.dash-bubble-filo', { hasText: 'RIPARTITO DOPO IL NO' })).toHaveCount(0);
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});

// Il pannello del riordino è una conferma della stessa risposta come i bottoni: la ripresa aspetta anche lui.
test('#1685 riordino e comando nella stessa risposta: Filo riprende solo quando hanno risposto tutti e due', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('esiti-conferme-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [
      { toolCalls: [{ id: 'i1', name: 'PULISCI_TAB', arguments: '{}' }, mkdir('c1', dir, 'otto')] },
      { text: 'Ti chiedo due conferme.' }, { text: 'RIPRESO CON TUTTO' },
    ]);
    await chiedi(page, 'riordina le schede e crea la cartella otto');
    const riordino = page.locator('.dash-action-btn', { hasText: 'Riordina e archivia' });
    await expect(riordino).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    expect((await chiamateAlModello(app)).length).toBe(2);
    await okAlBottone(page, page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Creo la cartella otto' }));
    await page.waitForTimeout(1500);
    expect((await chiamateAlModello(app)).length, 'il riordino aspetta ancora la sua risposta').toBe(2);
    await riordino.click();
    await clickConfirm(page, 'cancel', { timeout: 10_000 });
    await expect(page.locator('.dash-bubble-filo', { hasText: 'RIPRESO CON TUTTO' })).toBeVisible({ timeout: 10_000 });
    const ch = await chiamateAlModello(app);
    expect(ch).toHaveLength(3);
    expect(ultimoMessaggio(ch[2])).toMatch(/fatta: Comando eseguito[^\n]*otto/);
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});

// L'eliminazione dall'archivio chiede col suo pannello: un no resta un no e non fa ripartire il lavoro, un'eliminazione
// non riuscita resta scritta e torna al modello (#1373).
test('#1685 eliminazione dall\'archivio: un no resta un no, e una non riuscita la sanno la chat e il modello', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(async () => {
    const A = globalThis.SN_ARCHIVED_TABS;
    for (const i of [1, 2]) await A.archive({ url: `https://archiviata-${i}.test/`, title: `Archiviata ${i}`, closedAt: new Date().toISOString() });
    globalThis.__removeManyVero = A.removeMany;
  });
  try {
    await modelloFinto(app, [{ toolCalls: [{ id: 'a1', name: 'CANCELLA_ARCHIVIO', arguments: '{"tutto":true}' }] }, { text: 'Ecco l\'archivio.' }, { text: 'NON ELIMINATE: riprova.' }]);
    await chiedi(page, 'svuota l\'archivio');
    const elimina = page.locator('.dash-delete-panel .dash-action-btn-danger');
    await expect(elimina).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    await elimina.click();
    await clickConfirm(page, 'cancel', { timeout: 5_000 });
    const esiti = async () => (await chatCon(app, 'svuota l\'archivio'))?.messages.flatMap((m) => m.esiti || []).map((v) => `${v.esito}:${v.motivo || ''}`);
    await expect.poll(esiti, { timeout: 8_000 }).toEqual(['fallito:detto no alla conferma']);
    await page.waitForTimeout(800);
    expect((await chiamateAlModello(app)).length, 'un no non fa ripartire il lavoro').toBe(2);
    await app.evaluate(() => { globalThis.SN_ARCHIVED_TABS.removeMany = async () => { throw new Error('disco pieno'); }; });
    await elimina.click();
    await clickConfirm(page, 'ok', { timeout: 5_000 });
    await expect(page.locator('.dash-bubble-filo', { hasText: 'NON ELIMINATE' }), 'il guasto torna al modello').toBeVisible({ timeout: 10_000 });
    expect(ultimoMessaggio((await chiamateAlModello(app))[2])).toMatch(/NON riuscita: [^\n]*\(perché: l’archivio è rimasto com’era/);
    await expect.poll(esiti, { timeout: 8_000 }).toEqual(['fallito:l’archivio è rimasto com’era']);
    expect(await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).length)).toBe(2);
  } finally {
    await app.evaluate(() => { if (globalThis.__removeManyVero) globalThis.SN_ARCHIVED_TABS.removeMany = globalThis.__removeManyVero; });
    await ripristina(app);
  }
});

// Ogni bottone che la risposta lasciava da cliccare torna con la chat riaperta (#1294), non solo quelli dei file.
test('#1294 riaperta, la pagina aperta da Filo ha ancora il suo collegamento, che la riapre', async ({ app, shell, testServer }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  const url = testServer.html('<title>Posta</title><h1>Posta</h1>');
  await modelloFinto(app, [{ text: 'Ecco la posta.', toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url, etichetta: 'Posta' }) }] }, { text: '' }]);
  await chiedi(page, 'apri la posta');
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 10_000 });
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  const chat = await chatCon(app, 'apri la posta');
  await dimenticaLaMemoria(app, chat.id);
  await riapri(app, page, chat.id);
  const link = page.locator('.dash-bubble-filo .dash-action-link-chip');
  await expect(link, 'riaperta, il collegamento si clicca ancora').toHaveCount(1, { timeout: 8_000 });
  await expect(link).toContainText('Posta');
  await expect(page.locator('.dash-bubble-filo .dash-activity-row', { hasText: 'Aperta ·' })).toHaveCount(0);
  const attiva = async () => {
    const s = await shell.evaluate(() => window.filoShell.tabs.snapshot());
    return (s.tabs.find((t) => t.id === s.activeId) || {}).url || '';
  };
  await shell.locator('.tab').first().click();
  await expect.poll(attiva, { timeout: 5_000 }).not.toBe(url);
  await link.click();
  await expect.poll(attiva, { timeout: 10_000, message: 'il collegamento porta alla pagina' }).toBe(url);
  await ripristina(app);
});

test('#1294 riaperta, l\'appunto salvato da Filo ha ancora il bottone che apre l\'editor', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Segnato.', toolCalls: [{ id: 'a1', name: 'SALVA_APPUNTO', arguments: '{"testo":"comprare il latte","contesto":"spesa"}' }] }, { text: '' }]);
  await chiedi(page, 'segnati di comprare il latte');
  await expect(page.locator('.dash-bubble-filo [data-action="openNotes"]')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  const chat = await chatCon(app, 'segnati di comprare il latte');
  await dimenticaLaMemoria(app, chat.id);
  await riapri(app, page, chat.id);
  await expect(page.locator('.dash-bubble-filo [data-action="openNotes"]'), 'riaperta, l\'appunto si apre ancora dal suo bottone').toHaveCount(1, { timeout: 8_000 });
  await ripristina(app);
});
