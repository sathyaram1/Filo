// #947 — «Mi serve la bolletta della luce di marzo»: Filo trova il documento fra i file del computer anche se si chiama
// «scan_00231.pdf», e risponde col file da aprire. Senza il lavoro di #947 ogni prova qui è rossa: lo strumento non
// esisteva, il modello non riceveva candidati e in chat non c'era nessun bottone del file.
//
// La cartella è quella degli scaricamenti di serie (FILO_DOWNLOAD_DIR nelle prove): l'utente non configura niente e
// non accende il terminale. Il modello è finto e passa la frase dell'utente così com'è: chi mette il documento giusto
// in cima è la ricerca di Filo, non il modello.

import { test, expect } from './fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from './helpers/chatFinta.mjs';
import { cartellaDellaProva, BOLLETTA_MARZO } from './helpers/documentiFinti.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const RICHIESTA = 'Mi serve la bolletta della luce di marzo. Dov\'è?';

async function cartellaScaricamenti(app) {
  return app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
}

// Lo shell del sistema registra invece di aprire: un clic sul bottone deve arrivare fino a lui.
async function shellCheRegistra(app) {
  await app.evaluate(({ shell }) => {
    globalThis.__aperti = [];
    globalThis.__cartelle = [];
    shell.openPath = async (p) => { globalThis.__aperti.push(p); return ''; };
    shell.showItemInFolder = (p) => { globalThis.__cartelle.push(p); };
  });
}

function testoDeiMessaggi(messaggi) {
  return (messaggi || []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
}

test('la prova della segnalazione: la bolletta della luce di marzo è il primo risultato, e la risposta ha il file da aprire', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = join(await cartellaScaricamenti(app), 'Scansioni');
  cartellaDellaProva(dir);
  const bolletta = join(dir, BOLLETTA_MARZO);
  try {
    await shellCheRegistra(app);
    await modelloFinto(app, [
      { toolCalls: [{ id: 'd1', name: 'CERCA_DOCUMENTI', arguments: JSON.stringify({ cosa: RICHIESTA }) }] },
      { text: `È ${BOLLETTA_MARZO}, nella cartella Scansioni dei Download: è la bolletta dell'energia elettrica del periodo 01/03/2026 - 31/03/2026.` },
    ]);
    const page = await home(app);
    await chiedi(page, RICHIESTA);

    // Il bottone del file, con il nome e la cartella in cui sta, anche senza che il modello abbia chiamato APRI_FILE.
    const file = page.locator('.dash-bubble-actions .dash-file-btn');
    await expect(file).toHaveCount(1, { timeout: 20_000 });
    await expect(file.locator('.dash-file-btn-nome')).toHaveText(BOLLETTA_MARZO);
    await expect(file.locator('.dash-file-btn-dove')).toHaveText(/Scansioni/);
    await expect(file).toHaveAttribute('data-percorso', bolletta);

    // Al modello è arrivato quel file come PRIMO candidato, con il pezzo di testo che lo distingue; il testo intero
    // dei venti documenti no.
    const chiamate = await chiamateAlModello(app);
    const esito = testoDeiMessaggi(chiamate[1]);
    expect(esito).toMatch(new RegExp(`1\\. ${BOLLETTA_MARZO.replace('.', '\\.')}`));
    expect(esito).toContain(bolletta);
    expect(esito).toMatch(/01\/03\/2026/);
    expect(esito, 'il testo di un documento che non è fra i candidati non esce').not.toContain('Programma cotone 40 gradi');
    // I PDF li ha letti il processo a parte, non quello da cui dipendono finestre e schede.
    const lettori = await app.evaluate(({ app: a }) => a.getAppMetrics().filter((m) => m.type === 'Utility').map((m) => m.name || m.serviceName || ''));
    expect(lettori).toContain('Filo · lettura documenti');

    // Un clic lo apre col programma del sistema.
    await file.click();
    await expect.poll(() => app.evaluate(() => globalThis.__aperti)).toEqual([bolletta]);

    // Tasto destro: le azioni di un file.
    await file.click({ button: 'right' });
    const menu = page.locator('.sn-rinomina-menu .sn-select-option');
    await expect(menu.first()).toHaveText('Apri');
    await expect(page.locator('.sn-rinomina-menu')).toContainText('Mostra nella cartella');
    await expect(page.locator('.sn-rinomina-menu')).toContainText('Metti nel messaggio');
    await page.screenshot({ path: 'tests/.shots/cerca-documenti-menu.png' });
    await menu.filter({ hasText: 'Mostra nella cartella' }).click();
    await expect.poll(() => app.evaluate(() => globalThis.__cartelle)).toEqual([bolletta]);

    await file.click({ button: 'right' });
    await page.locator('.sn-rinomina-menu .sn-select-option', { hasText: 'Metti nel messaggio' }).click();
    const allegato = page.locator('.dash-file-chip');
    await expect(allegato).toHaveText(new RegExp(BOLLETTA_MARZO.replace('.', '\\.')));
    await expect(allegato).toHaveAttribute('title', bolletta);
    await page.screenshot({ path: 'tests/.shots/cerca-documenti-risposta.png' });
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('la stessa ricerca dalla chat di un\'altra scheda', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const dir = join(await cartellaScaricamenti(app), 'Scheda');
  cartellaDellaProva(dir);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'd1', name: 'CERCA_DOCUMENTI', arguments: JSON.stringify({ cosa: 'ricevuta assicurazione' }) }] },
      { text: 'È xyz123.pdf: è la quietanza della polizza RC auto.' },
    ]);
    // In tema scuro, per guardare il bottone anche lì.
    await app.evaluate(async () => globalThis.__filoHandlers.handleMessage(
      { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } },
      { url: 'filo://preferences/preferences.html' },
    ));
    const page = await openTab('filo://newtab/');
    await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
    await chiedi(page, 'dov\'è la ricevuta dell\'assicurazione?');
    const file = page.locator('.dash-bubble-actions .dash-file-btn');
    await expect(file.locator('.dash-file-btn-nome')).toHaveText('xyz123.pdf', { timeout: 20_000 });
    await page.screenshot({ path: 'tests/.shots/cerca-documenti-scuro.png' });
    await file.hover();
    await page.screenshot({ path: 'tests/.shots/cerca-documenti-scuro-hover.png' });
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('il file trovato si trascina nel campo dove si scrive a Filo', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = join(await cartellaScaricamenti(app), 'Trascina');
  cartellaDellaProva(dir);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'd1', name: 'CERCA_DOCUMENTI', arguments: JSON.stringify({ cosa: 'contratto affitto locazione' }) }] },
      { toolCalls: [{ id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: join(dir, 'documento (3).docx') }) }] },
      { text: 'Eccolo: è il contratto di locazione di Via Roma 12.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'dov\'è il contratto d\'affitto?');
    const file = page.locator('.dash-file-btn');
    await expect(file).toHaveCount(1, { timeout: 20_000 });
    await expect(file.locator('.dash-file-btn-nome')).toHaveText('documento (3).docx');
    await file.dragTo(page.locator('#input'));
    await expect(page.locator('.dash-file-chip')).toHaveText(/documento \(3\)\.docx/, { timeout: 5_000 });
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('l\'attesa dice cosa sta leggendo e quanti ne mancano, e il quadrato ferma la ricerca', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = join(await cartellaScaricamenti(app), 'Tanti');
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 60; i++) writeFileSync(join(dir, `doc_${String(i).padStart(3, '0')}.txt`), `documento numero ${i}`);
  try {
    // Un lettore lento: ogni documento un decimo di secondo, come una cartella vera piena di PDF.
    await app.evaluate(() => {
      globalThis.SN_DOCUMENTI_INDICE.configura({
        estrai: async (p) => { await new Promise((ok) => setTimeout(ok, 150)); return { testo: `contenuto di ${p}`, pagine: 0, vuoto: false, errore: '' }; },
      });
    });
    await modelloFinto(app, [
      { toolCalls: [{ id: 'd1', name: 'CERCA_DOCUMENTI', arguments: JSON.stringify({ cosa: 'documento numero 42' }) }] },
      { text: 'Fatto.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'trovami il documento numero 42');
    const blocco = page.locator('.dash-activity');
    await expect(blocco.locator('.dash-activity-seg-head').first())
      .toHaveText(/Leggo i documenti nuovi… \d+ di 60 · doc_\d{3}\.txt/, { timeout: 10_000 });
    await page.screenshot({ path: 'tests/.shots/cerca-documenti-attesa.png' });
    await page.locator('#stopBtn').click();
    await expect(blocco).toHaveAttribute('data-fermato', '1', { timeout: 2_000 });
    await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Riprendi', { timeout: 3_000 });
    // La ricerca si è fermata subito; l'indice finisce di leggere in sottofondo e la volta dopo è pronto.
    await expect.poll(async () => (await app.evaluate(() => globalThis.SN_DOCUMENTI_INDICE.stato())).documenti, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(60);
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('le cartelle si cambiano in Preferenze: togli, rimetti, aggiungi; la ricerca segue l\'elenco', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const altrove = cartellaTemporanea('filo-lavoro-');
  writeFileSync(join(altrove, 'q1.docx'), (await import('./helpers/documentiFinti.mjs')).docx(['Relazione trimestrale delle vendite']));
  const scaricati = await cartellaScaricamenti(app);
  cartellaDellaProva(join(scaricati, 'Pref'));
  try {
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, altrove);
    const pref = await openTab('filo://preferences/preferences.html');
    const box = pref.locator('#documentiCartelle');
    await expect(box.locator('.mem-riga')).toHaveCount(3);
    await expect(box.locator('.mem-riga[data-cartella="download"] .mem-testo')).toContainText('Download');

    // Togli Download: l'impostazione cambia, la riga resta sbiadita con «Rimetti», e la ricerca non trova più niente lì.
    await box.locator('.mem-riga[data-cartella="download"] .mem-via').click();
    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).documenti.cartelle))
      .toEqual(['documenti', 'scrivania']);
    await expect(box.locator('.mem-riga.doc-tolta[data-cartella="download"] .doc-rimetti')).toBeVisible();
    const senza = await app.evaluate(() => globalThis.SN_DOCUMENTI_INDICE.cerca('bolletta luce marzo'));
    expect(senza.risultati.length).toBe(0);

    await box.locator('.mem-riga.doc-tolta[data-cartella="download"] .doc-rimetti').click();
    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).documenti.cartelle))
      .toEqual(['documenti', 'scrivania', 'download']);
    const con = await app.evaluate(() => globalThis.SN_DOCUMENTI_INDICE.cerca('bolletta luce marzo'));
    expect(con.risultati[0].nome).toBe(BOLLETTA_MARZO);

    // Aggiungi una cartella dalla finestra del sistema: compare nell'elenco e la ricerca la legge.
    await pref.locator('#documentiAggiungi').click();
    await expect(box.locator(`.mem-riga[data-cartella="${altrove.replace(/\\/g, '\\\\')}"]`)).toBeVisible();
    const lavoro = await app.evaluate(() => globalThis.SN_DOCUMENTI_INDICE.cerca('relazione trimestrale'));
    expect(lavoro.risultati[0].nome).toBe('q1.docx');
    await expect(pref.locator('#documentiStato')).toContainText('documenti', { timeout: 10_000 });
    await pref.locator('#sec-documenti').screenshot({ path: 'tests/.shots/cerca-documenti-preferenze.png' });
  } finally {
    rmSync(altrove, { recursive: true, force: true });
    rmSync(join(scaricati, 'Pref'), { recursive: true, force: true });
  }
});

test('dalla chat: «cerca anche in quella cartella» si aggiunge, una cartella che non c\'è si rifiuta col perché', async ({ app }) => {
  test.setTimeout(60_000);
  const altrove = cartellaTemporanea('filo-chat-cartella-');
  try {
    const imposta = (valore) => app.evaluate(async (_e, v) => globalThis.SN_HANDLE_MESSAGE(
      { type: globalThis.SN_MSG.MSG.FILO_CONFIRM_ACTION, action: { type: 'IMPOSTA_PREFERENZA', chiave: 'cartelle_documenti', valore: v } },
      { tab: { id: 1, url: 'filo://newtab/' }, url: 'filo://newtab/' },
    ), valore);
    const ok = await imposta(`aggiungi ${altrove}`);
    expect(ok.executed).toBe(true);
    expect(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).documenti.cartelle))
      .toEqual(['documenti', 'download', 'scrivania', altrove]);
    const no = await imposta(`aggiungi ${join(altrove, 'non-esiste')}`);
    expect(no.executed).toBe(false);
    expect(no.output.error).toMatch(/non è una cartella di questo computer/);
    const via = await imposta('togli Download');
    expect(via.executed).toBe(true);
    expect(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).documenti.cartelle))
      .toEqual(['documenti', 'scrivania', altrove]);
  } finally {
    rmSync(altrove, { recursive: true, force: true });
  }
});

test('le porte nuove sono chiuse ai siti, e da Filo si apre un documento ma non un programma', async ({ app }) => {
  const dir = join(await cartellaScaricamenti(app), 'Porte');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'fattura.pdf'), '%PDF-1.4');
  writeFileSync(join(dir, 'fattura.pdf.exe'), 'MZ');
  try {
    await shellCheRegistra(app);
    const da = (url) => (msg) => app.evaluate((_e, [m, u]) => globalThis.SN_HANDLE_MESSAGE(m, { tab: { id: 9, url: u }, url: u }), [msg, url]);
    const sito = da('http://sito-ostile.example/');
    const filo = da('filo://newtab/');
    for (const type of ['file_apri', 'file_mostra_cartella', 'documenti_stato', 'documenti_scegli_cartella']) {
      const r = await sito({ type, percorso: join(dir, 'fattura.pdf') });
      expect(r.error, `${type} accessibile da una pagina web`).toBe('forbidden');
    }
    const azione = await sito({ type: 'filo_run_action', action: { type: 'CERCA_DOCUMENTI', cosa: 'fattura' } });
    expect(azione.executed, 'un sito non fa cercare fra i documenti').not.toBe(true);
    expect((await filo({ type: 'file_apri', percorso: join(dir, 'fattura.pdf') })).ok).toBe(true);
    const exe = await filo({ type: 'file_apri', percorso: join(dir, 'fattura.pdf.exe') });
    expect(exe.ok).toBe(false);
    expect(exe.frase).toMatch(/solo documenti e immagini/);
    expect(await app.evaluate(() => globalThis.__aperti)).toEqual([join(dir, 'fattura.pdf')]);
    const sparito = await filo({ type: 'file_apri', percorso: join(dir, 'mai-esistito.pdf') });
    expect(sparito.frase).toMatch(/non c’è più/);
    // Un file sparito dentro una cartella .app: la cartella si mostra, non si apre (su Mac aprirla lancia il programma).
    const app_ = join(dir, 'Programma.app');
    mkdirSync(app_, { recursive: true });
    const mostra = await filo({ type: 'file_mostra_cartella', percorso: join(app_, 'fattura.pdf') });
    expect(mostra).toMatchObject({ ok: true, mancaIlFile: true });
    expect(await app.evaluate(() => globalThis.__aperti)).toEqual([join(dir, 'fattura.pdf')]);
    expect(await app.evaluate(() => globalThis.__cartelle)).toEqual([app_]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
