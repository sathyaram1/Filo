// Verifica #2646, giro 1, rilievo 1: un proxy della forma degli elenchi con l'utente che è un indirizzo email, o con
// un indirizzo IPv6, deve collegarsi con la sua password e tenerla fuori dall'archivio e dalle uscite. Niente Filo aperto.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = resolve(process.cwd());
globalThis.self = globalThis;
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'guardianoStatico.js'));
const { buildExportZip, readExportZip } = require(join(ROOT, 'src', 'main', 'services', 'exportData.js'));
const proxyTab = require(join(ROOT, 'src', 'main', 'services', 'proxyTab.js'));
const { custoditi } = require(join(ROOT, 'src', 'main', 'services', 'segretiCustoditi.js'));

const PASSWORD = 'FintaElencoInsolito77q';
const CASI = [
  ['utente email', `gate.fornitore.example:8080:mario@posta.example:${PASSWORD}`, 'mario@posta.example', 'http://gate.fornitore.example:8080'],
  ['host IPv6', `[2001:db8::1]:8080:mario:${PASSWORD}`, 'mario', 'http://[2001:db8::1]:8080'],
  ['CONTROLLO', `gate.fornitore.example:8080:mario:${PASSWORD}`, 'mario', 'http://gate.fornitore.example:8080'],
];

for (const [nome, proxy, utente, regole] of CASI) {
  test(`r1 ${nome}: il proxy si collega con utente e password`, () => {
    const r = proxyTab.resolve('us', { settings: { proxy: { datacenter: proxy } }, env: {} });
    expect(r, 'Filo non sa leggere l\'indirizzo del proxy').not.toBeNull();
    expect(r.proxyRules).toBe(regole);
    expect(r.auth).toEqual({ username: utente, password: PASSWORD });
  });

  test(`r1 ${nome}: senza la spunta la password non esce dall'archivio`, async () => {
    const dati = { settings: { proxy: { datacenter: proxy } }, note: { testo: `la password è ${PASSWORD}` } };
    let zip = buildExportZip(dati, {});
    if (zip && typeof zip.then === 'function') zip = await zip;
    let letto = readExportZip(zip);
    if (letto && typeof letto.then === 'function') letto = await letto;
    expect(JSON.stringify(letto.data)).not.toContain(PASSWORD);
  });

  test(`r1 ${nome}: la password è fra i segreti custoditi`, () => {
    const lista = custoditi({ impostazioni: [{ proxy: { datacenter: proxy } }], env: {} }).map((x) => x.valore);
    expect(lista).toContain(PASSWORD);
  });
}
