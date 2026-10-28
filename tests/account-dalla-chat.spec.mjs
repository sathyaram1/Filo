// #1615 — «accedi con Google» chiesto alla chat della home lo fa Filo: apre la stessa pagina d'accesso del menu
// dell'account, e scelto l'account sei dentro. Collegare Google nelle schede e uscire passano dalla stessa azione.
// Le pagine di Google sono finte (tests/helpers/googleFinto.mjs): il login gira davvero fino a Firebase finto.

import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello } from './helpers/chatFinta.mjs';
import { googleFinto, risposteFinte, schedeSu, indirizzoDellAccesso, rispondiAlLoopback } from './helpers/googleFinto.mjs';

const EMAIL = 'chi.accede@prova.test';

async function preparaLogin(app, testServer) {
  const pagina = await googleFinto(app, testServer);
  await risposteFinte(app, EMAIL);
  await app.evaluate(({ safeStorage }) => {
    safeStorage.isEncryptionAvailable = () => true;
    safeStorage.encryptString = (s) => Buffer.from(String(s), 'utf8');
    safeStorage.decryptString = (b) => Buffer.from(b).toString('utf8');
  });
  return pagina;
}

const esegui = (app, action) => app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), action);
const stato = (shell) => shell.evaluate(() => window.filoShell.auth.status());

// Google nelle schede collegato o no, come lo direbbero i cookie di Google (che le pagine finte non lasciano).
const googleNelleSchede = (app, si) => app.evaluate((_e, si) => {
  const M = process.getBuiltinModule('module');
  const k = Object.keys(M._cache).find((x) => /services[\\/]accessoGoogle\.js$/.test(x));
  M._cache[k].exports.collegatoNelleSchede = async () => si;
}, si);

async function entra(app, shell, pagina) {
  const r = await esegui(app, { type: 'ACCOUNT', cosa: 'accedi' });
  expect(r.executed).toBe(true);
  const url = await indirizzoDellAccesso(app, pagina);
  expect(url, 'l\'accesso deve aprirsi in una scheda').toBeTruthy();
  await rispondiAlLoopback(url);
  await expect.poll(async () => (await stato(shell)).signedIn, { timeout: 10_000 }).toBe(true);
}

test('«accedi con Google» in chat: Filo apre la pagina d\'accesso e, scelto l\'account, sei dentro', async ({ app, shell, testServer }) => {
  test.setTimeout(60_000);
  const pagina = await preparaLogin(app, testServer);
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'a1', name: 'ACCOUNT', arguments: JSON.stringify({ cosa: 'accedi' }) }] },
    { text: 'Ti ho aperto l\'accesso con Google: scegli l\'account.' },
  ]);
  await chiedi(page, 'si un accesso più veloce, accedi con Google');

  const url = await indirizzoDellAccesso(app, pagina);
  expect(url, 'la chat deve aprire la pagina d\'accesso, non spiegare il menu').toBeTruthy();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ti ho aperto l\'accesso con Google' })).toBeVisible({ timeout: 10_000 });
  const esito = JSON.stringify((await chiamateAlModello(app)).at(-1));
  expect(esito).toContain('Aperta in una scheda la pagina d\'accesso di Google');

  await rispondiAlLoopback(url);
  await expect.poll(async () => (await stato(shell)).signedIn, { timeout: 10_000 }).toBe(true);
  expect((await stato(shell)).profile.email).toBe(EMAIL);
  // Il bottone dell'account è quello di un accesso fatto dal menu.
  const bottone = shell.locator('#nav-account');
  await expect(bottone).toHaveClass(/signed-in/);
  await expect(bottone).toHaveAttribute('data-tip', new RegExp(EMAIL.replace(/\./g, '\\.')));
});

test('già dentro: «accedi» non riapre niente se Google è collegato, e apre il collegamento con l\'email se non lo è', async ({ app, shell, testServer }) => {
  test.setTimeout(60_000);
  const pagina = await preparaLogin(app, testServer);
  await entra(app, shell, pagina);
  await expect.poll(() => schedeSu(app, pagina).then((s) => s.length), { timeout: 10_000 }).toBe(0);

  await googleNelleSchede(app, true);
  const gia = await esegui(app, { type: 'ACCOUNT', cosa: 'accedi' });
  expect(gia.executed).toBe(true);
  expect(gia.output.gia).toBe('dentro');
  const giaCollegato = await esegui(app, { type: 'ACCOUNT', cosa: 'collega_google' });
  expect(giaCollegato.output.gia).toBe('collegato');
  await shell.waitForTimeout(800);
  expect(await schedeSu(app, pagina)).toHaveLength(0);

  // YouTube e Gmail scollegati: chi chiede di entrare li ritrova col collegamento, l'email già scritta.
  await googleNelleSchede(app, false);
  const collega = await esegui(app, { type: 'ACCOUNT', cosa: 'accedi' });
  expect(collega.executed).toBe(true);
  expect(collega.output.voce).toBe('collega_google');
  const url = await indirizzoDellAccesso(app, pagina);
  expect(url).toBeTruthy();
  expect(new URL(url).searchParams.get('Email')).toBe(EMAIL);
});

test('«esci» esce dall\'account e il bottone torna «Accedi»; un secondo «esci» dice che eri fuori, e «accedi» riapre l\'accesso', async ({ app, shell, testServer }) => {
  test.setTimeout(60_000);
  const pagina = await preparaLogin(app, testServer);
  await entra(app, shell, pagina);

  const esci = await esegui(app, { type: 'ACCOUNT', cosa: 'esci' });
  expect(esci.executed).toBe(true);
  expect(esci.output.voce).toBe('esci');
  // Detto «uscito», lo è già: un «accedi» chiesto subito dopo non trova la sessione vecchia.
  expect((await stato(shell)).signedIn).toBe(false);
  await expect(shell.locator('#nav-account')).not.toHaveClass(/signed-in/);

  const ancora = await esegui(app, { type: 'ACCOUNT', cosa: 'esci' });
  expect(ancora.executed).toBe(true);
  expect(ancora.output.gia).toBe('fuori');

  const rientra = await esegui(app, { type: 'ACCOUNT', cosa: 'accedi' });
  expect(rientra.output.voce).toBe('accedi');
  expect(await indirizzoDellAccesso(app, pagina)).toBeTruthy();
});

test('chiesto due volte mentre la pagina d\'accesso aspetta: resta una scheda sola, riportata davanti', async ({ app, shell, testServer, openTab }) => {
  test.setTimeout(60_000);
  const pagina = await preparaLogin(app, testServer);
  // Un'operazione che l'account non ha non apre niente.
  expect((await esegui(app, { type: 'ACCOUNT', cosa: 'cancella' })).executed).toBe(false);
  await shell.waitForTimeout(500);
  expect(await schedeSu(app, pagina)).toHaveLength(0);

  expect((await esegui(app, { type: 'ACCOUNT', cosa: 'accedi' })).executed).toBe(true);
  expect(await indirizzoDellAccesso(app, pagina)).toBeTruthy();
  await openTab('filo://editor/editor.html');
  await expect.poll(async () => (await schedeSu(app, pagina))[0]?.attiva).toBe(false);

  expect((await esegui(app, { type: 'ACCOUNT', cosa: 'accedi' })).executed).toBe(true);
  await expect.poll(async () => (await schedeSu(app, pagina))[0]?.attiva, { timeout: 8_000 }).toBe(true);
  expect(await schedeSu(app, pagina)).toHaveLength(1);
});
