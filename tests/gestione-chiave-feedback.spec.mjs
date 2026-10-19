// #1042 — La Filo installata non ha la chiave dei feedback (niente variabile, niente tests/agent/.env): la Gestione lo
// dice, la fa caricare da un file scelto dalla finestra del main, e da lì decifra come quella dai sorgenti: sezioni,
// bacheca e allegati. La chiave non finisce in chiaro su disco né in un messaggio verso le pagine.

import { test, expect } from './fixtures/electron.mjs';
import { webcrypto } from 'node:crypto';
import { writeFileSync, readFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from './helpers/percorsi.mjs';

const MANAGE = 'filo://manage/manage.html';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '.shots');
const ALLEGATO = 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2Fprova.png?alt=media&token=t';

async function coppiaDiProva() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return {
    pub: Buffer.from(await webcrypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url'),
    priv: Buffer.from(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64'),
  };
}

// Le segnalazioni come stanno sul server: lo stato cifrato con la chiave pubblica, e una vecchia in chiaro, come
// i documenti di prima della cifratura. Ricevuti 1 · In coda 2 · Risolti 3 · Archiviati 1.
const PRATICHE = [
  { _id: 'p1', seq: 1, stato: 'unlabeled', name: 'Arrivata adesso', nomeCifrato: true },
  { _id: 'p2', seq: 2, stato: 'todo', name: 'In coda' },
  { _id: 'p3', seq: 3, stato: 'working', name: 'In lavorazione' },
  { _id: 'p4', seq: 4, stato: 'done', name: 'Chiusa da mesi', resolvedInVersion: '0.1.0' },
  { _id: 'p5', seq: 5, stato: 'done', name: 'Chiusa anche lei', resolvedInVersion: '0.1.0' },
  { _id: 'p6', seq: 6, stato: 'archived', name: 'Archiviata' },
  { _id: 'p7', seq: 7, stato: 'done', name: 'Vecchia in chiaro', resolvedInVersion: '0.1.0', inChiaro: true },
];

// Il main com'è nella Filo installata, con le risposte del server finte. `portachiavi`: se il sistema ne ha uno.
async function bancoDiProva(app, { pub, portachiavi = true }) {
  await app.evaluate(async ({ safeStorage, ipcMain, webContents, app: eApp }, { pub, pratiche, portachiavi, allegato }) => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    const ga = req('./auth/google-auth');
    ga.isAdmin = () => true;
    ga.getIdToken = async () => 'tok-di-prova';
    delete process.env.FILO_FEEDBACK_PRIVKEY;
    // Il .env del checkout non c'è nel pacchetto: qui non si raggiunge.
    req('./services/chiaveFeedback').fileDiSviluppo = () => path.join(eApp.getPath('userData'), 'non-esiste', '.env');
    globalThis.SN_FEEDBACK_PUBKEY = pub;

    safeStorage.isEncryptionAvailable = () => portachiavi;
    safeStorage.getSelectedStorageBackend = () => (portachiavi ? 'gnome_libsecret' : 'basic_text');
    // Una cifratura finta ma non identica: il testo su disco non deve contenere la chiave.
    safeStorage.encryptString = (s) => Buffer.from('finta:' + Buffer.from(String(s), 'utf8').toString('hex').split('').reverse().join(''));
    safeStorage.decryptString = (b) => Buffer.from(Buffer.from(b).toString().slice(6).split('').reverse().join(''), 'hex').toString('utf8');

    const C = globalThis.SN_FEEDBACK_CRYPTO;
    const righe = [];
    for (const p of pratiche) {
      righe.push({
        _id: p._id, seq: p.seq, subSeq: 0, text: 'Testo.', clientId: 'utente-x',
        name: p.nomeCifrato ? await C.encryptForOwner(p.name) : p.name,
        status: p.inChiaro ? p.stato : await C.encryptForOwner(p.stato),
        statusPublic: ['done', 'archived'].includes(p.stato) ? 'closed' : 'open',
        createdAt: `2026-0${p.seq}-01T10:00:00.000Z`,
        ...(p.resolvedInVersion ? { resolvedInVersion: p.resolvedInVersion, resolvedAt: '2026-08-01T10:00:00.000Z' } : {}),
        images: [],
      });
    }
    globalThis.__banco = { pubblicate: [], uscite: [] };
    const FB = globalThis.SN_FEEDBACK;
    FB.list = async ({ afterName } = {}) => (afterName ? [] : JSON.parse(JSON.stringify(righe)));
    FB.listResolved = async () => [];
    FB.listPublic = async () => [];
    FB.getPublic = async () => null;
    FB.getMany = async (ids) => righe.filter((r) => ids.includes(r._id)).map((r) => JSON.parse(JSON.stringify(r)));
    FB.maxSeq = async () => null;
    FB.ensureSeqCounter = async () => 0;
    FB.publishPublicCard = async (docId) => { globalThis.__banco.pubblicate.push(docId); return true; };
    FB.unpublishPublicCard = async () => true;

    // L'allegato cifrato, come lo serve il deposito.
    const byte = await C.encryptBytesForOwner(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
    const fetchVero = globalThis.fetch;
    globalThis.fetch = async (url, opts) => (String(url) === allegato
      ? new Response(byte, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } })
      : fetchVero(url, opts));

    // Tutto quello che il main manda alle pagine: risposte ai messaggi e avvisi.
    const registra = (canale, dati) => {
      try { globalThis.__banco.uscite.push(`${canale} ${JSON.stringify(dati)}`); } catch (_) {}
    };
    if (!globalThis.__bancoSpie) {
      globalThis.__bancoSpie = true;
      const orig = ipcMain._invokeHandlers.get('filo:message');
      ipcMain.removeHandler('filo:message');
      ipcMain.handle('filo:message', async (event, msg) => {
        const r = await orig(event, msg);
        registra(`risposta:${msg && msg.type}`, r);
        return r;
      });
      const spia = (wc) => {
        const send = wc.send.bind(wc);
        wc.send = (canale, ...args) => { registra(canale, args); return send(canale, ...args); };
      };
      webContents.getAllWebContents().forEach(spia);
      eApp.on('web-contents-created', (_e, wc) => spia(wc));
    }
  }, { pub, pratiche: PRATICHE, portachiavi, allegato: ALLEGATO });
}

async function scegliIlFile(app, file) {
  await app.evaluate(({ dialog }, f) => {
    globalThis.__finestreDiScelta = 0;
    dialog.showOpenDialog = async () => { globalThis.__finestreDiScelta++; return { canceled: false, filePaths: [f] }; };
  }, file);
}

async function apriGestione(openTab) {
  const page = await openTab(MANAGE);
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  return page;
}

function fileDentro(dir) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    let st;
    try { st = statSync(p); } catch (_) { continue; }
    if (st.isDirectory()) out.push(...fileDentro(p));
    else if (st.isFile() && st.size < 5 * 1024 * 1024) out.push(p);
  }
  return out;
}

let cartella = '';
test.beforeEach(() => { cartella = cartellaTemporanea('filo-chiave-'); });
test.afterEach(() => { togliCartella(cartella); });

test('senza chiave la Gestione lo dice; caricata dal file, le segnalazioni tornano nelle loro sezioni', async ({ app, openTab }) => {
  const { pub, priv } = await coppiaDiProva();
  await bancoDiProva(app, { pub });
  // Il file dell'owner: il .env degli strumenti, con altre righe intorno.
  const file = join(cartella, '.env');
  writeFileSync(file, `OPENROUTER_API_KEY=sk-or-v1-finta\nFILO_FEEDBACK_PRIVKEY=${priv}\nALTRO=1\n`);
  await scegliIlFile(app, file);

  const page = await apriGestione(openTab);

  // 1. Senza chiave: l'avviso dice cosa manca e offre di caricarla, al posto di sezioni mescolate.
  const avviso = page.locator('#mgNoSections');
  await expect(avviso).toBeVisible();
  await expect(avviso).toContainText('Manca la chiave dei feedback');
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toBeHidden();
  await expect(page.locator('.mg-item')).toHaveCount(PRATICHE.length);
  const carica = avviso.getByRole('button', { name: 'Carica la chiave…' });
  await expect(carica).toBeVisible();
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, 'gestione-chiave-avviso.png') });
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, 'gestione-chiave-avviso-scuro.png') });
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'system'; });

  // La bacheca senza chiave sta ferma: niente pubblicato alla cieca.
  expect(await app.evaluate(() => globalThis.__banco.pubblicate.length)).toBe(0);

  // 2. Un clic: la finestra di scelta la apre il main, e la pagina rilegge con la chiave.
  await carica.click();
  await expect(avviso).toBeHidden();
  expect(await app.evaluate(() => globalThis.__finestreDiScelta)).toBe(1);
  const attesi = { inbox: 'Ricevuti (1)', queue: 'In coda (2)', resolved: 'Risolti (3)', archived: 'Archiviati (1)' };
  for (const [tab, testo] of Object.entries(attesi)) {
    await expect(page.locator(`.mg-tab[data-tab="${tab}"]`)).toHaveText(testo);
  }
  // I campi cifrati si leggono: il nome della segnalazione nei Ricevuti, non il segnaposto.
  await page.locator('.mg-tab[data-tab="inbox"]').click();
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item')).toContainText('Arrivata adesso');
  await page.locator('.mg-tab[data-tab="resolved"]').click();
  await expect(page.locator('.mg-item')).toHaveCount(3);
  await page.screenshot({ path: join(SHOTS, 'gestione-chiave-caricata.png') });

  // 3. Gli altri usi della chiave: la bacheca si rimette in pari, e l'allegato cifrato si apre.
  await expect.poll(() => app.evaluate(() => globalThis.__banco.pubblicate.length), { timeout: 15_000 }).toBeGreaterThan(0);
  const immagine = await page.evaluate((url) => window.filo.message({ type: 'feedback_decrypt_image', url }), ALLEGATO);
  expect(immagine.ok, immagine.error).toBe(true);
  expect(immagine.dataUrl).toMatch(/^data:image\/png;base64,/);

  // 4. La chiave non è in chiaro su disco, e nessun messaggio verso le pagine la porta.
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  expect(existsSync(join(userData, 'chiave-feedback.bin')), 'la chiave non è stata custodita').toBe(true);
  const letti = fileDentro(userData).map((f) => { try { return [f, readFileSync(f)]; } catch (_) { return [f, null]; } });
  expect(letti.some(([f, b]) => b && /storage\.json$/.test(f)), 'storage.json non letto').toBe(true);
  for (const [f, b] of letti) {
    if (b) expect(b.includes(Buffer.from(priv)), `la chiave in chiaro in ${f}`).toBe(false);
  }
  const uscite = await app.evaluate(() => globalThis.__banco.uscite);
  expect(uscite.some((u) => u.startsWith('risposta:feedback_chiave_carica')), 'la spia non ha visto il caricamento').toBe(true);
  for (const u of uscite) expect(u.includes(priv), `la chiave in un messaggio verso le pagine: ${u.slice(0, 80)}`).toBe(false);

  // 5. Si toglie da dove la si vede: Automazioni dice da dove arriva, e «Dimentica» (due clic) la toglie.
  await page.locator('.mg-sezione[data-sezione="routine"]').click();
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await expect(page.locator('#mgChiaveStato')).toContainText('Custodita su questo computer');
  await page.locator('#mgChiaveBlock').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, 'gestione-chiave-automazioni.png') });
  const dimentica = page.locator('#mgChiaveDimentica');
  await dimentica.click();
  await expect(dimentica).toHaveText('Confermi?');
  expect(existsSync(join(userData, 'chiave-feedback.bin')), 'un clic solo non deve bastare').toBe(true);
  await dimentica.click();
  await expect(page.locator('#mgChiaveStato')).toContainText('Non caricata');
  await expect(dimentica).toBeHidden();
  expect(existsSync(join(userData, 'chiave-feedback.bin'))).toBe(false);
  await page.locator('.mg-sezione[data-sezione="feedback"]').click();
  await expect(page.locator('#mgNoSections')).toContainText('Manca la chiave dei feedback');
});

test('senza portachiavi di sistema la chiave non si carica, e l\'avviso dice perché', async ({ app, openTab }) => {
  const { pub, priv } = await coppiaDiProva();
  await bancoDiProva(app, { pub, portachiavi: false });
  const file = join(cartella, 'chiave.txt');
  writeFileSync(file, `${priv}\n`);
  await scegliIlFile(app, file);

  const page = await apriGestione(openTab);
  const avviso = page.locator('#mgNoSections');
  await expect(avviso).toContainText('Manca la chiave dei feedback');
  await expect(avviso).toContainText('in chiaro Filo non la salva');
  // Niente tasto che fallirebbe sempre.
  await expect(avviso.getByRole('button')).toBeHidden();

  // Anche chiesto direttamente, il main rifiuta prima di aprire la finestra di scelta, e non scrive niente.
  const r = await page.evaluate(() => window.filo.message({ type: 'feedback_chiave_carica' }));
  expect(r.ok).toBe(false);
  expect(r.error).toContain('portachiavi');
  expect(await app.evaluate(() => globalThis.__finestreDiScelta)).toBe(0);
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  expect(existsSync(join(userData, 'chiave-feedback.bin'))).toBe(false);
});

test('un file senza la chiave giusta viene rifiutato con il motivo, e la pagina resta com\'era', async ({ app, openTab }) => {
  const { pub } = await coppiaDiProva();
  const altra = await coppiaDiProva();
  await bancoDiProva(app, { pub });
  const file = join(cartella, 'altra.env');
  writeFileSync(file, `FILO_FEEDBACK_PRIVKEY="${altra.priv}"\n`);
  await scegliIlFile(app, file);

  const page = await apriGestione(openTab);
  const avviso = page.locator('#mgNoSections');
  await avviso.getByRole('button', { name: 'Carica la chiave…' }).click();
  await expect(avviso.locator('.sn-chiave-esito')).toContainText('non apre i feedback di Filo');
  await expect(avviso).toBeVisible();
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  expect(existsSync(join(userData, 'chiave-feedback.bin'))).toBe(false);

  // Un file che non c'entra niente: lo dice, senza provare a leggerlo come chiave.
  writeFileSync(file, 'solo testo, niente chiavi\n');
  await avviso.getByRole('button', { name: 'Carica la chiave…' }).click();
  await expect(avviso.locator('.sn-chiave-esito')).toContainText('non c\'è una chiave privata');
});
