// Sentinella #2067: un Filo aperto con le variabili delle prove non parla col progetto Firebase vero. Nessun account anonimo
// (identitytoolkit), nessun rinnovo, nessuna callable dei crediti: a ogni corsa della suite erano migliaia di account.
// Il testimone (tests/helpers/registroRete.cjs) sta sotto il fetch dell'app; la regola in src/main/test-servizi-chiusi.js.

import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/electron.mjs';

const require = createRequire(import.meta.url);
const QUI = dirname(fileURLToPath(import.meta.url));
const { firebaseProjectId } = require(join(QUI, '..', 'src', 'main', 'auth', 'config.js'));
// Fra virgolette e con le barre normali: NODE_OPTIONS spezza sugli spazi e dentro le virgolette mangia le barre rovesce.
const TESTIMONE = join(QUI, 'helpers', 'registroRete.cjs').replace(/\\/g, '/');

const HOST_DEL_PROGETTO = ['identitytoolkit.googleapis.com', 'securetoken.googleapis.com', 'firestore.googleapis.com', 'firebasestorage.googleapis.com'];
function delProgetto(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch (_) { return false; }
  return HOST_DEL_PROGETTO.includes(host) || host.endsWith(`-${firebaseProjectId}.cloudfunctions.net`);
}

const registro = (testInfo) => testInfo.outputPath('rete.txt');
const righe = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);

// Un registro per tentativo: un nuovo giro dopo un rosso non rilegge le righe del precedente.
function conTestimone(extra = {}) {
  return async ({}, use, testInfo) => {
    await use({ NODE_OPTIONS: `--require "${TESTIMONE}"`, FILO_TEST_REGISTRO_RETE: registro(testInfo), ...extra });
  };
}

// La lettura dei crediti dell'avvio è passata (parte 4 s dopo, poi l'invito in attesa, segnato subito prima della sua
// callable); poi se ne chiede un'altra, come fa la pagina Crediti, e se ne torna lo stato.
async function dopoLAvvioDelPortafoglio(app) {
  await expect.poll(() => app.evaluate(async () => Boolean(await globalThis.SN_STORAGE.getRaw('walletPendingInvite', null))),
    { message: 'la lettura dei crediti dell\'avvio non è partita', timeout: 30_000 }).toBe(true);
  return app.evaluate(() => globalThis.SN_WALLET_MAIN.readState());
}

test.describe('con le sole variabili delle prove', () => {
  // Vuote valgono come assenti: l'app prende gli indirizzi veri, quelli che usano le altre seicento prove.
  test.use({ envInPiu: conTestimone({ FILO_FUNCTIONS_BASE: '', FILO_IDENTITY_ENDPOINT: '', FILO_SECURE_TOKEN_ENDPOINT: '' }) });

  test('all\'avvio Filo non crea un account anonimo e non chiama le callable del progetto vero', async ({ app, testServer }, testInfo) => {
    const prova = testServer.html('<p>testimone</p>');
    expect(await app.evaluate(async (_e, u) => (await fetch(u)).status, prova)).toBe(200);
    await expect.poll(() => righe(registro(testInfo)).some((u) => u.startsWith(prova)),
      { message: 'il testimone non registra le richieste del main: la prova non vedrebbe niente' }).toBe(true);

    const stato = await dopoLAvvioDelPortafoglio(app);
    expect(stato.identity.ok, 'l\'identità anonima non deve nascere sul progetto vero').toBe(false);
    expect(stato.identity.offline).toBe(true);
    expect(righe(registro(testInfo)).filter(delProgetto)).toEqual([]);
  });
});

test.describe('con l\'identità finta e le callable lasciate al progetto vero', () => {
  let server;
  let base = '';
  const visti = [];
  test.beforeAll(async () => {
    server = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        const url = req.url.split('?')[0];
        visti.push(url);
        res.writeHead(url === '/accounts:signUp' || url === '/token' ? 200 : 404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(url === '/token'
          ? { id_token: 'anon-id', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid' }
          : { idToken: 'anon-id', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid' }));
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  test.afterAll(async () => { await new Promise((r) => server.close(r)); });
  test.use({
    envInPiu: async ({}, use, testInfo) => conTestimone({
      FILO_FUNCTIONS_BASE: '', FILO_IDENTITY_ENDPOINT: `${base}/accounts:signUp`, FILO_SECURE_TOKEN_ENDPOINT: `${base}/token`,
    })({}, use, testInfo),
  });

  test('la callable dei crediti verso il progetto vero non parte: per Filo il server non risponde', async ({ app }, testInfo) => {
    const stato = await dopoLAvvioDelPortafoglio(app);
    expect(stato.identity.ok, 'l\'identità finta deve bastare a far partire la callable').toBe(true);
    expect(visti).toContain('/accounts:signUp');
    expect(righe(registro(testInfo)).some((u) => u === `${base}/accounts:signUp`), 'il testimone vede l\'identità finta').toBe(true);
    expect(stato.error).toBe('not_reachable');
    expect(righe(registro(testInfo)).filter(delProgetto)).toEqual([]);
  });
});
