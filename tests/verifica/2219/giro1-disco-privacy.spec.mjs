// Verifica #2219 giro 1: in Privacy il nome di un sito non fidato che ha mostrato una password non resta in
// storage.json; quello di un sito fidato sì; la Sicurezza li vede tutti nella sessione.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

test.use({ hostInPiu: ['online.banca-prova.example', 'accesso.banca-prova.example', 'negozio-prova.example'] });

let server;
let port;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>accesso</title><form><input name="u"><input type="password" name="p"></form>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

test.afterAll(async () => {
  try { server.closeAllConnections?.(); } catch (_) {}
  await new Promise((r) => server.close(r));
});

const su = (host) => `http://${host}:${port}/accedi`;

async function cookies(app, shell, mode, trustedSites = []) {
  await shell.evaluate(([m, t]) => window.filoShell.message({
    type: 'update_settings', settings: { security: { cookies: { mode: m, trustedSites: t } } },
  }), [mode, trustedSites]);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find((w) => w._filoTabs)?._filoTabs.cookieMode), { timeout: 5000 }).toBe(mode);
}

// Il file vero sul disco, dopo che lo storage ha finito di scrivere: non la copia in memoria.
const sulDisco = (app) => app.evaluate(async () => {
  await globalThis.__filoStorage.whenSettled();
  const fs = process.getBuiltinModule('fs');
  const path = process.getBuiltinModule('path');
  const leggi = (f) => { try { return fs.readFileSync(path.join(process.env.FILO_USER_DATA, f), 'utf8'); } catch (_) { return ''; } };
  return { file: leggi('storage.json'), copia: leggi('storage.json.bak') };
});
const inSicurezza = (app) => app.evaluate(() => globalThis.SN_DELICATE.elencoCampi());

async function accedi(app, shell, host) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), su(host));
  await expect.poll(() => inSicurezza(app), { timeout: 10_000 }).toContain(host.split('.').slice(-2).join('.'));
}

test('lo scenario della segnalazione: accesso su 127.0.0.1 e localhost in Privacy, nessuno dei due nomi sul disco', async ({ app, shell }) => {
  await cookies(app, shell, 'privacy');
  await accedi(app, shell, '127.0.0.1');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), su('localhost'));
  await expect.poll(() => inSicurezza(app), { timeout: 10_000 }).toEqual(expect.arrayContaining(['127.0.0.1', 'localhost']));
  const { file, copia } = await sulDisco(app);
  expect(file.length).toBeGreaterThan(0);
  expect(file).not.toContain('127.0.0.1');
  expect(file).not.toMatch(/"localhost"/);
  expect(copia).not.toContain('127.0.0.1');
});

test('fidato con un sottodominio scritto nell\'elenco: il sito resta sul disco; il non fidato no', async ({ app, shell }) => {
  await cookies(app, shell, 'privacy', ['accesso.banca-prova.example']);
  await accedi(app, shell, 'online.banca-prova.example');
  await accedi(app, shell, 'negozio-prova.example');
  const { file } = await sulDisco(app);
  expect(file).toContain('banca-prova.example');
  expect(file).not.toContain('negozio-prova.example');
});

test('lista scritta in modalità normale: accesa la Privacy, i non fidati lasciano il disco e il fidato resta', async ({ app, shell }) => {
  await cookies(app, shell, 'default');
  await accedi(app, shell, 'negozio-prova.example');
  await accedi(app, shell, 'online.banca-prova.example');
  let { file } = await sulDisco(app);
  expect(file, 'in modalità normale il ricordo va sul disco').toContain('negozio-prova.example');

  await cookies(app, shell, 'privacy', ['banca-prova.example']);
  await expect.poll(async () => (await sulDisco(app)).file, { timeout: 5000 }).not.toContain('negozio-prova.example');
  ({ file } = await sulDisco(app));
  expect(file).toContain('banca-prova.example');
  expect(await inSicurezza(app), 'la Sicurezza li vede ancora nella sessione').toEqual(expect.arrayContaining(['negozio-prova.example', 'banca-prova.example']));

  // Tolta la fiducia dalla Sicurezza, anche il fidato lascia il disco.
  await cookies(app, shell, 'privacy', []);
  await expect.poll(async () => (await sulDisco(app)).file, { timeout: 5000 }).not.toContain('banca-prova.example');
});

test('un backup importato con siti non fidati in Privacy: i loro nomi non tornano sul disco', async ({ app, shell }) => {
  await cookies(app, shell, 'privacy', ['banca-prova.example']);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.setRaw(globalThis.SN_CONST.STORAGE_KEYS.SITI_CON_CAMPI, ['banca-prova.example', 'negozio-prova.example']);
    await globalThis.SN_DELICATE.rileggi();
  });
  await expect.poll(async () => (await sulDisco(app)).file, { timeout: 5000 }).not.toContain('negozio-prova.example');
  expect((await sulDisco(app)).file).toContain('banca-prova.example');
});
