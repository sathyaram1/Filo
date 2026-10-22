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
    // Dove sta, coi nomi delle cartelle di Filo: «Download», non «downloads» né la cartella dell'account.
    await expect(file.locator('.dash-file-btn-dove')).toHaveText('Download › Scansioni');
    await expect(file).toHaveAttribute('data-percorso', bolletta);

    // Al modello è arrivato quel file come PRIMO candidato, con il pezzo di testo che lo distingue; il testo intero
    // dei venti documenti no.
    const chiamate = await chiamateAlModello(app);
    const esito = testoDeiMessaggi(chiamate[1]);
    expect(esito).toMatch(new RegExp(`1\\. ${BOLLETTA_MARZO.replace('.', '\\.')}`));
    expect(esito).toContain(bolletta);
    expect(esito).toMatch(/01\/03\/2026/);
    expect(esito, 'il testo di un documento che non è fra i candidati non esce').not.toContain('Programma cotone 40 gradi');
    // Né quello dei documenti che con la richiesta hanno in comune una parola sola: busta paga e dimissioni («marzo»).
    expect(esito).not.toContain('Retribuzione netta');
    expect(esito).not.toContain('dimissioni');
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
    await expect(file.locator('.dash-file-btn-dove')).toHaveText('Download › Scheda');
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
    await expect(file.locator('.dash-file-btn-dove')).toHaveText('Download › Trascina');
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

// #947.3 — una cartella fuori elenco in cui l'utente ha chiesto di cercare resta nell'indice: si vede in Preferenze e
// da lì si dimentica.
test('una cartella cercata per l\'occasione si vede in Preferenze, coi documenti tenuti, e si dimentica', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const archivio = cartellaTemporanea('filo-archivio-');
  writeFileSync(join(archivio, 'affitto.txt'), 'Contratto di locazione ad uso abitativo');
  writeFileSync(join(archivio, 'luce.txt'), 'Bolletta energia elettrica marzo');
  try {
    const r = await app.evaluate((_e, c) => globalThis.SN_DOCUMENTI_INDICE.cerca('contratto affitto', { cartella: c }), archivio);
    expect(r.risultati[0].nome).toBe('affitto.txt');
    const pref = await openTab('filo://preferences/preferences.html');
    const riga = pref.locator(`#documentiCercate .doc-occasionale[data-occasionale="${archivio.replace(/\\/g, '\\\\')}"]`);
    await expect(riga).toBeVisible({ timeout: 10_000 });
    await expect(riga.locator('.doc-dove')).toContainText('ci hai cercato tu · 2 documenti già letti');
    await pref.locator('#sec-documenti').screenshot({ path: 'tests/.shots/cerca-documenti-occasionale.png' });
    await riga.locator('.mem-via').click();
    await expect(riga).toHaveCount(0);
    await expect(pref.locator('#documentiHint')).toHaveText('Dimenticata');
    const stato = await app.evaluate(() => globalThis.SN_DOCUMENTI_INDICE.stato());
    expect(stato.occasionali.some((o) => o.percorso === archivio)).toBe(false);
    const porta = await app.evaluate((_e, c) => globalThis.SN_HANDLE_MESSAGE({ type: 'documenti_dimentica', percorso: c }, { tab: { id: 9, url: 'http://sito-ostile.example/' }, url: 'http://sito-ostile.example/' }), archivio);
    expect(porta.error, 'un sito non fa dimenticare niente').toBe('forbidden');
  } finally {
    rmSync(archivio, { recursive: true, force: true });
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
    for (const type of ['file_apri', 'file_mostra_cartella', 'documenti_stato', 'documenti_scegli_cartella', 'documenti_dimentica']) {
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

// #947 giro 5: il bottone aggiunto da Filo è quello del file che la risposta sceglie. Una parola comune che coincide col
// nome di un altro candidato («ricevuta» → ricevuta.pdf) o un file nominato per scartarlo non ne hanno uno.
test('il bottone aggiunto dalla risposta è solo quello del file scelto', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = join(await cartellaScaricamenti(app), 'Scelto');
  cartellaDellaProva(dir);
  const casi = [
    ['dov\'è la ricevuta dell\'assicurazione?', 'ricevuta assicurazione', 'Ecco la ricevuta dell\'assicurazione: è xyz123.pdf, la quietanza della polizza RC auto.', ['xyz123.pdf']],
    ['mi serve la bolletta della luce di marzo', 'bolletta luce marzo', 'È scan_00231.pdf, del periodo 01/03/2026 - 31/03/2026; non scan_00198.pdf, che è di febbraio.', ['scan_00231.pdf']],
    ['mi serve la bolletta della luce di marzo', 'bolletta luce marzo', 'Non è scan_00198 (febbraio): la bolletta di marzo è scan_00231.', ['scan_00231.pdf']],
  ];
  try {
    const page = await home(app);
    for (const [domanda, cosa, risposta, attesi] of casi) {
      await modelloFinto(app, [
        { toolCalls: [{ id: 'd1', name: 'CERCA_DOCUMENTI', arguments: JSON.stringify({ cosa }) }] },
        { text: risposta },
      ]);
      const prima = await page.locator('.dash-bubble-actions').count();
      await chiedi(page, domanda);
      const bolla = page.locator('.dash-bubble-actions').nth(prima);
      await expect(bolla.locator('.dash-file-btn').first()).toBeVisible({ timeout: 20_000 });
      await expect(bolla.locator('.dash-file-btn-nome')).toHaveText(attesi);
      await ripristina(app);
    }
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

// #947 giro 6: su Mac chi nega alla prima ricerca il permesso per una cartella ha una cartella che Filo non può
// elencare. Non deve passare per vuota («0 documenti», «non c'è»): il modello sa che manca il permesso e come darlo, e
// la pagina Preferenze lo dice accanto alla cartella. Il rifiuto si imita sull'elenco della cartella (EPERM, come macOS).
test('una cartella che il sistema non lascia leggere non passa per vuota, né in chat né in Preferenze', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const scaricati = await cartellaScaricamenti(app);
  const dir = join(scaricati, 'Negata');
  cartellaDellaProva(dir);
  try {
    await app.evaluate((_e, negata) => {
      const fsp = process.getBuiltinModule('node:fs/promises');
      const path = process.getBuiltinModule('node:path');
      globalThis.__readdirVero = fsp.readdir;
      fsp.readdir = async (d, o) => {
        if (path.resolve(String(d)) === path.resolve(negata)) {
          const e = new Error(`EPERM: operation not permitted, scandir '${d}'`);
          e.code = 'EPERM';
          throw e;
        }
        return globalThis.__readdirVero(d, o);
      };
    }, scaricati);
    await modelloFinto(app, [
      { toolCalls: [{ id: 'd1', name: 'CERCA_DOCUMENTI', arguments: JSON.stringify({ cosa: 'bolletta luce energia elettrica kWh marzo' }) }] },
      { text: 'Il sistema non mi lascia leggere i Download.' },
    ]);
    const page = await home(app);
    await chiedi(page, RICHIESTA);
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
    const esito = testoDeiMessaggi((await chiamateAlModello(app))[1]);
    const i = esito.lastIndexOf('[Nessun documento combacia');
    expect(i, 'il blocco della ricerca arriva al modello').toBeGreaterThanOrEqual(0);
    const blocco = esito.slice(i, i + 3000);
    expect(blocco).toMatch(/Download \(il sistema non la lascia leggere\)/);
    expect(blocco).toMatch(/NON lascia leggere a Filo Download[^\]]*non dire che il documento non c'è/);

    const pref = await openTab('filo://preferences/preferences.html');
    const riga = pref.locator('#documentiCartelle .mem-riga[data-cartella="download"] .doc-dove');
    await expect(riga).toHaveText(/il sistema non lascia leggere questa cartella a Filo · \S/, { timeout: 10_000 });
    await expect(riga).toHaveClass(/doc-negata/);
    await pref.locator('#sec-documenti').screenshot({ path: 'tests/.shots/cerca-documenti-negata.png' });
  } finally {
    await app.evaluate(() => {
      const fsp = process.getBuiltinModule('node:fs/promises');
      if (globalThis.__readdirVero) fsp.readdir = globalThis.__readdirVero;
    });
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

// #256.10 — con qualche migliaio di file la riga dello stato scrive ogni numero allo stesso modo, col punto delle migliaia.
test('lo stato dei documenti in Preferenze scrive tutti i numeri col punto delle migliaia', async ({ app, openTab }) => {
  await app.evaluate(() => {
    const I = globalThis.SN_DOCUMENTI_INDICE;
    I.__statoVero = I.stato;
    I.stato = async () => ({ documenti: 5000, scansioni: 1200, inCorso: { fatti: 1233, totali: 5000 } });
  });
  try {
    const pref = await openTab('filo://preferences/preferences.html');
    await expect(pref.locator('#documentiStato'))
      .toHaveText('5.000 documenti, di cui 1.200 scansioni senza testo · ne sto leggendo 1.234 di 5.000', { timeout: 10_000 });
  } finally {
    await app.evaluate(() => { const I = globalThis.SN_DOCUMENTI_INDICE; I.stato = I.__statoVero; delete I.__statoVero; });
  }
});

// #1499 — un percorso di rete scritto dal modello, anche dietro un segno di citazione, non arriva al disco: niente bottone,
// niente ricerca, e un clic forzato non tocca file system né shell. Il contatto SMB vero di Windows non si prova nel
// contenitore: si prova che nessuno chiede quel percorso al disco. Il bottone di un file vero porta il suo nome vero.
test('un percorso di rete non diventa un bottone né una ricerca, e un clic forzato non arriva al disco', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = join(await cartellaScaricamenti(app), 'Vero');
  mkdirSync(dir, { recursive: true });
  const vero = join(dir, 'scan_00231.pdf');
  writeFileSync(vero, '%PDF-1.4');
  try {
    await shellCheRegistra(app);
    await app.evaluate(() => {
      const fs = process.getBuiltinModule('fs');
      const fsp = process.getBuiltinModule('fs/promises');
      globalThis.__rete = [];
      const nota = (p) => { if (/nas-esterno/i.test(String(p))) globalThis.__rete.push(String(p)); };
      const o = { statSync: fs.statSync, stat: fsp.stat, existsSync: fs.existsSync, realpath: fs.realpathSync.native, lstat: fsp.lstat };
      fs.statSync = function statSync(p, ...r) { nota(p); return o.statSync.call(this, p, ...r); };
      fs.existsSync = function existsSync(p) { nota(p); return o.existsSync.call(this, p); };
      fs.realpathSync.native = function native(p, ...r) { nota(p); return o.realpath.call(this, p, ...r); };
      fsp.stat = function stat(p, ...r) { nota(p); return o.stat.call(this, p, ...r); };
      fsp.lstat = function lstat(p, ...r) { nota(p); return o.lstat.call(this, p, ...r); };
      globalThis.__reteVia = () => {
        fs.statSync = o.statSync; fs.existsSync = o.existsSync; fs.realpathSync.native = o.realpath; fsp.stat = o.stat; fsp.lstat = o.lstat;
      };
    });
    await modelloFinto(app, [
      { toolCalls: [
        { id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: '//nas-esterno/condivisa/fattura.pdf', etichetta: 'La tua fattura' }) },
        { id: 'f2', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: '«/net/nas-esterno/condivisa/fattura.pdf', etichetta: 'La tua fattura' }) },
        { id: 'f3', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: '', path: '"//nas-esterno/c/fattura.pdf"' }) },
        { id: 'f4', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: vero, etichetta: 'Bolletta della luce' }) },
        { id: 'd1', name: 'CERCA_DOCUMENTI', arguments: JSON.stringify({ cosa: 'fattura', cartella: '«//nas-esterno/condivisa' }) },
      ] },
      { text: 'Ecco la fattura.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'trovami la fattura');

    // Solo il file di questo computer è un bottone, col suo nome vero; l'etichetta di Filo sta accanto, più piana.
    const file = page.locator('.dash-file-btn');
    await expect(file).toHaveCount(1, { timeout: 20_000 });
    await expect(file.locator('.dash-file-btn-nome')).toHaveText('scan_00231.pdf');
    await expect(file.locator('.dash-file-btn-etichetta')).toHaveText('Bolletta della luce');
    await expect(page.locator('.dash-bubble-actions a.dash-action-btn')).toHaveCount(0);
    await page.screenshot({ path: 'tests/.shots/cerca-documenti-rete.png' });
    // Il diario dice perché gli altri non ci sono.
    await page.locator('.dash-activity-head').first().click();
    await expect(page.locator('.dash-activity-row', { hasText: 'File non mostrato · il file sta su un altro computer della rete' })).toHaveCount(3);
    await expect(page.locator('.dash-activity-row', { hasText: 'la cartella sta su un altro computer della rete' })).toHaveCount(1);
    // Il modello lo sa, e non gli è stato chiesto un OK per una ricerca che non sarebbe partita.
    const esito = testoDeiMessaggi((await chiamateAlModello(app))[1]);
    expect(esito).toMatch(/sta su un altro computer della rete: Filo non ci cerca/);
    expect(esito).toMatch(/Bottone NON mostrato: il file sta su un altro computer della rete/);
    expect(esito).not.toMatch(/In attesa della conferma/);

    // Un clic forzato (il bottone di una chat di prima, un messaggio costruito a mano) non arriva al disco.
    const filo = (msg) => app.evaluate((_e, m) => globalThis.SN_HANDLE_MESSAGE(m, { tab: { id: 9, url: 'filo://newtab/' }, url: 'filo://newtab/' }), msg);
    for (const percorso of ['//nas-esterno/condivisa/fattura.pdf', '/net/nas-esterno/fattura.pdf', '«//nas-esterno/c/fattura.pdf']) {
      for (const msg of [{ type: 'file_apri' }, { type: 'file_mostra_cartella' }, { type: 'file_nome_proponi' }, { type: 'file_rinomina', nome: 'Fattura' }]) {
        const r = await filo({ ...msg, percorso });
        expect(r, `${msg.type} ${percorso}`).toMatchObject({ ok: false, errore: 'rete' });
        expect(r.frase).toMatch(/altro computer della rete/);
      }
    }
    expect(await app.evaluate(() => globalThis.__rete)).toEqual([]);
    expect(await app.evaluate(() => globalThis.__aperti)).toEqual([]);
    expect(await app.evaluate(() => globalThis.__cartelle)).toEqual([]);
    // Il file vero si apre ancora.
    await file.click();
    await expect.poll(() => app.evaluate(() => globalThis.__aperti)).toEqual([vero]);
  } finally {
    await app.evaluate(() => { try { globalThis.__reteVia?.(); } catch (_) {} });
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

// #1499 — il nome vero del file resta intero accanto a un nome lungo dato da Filo, e un percorso di questo computer
// fra virgolette o caporali diventa lo stesso bottone di quello senza segni.
test('il bottone tiene intero il nome vero accanto a un nome lungo di Filo, e un percorso fra virgolette è un bottone', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = join(await cartellaScaricamenti(app), 'Vero');
  mkdirSync(dir, { recursive: true });
  const vero = join(dir, 'malevolo.pdf');
  writeFileSync(vero, '%PDF-1.4');
  try {
    await shellCheRegistra(app);
    const lunga = 'Bolletta della luce di marzo 2026 del fornitore di energia elettrica, quella giusta da pagare entro venerdì '.repeat(3);
    await modelloFinto(app, [
      { toolCalls: [
        { id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: vero, etichetta: 'Bolletta della luce Enel di marzo 2026, periodo dal 01/03 al 31/03' }) },
        { id: 'f2', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: vero, etichetta: lunga }) },
        { id: 'f3', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: `"${vero}"`, etichetta: 'Bolletta' }) },
        { id: 'f4', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: '', path: `«${vero}»`, etichetta: 'Bolletta' }) },
      ] },
      { text: 'Ecco la bolletta.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'trovami la bolletta');
    const nomi = page.locator('.dash-file-btn .dash-file-btn-nome');
    await expect(nomi).toHaveText(Array(4).fill('malevolo.pdf'), { timeout: 20_000 });
    await expect(page.locator('.dash-bubble-actions a.dash-action-btn')).toHaveCount(0);
    // Anche una frazione di pixel in meno mette i puntini al posto delle ultime lettere: si misura il testo, non l'intero.
    const misure = await nomi.evaluateAll((els) => els.map((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return { testo: r.getBoundingClientRect().width, scatola: el.getBoundingClientRect().width };
    }));
    for (const m of misure) expect(m.testo, 'il nome vero non è tagliato').toBeLessThanOrEqual(m.scatola + 0.01);
    await expect(page.locator('.dash-file-btn').nth(3)).toHaveAttribute('data-percorso', vero);
    await page.screenshot({ path: 'tests/.shots/cerca-documenti-nome-vero.png' });
    await page.locator('.dash-file-btn').nth(3).click();
    await expect.poll(() => app.evaluate(() => globalThis.__aperti)).toEqual([vero]);
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});
