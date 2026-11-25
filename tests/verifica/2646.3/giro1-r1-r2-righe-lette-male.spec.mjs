// Verifica #2646.3, giro 1: una riga del proxy in una grafia insolita non deve lasciare la password scoperta,
// né nell'esportazione senza spunta né fra i segreti custoditi né sul disco. Logica pura: non apre Electron.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
globalThis.self = globalThis;
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'guardianoStatico.js'));
const { buildExportZip, unzip } = require(join(ROOT, 'src', 'main', 'services', 'exportData.js'));
const { custoditi } = require(join(ROOT, 'src', 'main', 'services', 'segretiCustoditi.js'));
const C = globalThis.SN_CONST;

const PASSWORD = 'FintaPasswordProxy9x7q';

function controlla(riga) {
  const dati = { settings: { proxy: { datacenter: riga } }, clipboardHistory: [{ id: 'c1', type: 'text', text: `il proxy è ${riga}` }] };
  const zip = buildExportZip(dati, { chiavi: false });
  const testo = [...unzip(zip).voci.values()].map((b) => b.toString('utf8')).join('\n');
  const valori = custoditi({ impostazioni: [{ proxy: { datacenter: riga } }], env: {} }).map((x) => x.valore);
  return {
    esportata: testo.includes(PASSWORD),
    custodita: valori.includes(PASSWORD),
    cifrataSulDisco: C.percorsiSegreti({ proxy: { datacenter: riga } }).length > 0,
  };
}

const ATTESO = { esportata: false, custodita: true, cifrataSulDisco: true };

for (const [nome, riga] of [
  ['utente con la barra, con lo schema', `http://ma/rio:${PASSWORD}@gate.fornitore.example:7000`],
  ['utente col punto di domanda, con lo schema', `socks5://ma?rio:${PASSWORD}@gate.fornitore.example:7000`],
  ['password che comincia con cifre e una barra', `http://mario:1234/${PASSWORD}@gate.fornitore.example:7000`],
  ['password che comincia con cifre e un cancelletto', `http://mario:2024#${PASSWORD}@gate.fornitore.example:7000`],
  ['elenco separato da punti e virgola', `gate.fornitore.example;7000;mario;${PASSWORD}`],
  ['elenco separato da virgole', `gate.fornitore.example,7000,mario,${PASSWORD}`],
  ['elenco separato da tabulazioni', `gate.fornitore.example\t7000\tmario\t${PASSWORD}`],
]) {
  test(`r1 ${nome}: la password resta custodita`, () => {
    expect(controlla(riga)).toEqual(ATTESO);
  });
}

for (const [nome, riga] of [
  ['elenco utente:password:host:porta', `mario:${PASSWORD}:gate.fornitore.example:7000`],
  ['IPv6 senza quadre dopo la @', `mario:${PASSWORD}@2001:db8::1:8080`],
  ['elenco separato da spazi', `gate.fornitore.example 7000 mario ${PASSWORD}`],
]) {
  test(`r2 ${nome}: la password da sola è fra i custoditi`, () => {
    expect(controlla(riga)).toEqual(ATTESO);
  });
}
