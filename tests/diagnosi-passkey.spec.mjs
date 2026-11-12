// #1608 — La diagnostica delle passkey accesa da chi lancia Filo: l'accesso con la passkey riesce ancora, e il registro
// nella cartella dati dice cosa ha chiesto la pagina, con hybrid aggiunto ai trasporti in «ibrido», e com'è finita.
// L'autenticatore è quello virtuale di Chromium: il cammino di Windows verso il telefono da qui non si prova.

import { test, expect } from './fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const VARIABILE = 'FILO_DIAGNOSI_PASSKEY';
let prima;
// L'ambiente del worker passa anche agli spec dopo: si accende qui e si spegne alla fine.
test.beforeAll(() => { prima = process.env[VARIABILE]; process.env[VARIABILE] = 'ibrido'; });
test.afterAll(() => { if (prima === undefined) delete process.env[VARIABILE]; else process.env[VARIABILE] = prima; });

const PAGINA = `<!doctype html><meta charset="utf-8"><title>Accesso</title><body>Accedi</body>`;

// WebAuthn vuole un nome di dominio come rpId e un contesto sicuro: localhost li ha tutti e due.
async function apriSuLocalhost(testServer, openTab) {
  const url = testServer.html(PAGINA).replace('127.0.0.1', 'localhost');
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  return { page, url };
}

// Un autenticatore della piattaforma con una passkey per localhost, dentro la scheda.
async function passkeyNellaScheda(app, url) {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const id = randomBytes(16);
  await app.evaluate(async ({ webContents }, { u, chiave, credId }) => {
    const wc = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL() === u);
    wc.debugger.attach('1.3');
    await wc.debugger.sendCommand('WebAuthn.enable', { enableUI: false });
    const { authenticatorId } = await wc.debugger.sendCommand('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    } });
    await wc.debugger.sendCommand('WebAuthn.addCredential', { authenticatorId, credential: {
      credentialId: credId, isResidentCredential: false, rpId: 'localhost', privateKey: chiave, signCount: 0,
    } });
  }, { u: url, chiave: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'), credId: id.toString('base64') });
  return id.toString('base64');
}

const accedi = (page, credId, trasporti, timeout = 8000) => page.evaluate(async ({ c, t, ms }) => {
  const id = Uint8Array.from(atob(c), (x) => x.charCodeAt(0));
  try {
    const r = await navigator.credentials.get({ publicKey: { challenge: new Uint8Array(32), rpId: 'localhost', timeout: ms,
      userVerification: 'preferred', allowCredentials: [{ type: 'public-key', id, transports: t }] } });
    return `ok ${r.type} ${r.authenticatorAttachment}`;
  } catch (e) { return `errore ${e.name}`; }
}, { c: credId, t: trasporti, ms: timeout });

async function righe(app) {
  const dir = await app.evaluate(({ app: a }) => a.getPath('userData'));
  try { return readFileSync(join(dir, 'diagnosi-passkey.log'), 'utf8').trim().split('\n').map((r) => JSON.parse(r)); } catch (_) { return []; }
}

test('accesa: la passkey entra, e il registro riassume la richiesta col trasporto aggiunto, senza id', async ({ app, testServer, openTab }) => {
  const { page, url } = await apriSuLocalhost(testServer, openTab);
  const credId = await passkeyNellaScheda(app, url);

  expect(await accedi(page, credId, ['internal'])).toBe('ok public-key platform');

  await expect.poll(async () => (await righe(app)).filter((r) => r.tipo === 'get').length, { timeout: 5000 }).toBe(1);
  const tutte = await righe(app);
  const [testa] = tutte;
  expect(testa).toMatchObject({ avvio: true, modo: 'ibrido', sistema: process.platform });
  expect(testa.filo).toMatch(/^\d+\.\d+\.\d+/);
  const rec = tutte.find((r) => r.tipo === 'get');
  expect(rec).toMatchObject({
    pagina: new URL(url).origin + new URL(url).pathname, principale: true, sessionePersistente: true,
    rpId: 'localhost', verifica: 'preferred', quante: 1, esito: 'ok', usato: 'platform',
    credenziali: [{ lunghezzaId: 16, trasporti: ['internal', 'hybrid'], aggiunto: true }],
  });
  expect(JSON.stringify(tutte)).not.toContain(credId);
});

test('accesa: una passkey che non c\'è finisce nel registro col nome dell\'errore, e la pagina riceve il no', async ({ app, testServer, openTab }) => {
  const { page, url } = await apriSuLocalhost(testServer, openTab);
  await passkeyNellaScheda(app, url);
  const altra = randomBytes(32).toString('base64');

  expect(await accedi(page, altra, ['usb'], 1500)).toBe('errore NotAllowedError');

  await expect.poll(async () => (await righe(app)).find((r) => r.tipo === 'get')?.esito, { timeout: 8000 }).toBe('errore');
  const rec = (await righe(app)).find((r) => r.tipo === 'get');
  expect(rec).toMatchObject({ errore: 'NotAllowedError', credenziali: [{ lunghezzaId: 32, trasporti: ['usb', 'hybrid'], aggiunto: true }] });
});
