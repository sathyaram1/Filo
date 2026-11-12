// #947.3 — L'Aiuto di una scheda trova i documenti dell'utente: sul sito del fornitore, dove si carica la bolletta,
// «mi serve la bolletta della luce di marzo» dà il file da aprire o da trascinare nella pagina. La ricerca parte solo
// col sì nel popup di Filo sopra la scheda, e al documento del sito non arriva nessun percorso.
// Senza il lavoro di #947.3 l'Aiuto non conosceva la ricerca e nessuna prova qui arriva al bottone.

import { test, expect } from './fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { cartellaDellaProva, BOLLETTA_MARZO } from './helpers/documentiFinti.mjs';
import { confermaSopraPagina, confirmState, clickConfirm, nelMondoDiFilo } from './helpers/confirm.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { paginaDellAiuto } from './helpers/riquadri.mjs';

const RICHIESTA = 'mi serve la bolletta della luce di marzo';
const PAGINA = `<!doctype html><html><head><title>Fornitore Energia</title></head>
<body style="padding:40px;font:16px sans-serif"><h1>Carica la tua bolletta</h1>
<form><label>Bolletta <input type="file" id="bolletta"></label><button>Invia</button></form></body></html>`;

async function preparaModelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

// L'Aiuto riceve la risposta della prima coppia [parola, risposta] la cui parola sta nell'ultimo messaggio dell'utente;
// i messaggi delle sue chiamate restano in __visti. Le chiamate di sottofondo (la home) hanno una risposta vuota.
async function aiutoFinto(app, risposte) {
  await app.evaluate((_e, risposte) => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__visti = [];
    const risposta = ({ attempts, messages }) => {
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      if (!sistema.includes('# Protocollo di risposta')) return { text: '{"message":"Ciao.","suggestions":[],"issues":[]}', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      globalThis.__visti.push(JSON.parse(JSON.stringify(messages)));
      const ultimo = JSON.stringify([...messages].reverse().find((m) => m.role === 'user') || '');
      const scelta = risposte.find(([parola]) => ultimo.includes(parola)) || risposte[risposte.length - 1];
      return { text: scelta[1], model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => risposta(o);
  }, risposte);
}

async function shellCheRegistra(app) {
  await app.evaluate(({ shell }) => {
    globalThis.__aperti = [];
    globalThis.__cartelle = [];
    shell.openPath = async (p) => { globalThis.__aperti.push(p); return ''; };
    shell.showItemInFolder = (p) => { globalThis.__cartelle.push(p); };
  });
}

// Su un sito il pannello sta nello strato sopra la scheda (#1509.3): la Page dove guardarlo e scriverci.
async function apriAiuto(app, shell, page) {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, page);
  await expect(aiuto.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  return aiuto;
}

async function chiediAllAiuto(aiuto, testo) {
  await aiuto.fill('.sn-sidebar-input textarea', testo);
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
}

const testoDi = (messaggi) => (messaggi || []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');

const RISPOSTE = [
  ['ho cercato fra i documenti', JSON.stringify({ text: 'È la bolletta dell\'energia elettrica di marzo: trascinala nel campo «Bolletta».', file: 1, status: 'done' })],
  ['', JSON.stringify({ action: 'documenti', cosa: 'bolletta luce energia elettrica marzo', text: 'La cerco fra i tuoi documenti.' })],
];

test('la prova della segnalazione: sul sito del fornitore l’Aiuto trova la bolletta, dopo il sì nel popup di Filo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Scansioni');
  cartellaDellaProva(dir);
  const bolletta = join(dir, BOLLETTA_MARZO);
  try {
    const page = await testServer.openReady(openTab, PAGINA);
    await preparaModelli(app);
    await aiutoFinto(app, RISPOSTE);
    await shellCheRegistra(app);
    const aiuto = await apriAiuto(app, shell, page);
    await chiediAllAiuto(aiuto, RICHIESTA);

    // Il sì lo chiede Filo fuori dal documento del sito, e dice cosa vedrà il sito.
    const sopra = await confermaSopraPagina(app, { timeout: 20_000 });
    const domanda = await confirmState(sopra);
    expect(domanda.title).toBe('Cerco fra i tuoi documenti?');
    expect(domanda.fuori).toContain('127.0.0.1');
    // La richiesta la scrive il modello: sta intera nel suo riquadro (#592.7).
    expect(domanda.citazioni).toEqual(['bolletta luce energia elettrica marzo']);
    await clickConfirm(sopra, 'ok');

    const file = aiuto.locator('.sn-sidebar .sn-sidebar-file');
    await expect(file).toHaveCount(1, { timeout: 20_000 });
    await expect(file.locator('.sn-sidebar-file-nome')).toHaveText(BOLLETTA_MARZO);
    await expect(file.locator('.sn-sidebar-file-dove')).toHaveText('Download › Scansioni');
    await expect(aiuto.locator('.sn-sidebar-msg-assistant').last()).toContainText('bolletta dell\'energia elettrica di marzo');
    await expect(aiuto.locator('.sn-sidebar-log', { hasText: 'documenti' })).toHaveText(['· 5 trovati fra i tuoi documenti «bolletta luce energia elettrica marzo»']);

    // Il modello ha avuto la bolletta come primo candidato, con la cartella detta coi nomi di Filo e senza percorsi.
    const visti = await app.evaluate(() => globalThis.__visti);
    const conCandidati = testoDi(visti.find((m) => testoDi(m).includes('DOCUMENTI_TROVATI')));
    expect(conCandidati).toMatch(new RegExp(`1\\. ${BOLLETTA_MARZO.replace('.', '\\.')}`));
    expect(conCandidati).toContain('cartella: Download › Scansioni');
    expect(conCandidati).toMatch(/01\/03\/2026/);
    expect(conCandidati).not.toContain(dir);
    expect(conCandidati, 'il testo di un documento che non è fra i candidati non esce').not.toContain('Programma cotone 40 gradi');

    // Nel documento del sito non c'è nessun percorso del computer.
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    expect(html).not.toContain(dir);

    // Un clic lo apre col programma del sistema; dal tasto destro si apre la sua cartella.
    await file.click();
    await expect.poll(() => app.evaluate(() => globalThis.__aperti)).toEqual([bolletta]);
    // Il tasto destro apre il menu di Filo con le azioni del file, non quello della pagina.
    await file.click({ button: 'right' });
    const voci = menuDi(aiuto).locator('.sn-menu .sn-menu-item');
    await expect(voci).toHaveText(['Apri', 'Mostra nella cartella']);
    await voci.filter({ hasText: 'Mostra nella cartella' }).click();
    await expect.poll(() => app.evaluate(() => globalThis.__cartelle)).toEqual([bolletta]);

    // Trascinato, parte il trascinamento del sistema col file vero: quello che la pagina riceve al rilascio.
    await app.evaluate(({ webContents }) => {
      globalThis.__trascinati = [];
      for (const wc of webContents.getAllWebContents()) wc.startDrag = (item) => { globalThis.__trascinati.push(item.file); };
    });
    const box = await file.boundingBox();
    await aiuto.mouse.move(box.x + 20, box.y + box.height / 2);
    await aiuto.mouse.down();
    await aiuto.mouse.move(box.x + 60, box.y + box.height / 2 + 30, { steps: 6 });
    await aiuto.mouse.move(box.x - 200, box.y - 200, { steps: 6 });
    await aiuto.mouse.up();
    await expect.poll(() => app.evaluate(() => globalThis.__trascinati)).toEqual([bolletta]);

    await aiuto.screenshot({ path: 'tests/.shots/aiuto-cerca-documenti.png' });
    await app.evaluate((_e) => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }, { tab: { url: 'filo://preferences/' }, url: 'filo://preferences/' }));
    await page.waitForTimeout(600);
    await aiuto.screenshot({ path: 'tests/.shots/aiuto-cerca-documenti-scuro.png' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('con Annulla nel popup non si cerca niente e l’Aiuto non riceve documenti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Annulla');
  cartellaDellaProva(dir);
  try {
    const page = await testServer.openReady(openTab, PAGINA);
    await preparaModelli(app);
    await aiutoFinto(app, RISPOSTE);
    const aiuto = await apriAiuto(app, shell, page);
    await chiediAllAiuto(aiuto, RICHIESTA);
    const sopra = await confermaSopraPagina(app, { timeout: 20_000 });
    await clickConfirm(sopra, 'cancel');
    await expect(aiuto.locator('.sn-sidebar-log', { hasText: 'documenti' })).toHaveText(['· ricerca fra i documenti annullata'], { timeout: 10_000 });
    await page.waitForTimeout(500);
    await expect(aiuto.locator('.sn-sidebar-file')).toHaveCount(0);
    const visti = await app.evaluate(() => globalThis.__visti);
    expect(visti.length, 'nessun giro in più verso il modello').toBe(1);
    expect(testoDi(visti.flat())).not.toContain('DOCUMENTI_TROVATI');
    expect(testoDi(visti.flat())).not.toContain(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('le porte dell’Aiuto: chiavi a caso valide solo nella loro scheda, mai un percorso, niente da un riquadro', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Porte');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'fattura-luce.txt'), 'Fattura energia elettrica marzo');
  try {
    await shellCheRegistra(app);
    // La domanda si vede sopra la scheda che cerca quando è davanti: quella si apre per ultima.
    await testServer.openReady(openTab, PAGINA.replace('Fornitore Energia', 'Altro sito'), { pubblico: true });
    await testServer.openReady(openTab, PAGINA);
    // Dal mondo dove vive l'Aiuto di ciascuna scheda: è quello che un sito arriva a usare, se ci arriva.
    const dalMondo = (host, msg) => nelMondoDiFilo(app, host, `chrome.runtime.sendMessage(${JSON.stringify(msg)})`);
    const cerca = dalMondo('127.0.0.1', { type: 'aiuto_cerca_documenti', cosa: 'fattura luce' });
    await clickConfirm(await confermaSopraPagina(app, { timeout: 15_000 }), 'ok');
    const r = await cerca;
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain(dir);
    const chiave = r.candidati.find((c) => c.nome === 'fattura-luce.txt').chiave;
    expect((await dalMondo('sito-pubblico.test', { type: 'aiuto_apri_file', chiave })).ok, 'un\'altra scheda non apre con quella chiave').not.toBe(true);
    expect((await dalMondo('127.0.0.1', { type: 'aiuto_apri_file', chiave: 'inventata', percorso: join(dir, 'fattura-luce.txt') })).ok).not.toBe(true);
    // Un riquadro dentro la scheda è un altro sito.
    const riquadro = await app.evaluate(async ({ BrowserWindow }, chiave) => {
      for (const w of BrowserWindow.getAllWindows()) {
        for (const t of w._filoTabs?.tabs || []) {
          const wc = t.view && t.view.webContents;
          if (!wc || !/^http:\/\/127\.0\.0\.1/.test(wc.getURL())) continue;
          const url = wc.getURL();
          return globalThis.SN_HANDLE_MESSAGE({ type: 'aiuto_apri_file', chiave }, { tab: { id: t.id, url }, url, wc, frame: { parent: wc.mainFrame } });
        }
      }
      return null;
    }, chiave);
    expect(riquadro.error).toBe('forbidden');
    expect(await app.evaluate(() => globalThis.__aperti)).toEqual([]);
    expect((await dalMondo('127.0.0.1', { type: 'aiuto_apri_file', chiave })).ok).toBe(true);
    expect(await app.evaluate(() => globalThis.__aperti)).toEqual([join(dir, 'fattura-luce.txt')]);
    // Senza webContents (una chiamata che non viene da una scheda) la porta non risponde.
    const senza = await app.evaluate((_e, m) => globalThis.SN_HANDLE_MESSAGE(m, { tab: { id: 9, url: 'http://sito-ostile.example/' }, url: 'http://sito-ostile.example/' }), { type: 'aiuto_cerca_documenti', cosa: 'fattura' });
    expect(senza.error).toBe('forbidden');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mentre l’indice legge i documenti nuovi la riga dice quanti ne mancano, e «Ferma» risponde con quelli già letti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Tanti');
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 60; i++) writeFileSync(join(dir, `doc_${String(i).padStart(3, '0')}.txt`), `documento numero ${i}`);
  try {
    await app.evaluate(() => {
      globalThis.SN_DOCUMENTI_INDICE.configura({
        estrai: async (p) => { await new Promise((ok) => setTimeout(ok, 150)); return { testo: `contenuto di ${p}`, pagine: 0, vuoto: false, errore: '' }; },
      });
    });
    const page = await testServer.openReady(openTab, PAGINA);
    await preparaModelli(app);
    await aiutoFinto(app, [
      ['ho cercato fra i documenti', JSON.stringify({ text: 'Ho guardato solo quelli già letti.', status: 'done' })],
      ['', JSON.stringify({ action: 'documenti', cosa: 'documento numero 42' })],
    ]);
    const aiuto = await apriAiuto(app, shell, page);
    await chiediAllAiuto(aiuto, 'trovami il documento numero 42');
    await clickConfirm(await confermaSopraPagina(app, { timeout: 20_000 }), 'ok');
    const riga = aiuto.locator('.sn-sidebar-log', { hasText: 'leggo i documenti nuovi' });
    await expect(riga).toHaveText(/leggo i documenti nuovi: \d+ di 60/, { timeout: 10_000 });
    await expect(riga).not.toContainText('doc_', { message: 'la pagina non vede i nomi dei file che l\'indice legge' });
    await aiuto.screenshot({ path: 'tests/.shots/aiuto-cerca-documenti-attesa.png' });
    await riga.locator('.sn-sidebar-log-ferma').click();
    await expect(aiuto.locator('.sn-sidebar-log', { hasText: ', fermata da te' })).toBeVisible({ timeout: 5_000 });
    await expect(riga).toHaveCount(0);
    await expect(aiuto.locator('.sn-sidebar-msg-assistant').last()).toHaveText('Ho guardato solo quelli già letti.', { timeout: 10_000 });
    const visti = await app.evaluate(() => globalThis.__visti);
    expect(testoDi(visti[visti.length - 1])).toContain('FERMATO');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
