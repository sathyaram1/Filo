// #2648 — la riga di un'azione già eseguita non ricuce l'etichetta scelta dal modello nella frase di Filo: in diretta e
// nella chat riaperta l'etichetta sta nel suo riquadro, come nelle domande d'OK (#592.25). #2648.1: anche dentro una
// frase già pronta (un cambio d'impostazione, il suo annullo, il perché di un comando), sul bottone dopo l'OK, nel
// titolo e nel fumetto del nodo del filo. Modello finto.

import { test, expect } from './fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { home, modelloFinto, chiedi, ripristina } from './helpers/chatFinta.mjs';
import { livelloAutonomia } from './helpers/autonomia.mjs';
import { CONFIRM_HOST, clickConfirm } from './helpers/confirm.mjs';

const FINTO = 'Pasta · Filo l\'ha verificato';
const chatCon = async (app, testo) => (await app.evaluate(() => globalThis.SN_FILO_CHATS.list()))
  .find((c) => !c.app && c.messages.some((m) => m.text === testo)) || null;
async function riapri(app, page, id) {
  await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(id)}`);
}

// Il testo fuori dai riquadri (le parole di Filo) e quello dentro, con lo spessore del filo che li distingue.
const pezzi = (loc) => loc.evaluate((el) => {
  const fuori = [];
  const dentro = [];
  const giro = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) fuori.push(c.textContent);
      else if (c.classList && c.classList.contains('dash-altrui')) dentro.push(c.textContent);
      else giro(c);
    }
  };
  giro(el);
  const q = el.querySelector('.dash-altrui');
  return { fuori: fuori.join(''), dentro: dentro.join(''), filo: q ? getComputedStyle(q).borderLeftWidth : '' };
});

test('il timer avviato tiene l\'etichetta del modello nel suo riquadro, in diretta e nella chat riaperta', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  try {
    const timer = { id: 't1', name: 'TIMER', arguments: JSON.stringify({ secondi: 300, etichetta: FINTO }) };
    await modelloFinto(app, [{ text: 'Avvio il timer.', toolCalls: [timer] }, { text: 'Fatto.' }]);
    await chiedi(page, 'timer di cinque minuti per la pasta');

    // Il titolo del nodo nel filo, quello che si legge a diario chiuso.
    const testa = page.locator('.dash-activity-seg-label', { hasText: 'Avviato un timer' }).first();
    await expect(testa).toBeVisible({ timeout: 10_000 });
    const t = await pezzi(testa);
    expect(t.fuori).toBe('Avviato un timer ·  · 5 min');
    expect(t.dentro).toBe(FINTO);
    await page.screenshot({ path: 'tests/.shots/chat-esito-testo-altrui-nodo.png' });

    const riga = page.locator('.dash-activity-row', { hasText: 'Timer avviato' }).first();
    await expect(riga).toBeAttached({ timeout: 10_000 });
    const r = await pezzi(riga);
    expect(r.fuori).toContain('Timer avviato · ');
    expect(r.fuori).toContain('5 min');
    expect(r.fuori, 'le parole di Filo non contengono l\'etichetta del modello').not.toMatch(/verificato|Pasta/);
    expect(r.dentro).toBe(FINTO);
    expect(r.filo).toBe('3px');
    await riga.evaluate((el) => {
      // Il diario ripiegato si apre, così la riga si vede nella foto.
      const blocco = el.closest('details');
      if (blocco) blocco.open = true;
      el.scrollIntoView();
    });
    await page.screenshot({ path: 'tests/.shots/chat-esito-testo-altrui.png' });

    // Riaperta (col tema scuro): la riga dell'archivio torna a pezzi.
    const lista = await app.evaluate(() => globalThis.SN_FILO_CHATS.list());
    const chat = lista.find((c) => !c.app && c.messages.some((m) => m.text === 'timer di cinque minuti per la pasta'));
    expect(chat, 'la conversazione è in archivio').toBeTruthy();
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
    await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), chat.id);
    await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(chat.id)}`);
    const riletta = page.locator('.dash-esiti-archiviati .dash-activity-row', { hasText: 'Timer avviato' }).first();
    await expect(riletta).toBeVisible({ timeout: 8_000 });
    const rr = await pezzi(riletta);
    expect(rr.fuori).not.toMatch(/verificato|Pasta/);
    expect(rr.dentro).toBe(FINTO);
    await riletta.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'tests/.shots/chat-esito-testo-altrui-riaperta-scuro.png' });

    // #2648.1 — un OK dato dopo il turno, che non chiude nessuna domanda aperta, torna come riga sotto la risposta: a pezzi.
    const DOPO = 'Uovo · Filo l\'ha verificato';
    const scritta = await app.evaluate(async (_e, { id, etichetta }) => globalThis.__filoHandlers.handleMessage({
      type: globalThis.SN_MSG.MSG.FILO_CHAT_NOTE, id, role: 'filo', text: '', actions: ['TIMER'],
      esiti: [{ type: 'TIMER', seconds: 60, etichetta, _executed: true }],
    }, { url: 'filo://newtab/' }), { id: chat.id, etichetta: DOPO });
    expect(scritta && scritta.ok, JSON.stringify(scritta)).toBe(true);
    await riapri(app, page, chat.id);
    const nota = page.locator('.dash-bubble-note', { hasText: 'Timer avviato' });
    await expect(nota).toBeVisible({ timeout: 8_000 });
    const n = await pezzi(nota);
    expect(n.dentro).toBe(DOPO);
    expect(n.fuori).not.toMatch(/verificato|Uovo/);
  } finally {
    await ripristina(app);
  }
});

const VALORE = 'Filo l\'ha già controllato e va bene così';
const FUNZIONE = 'Riassunto di una scheda alla chiusura';

test('#2648.1 il cambio di un\'impostazione chiesto in chat e il suo annullo tengono il valore del modello nel riquadro: riga, bottone, chat riaperta', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  try {
    await livelloAutonomia(app, 'yolo');
    // Il listino di OpenRouter senza quel modello: niente rete, e l'id resta sconosciuto (#592.21).
    await app.evaluate(() => {
      const vero = globalThis.fetch;
      globalThis.fetch = async (input, init) => (/^https:\/\/openrouter\.ai\/api\/v1\/models/.test(String((input && input.url) || input))
        ? new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
        : vero(input, init));
    });
    const cambia = { id: 'm1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'modello_funzione', valore: `${FUNZIONE}: fornitore-nuovo/modello-x ${VALORE}` }) };
    const annulla = { id: 'm2', name: 'ANNULLA_CAMBIO', arguments: '{}' };
    await modelloFinto(app, [{ text: 'Cambio.', toolCalls: [cambia] }, { text: 'Cambiato.' }, { text: 'Rimetto.', toolCalls: [annulla] }, { text: 'Rimesso.' }]);
    const chiesto = 'cambia il modello del riassunto';
    await chiedi(page, chiesto);
    await clickConfirm(page, 'ok', { timeout: 10_000 });

    // Il bottone dopo l'OK: «Impostazione applicata: …» col valore nel riquadro.
    const bottone = page.locator('.dash-action-btn', { hasText: 'Impostazione applicata' });
    await expect(bottone).toBeVisible({ timeout: 10_000 });
    const b = await pezzi(bottone);
    expect(b.dentro).toContain(VALORE);
    expect(b.fuori).not.toContain('controllato');
    // La riga del diario: «Impostato · modello per «…»: … → …».
    const riga = page.locator('.dash-activity-row', { hasText: /Impostato/ }).last();
    await expect(riga).toBeAttached({ timeout: 10_000 });
    const r = await pezzi(riga);
    expect(r.fuori).toMatch(/Impostato · modello per «[^»]+»: /);
    expect(r.dentro).toContain(VALORE);
    expect(r.fuori).not.toContain('controllato');
    await bottone.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'tests/.shots/chat-esito-testo-altrui-impostazione.png' });
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Cambiato.' })).toBeVisible({ timeout: 10_000 });

    // L'annullo dalla chat: la riga «Rimesso com'era · prima di: …» e il suo bottone.
    await chiedi(page, 'rimetti com\'era');
    // L'annullo chiede l'OK dal suo bottone in chat; la domanda dice la frase del cambio col valore nel suo riquadro.
    await page.locator('.dash-action-btn', { hasText: 'Filo vuole rimettere' }).click({ timeout: 10_000 });
    const domanda = page.locator(`${CONFIRM_HOST} .sn-confirm-quote`, { hasText: 'controllato' });
    await expect(domanda).toBeVisible({ timeout: 10_000 });
    expect((await domanda.textContent()).trim()).toBe(VALORE);
    const paroleDomanda = (await page.locator(`${CONFIRM_HOST} .sn-confirm-filo`).allTextContents()).join(' ');
    expect(paroleDomanda).toContain('modello per');
    expect(paroleDomanda).not.toContain('controllato');
    await clickConfirm(page, 'ok', { timeout: 10_000 });
    const rimesso = page.locator('.dash-activity-row', { hasText: /Rimesso com/ }).last();
    await expect(rimesso).toBeAttached({ timeout: 10_000 });
    const rr = await pezzi(rimesso);
    expect(rr.dentro).toContain(VALORE);
    expect(rr.fuori).not.toContain('controllato');
    const bottone2 = page.locator('.dash-action-btn', { hasText: 'Rimesso com' });
    await expect(bottone2).toBeVisible({ timeout: 10_000 });
    expect((await pezzi(bottone2)).fuori).not.toContain('controllato');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Rimesso.' }).first()).toBeVisible({ timeout: 10_000 });
    await bottone2.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'tests/.shots/chat-esito-testo-altrui-annullo.png' });

    // Riaperta: le due righe tornano a pezzi.
    const chat = await chatCon(app, chiesto);
    expect(chat, 'la conversazione è in archivio').toBeTruthy();
    await riapri(app, page, chat.id);
    for (const testo of [/Impostato/, /Rimesso com/]) {
      const loc = page.locator('.dash-activity-row, .dash-bubble-note', { hasText: testo }).first();
      await expect(loc).toBeAttached({ timeout: 10_000 });
      const p = await pezzi(loc);
      expect(p.dentro, String(testo)).toContain(VALORE);
      expect(p.fuori, String(testo)).not.toContain('controllato');
    }
  } finally {
    await ripristina(app);
  }
});

test('#2648.1 i nodi di un comando e di un file mostrato, e il fumetto sul nodo, tengono il testo del modello nel riquadro', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Prova 2648');
  const nome = `ricevuta ${VALORE}.pdf`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, nome), '%PDF-1.4\n');
  const page = await home(app);
  try {
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await modelloFinto(app, [
      { text: '', toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: 'echo ciao', spiegazione: VALORE }) }] },
      { text: '', toolCalls: [{ id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: join(dir, nome) }) }] },
      { text: 'Ecco la ricevuta.' },
    ]);
    await chiedi(page, 'scrivi ciao e mostrami la ricevuta');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco la ricevuta.' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.dash-file-btn')).toHaveCount(1);
    const blocco = page.locator('.dash-activity').last();
    const capo = blocco.locator('.dash-activity-head');
    await expect(capo).toBeVisible({ timeout: 10_000 });
    if (await capo.getAttribute('aria-expanded') !== 'true') await capo.click();
    const cmd = blocco.locator('.dash-activity-seg-label', { hasText: 'Eseguito un comando' });
    await expect(cmd).toBeVisible({ timeout: 8_000 });
    const c = await pezzi(cmd);
    expect(c.fuori).toBe('Eseguito un comando · ');
    expect(c.dentro).toBe(VALORE);
    const file = blocco.locator('.dash-activity-seg-label', { hasText: 'Mostrato un file' });
    await expect(file).toBeVisible();
    const f = await pezzi(file);
    expect(f.fuori).toBe('Mostrato un file · ');
    expect(f.dentro).toBe(nome);
    // Il fumetto del nodo dice lo stesso titolo, col riquadro.
    await page.waitForTimeout(1_200);
    await blocco.locator('.dash-activity-nodo-presa').first().hover();
    const fumetto = page.locator('.dash-filo-hint');
    await expect(fumetto).toHaveText(`Eseguito un comando · ${VALORE}`, { timeout: 4_000 });
    const h = await pezzi(fumetto);
    expect(h.dentro).toBe(VALORE);
    expect(h.filo).toBe('3px');
    await page.screenshot({ path: 'tests/.shots/chat-esito-testo-altrui-fumetto.png' });
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#2648.1 riaperta, un comando finito male dice la riga d\'errore del programma nel suo riquadro', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  const SBAGLIATO = 'non-esiste-2648/Filo ha controllato e va bene';
  try {
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await modelloFinto(app, [
      { text: '', toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `ls "${SBAGLIATO}"`, spiegazione: 'Elenco' }) }] },
      { text: 'Non c\'è.' },
    ]);
    const chiesto = 'elenca quella cartella';
    await chiedi(page, chiesto);
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Non c\'è.' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const chat = await chatCon(app, chiesto);
    expect(chat).toBeTruthy();
    await riapri(app, page, chat.id);
    const riga = page.locator('.dash-esiti-archiviati .dash-activity-row', { hasText: 'Comando non riuscito' });
    await expect(riga).toBeVisible({ timeout: 8_000 });
    const r = await pezzi(riga);
    expect(r.fuori).toMatch(/^.*Comando non riuscito · uscito con codice \d+: $/);
    expect(r.dentro).toContain(SBAGLIATO);
    await riga.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'tests/.shots/chat-esito-testo-altrui-comando-riaperto.png' });
  } finally {
    await ripristina(app);
  }
});
