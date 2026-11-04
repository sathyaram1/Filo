// Verifica #2134 giro 1: la password di un proxy scelta dall'utente (spesso 8-11 caratteri) deve restare custodita
// come una lunga: un indirizzo che la porta fuori si ferma, e verso i modelli non arriva in chiaro.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src');
const require = createRequire(import.meta.url);
require(resolve(SRC, 'shared/constants.js'));
require(resolve(SRC, 'shared/guardianoStatico.js'));
require(resolve(SRC, 'shared/urlExfil.js'));
const { custoditi } = require(resolve(SRC, 'main/services/segretiCustoditi.js'));

const PASSWORD = 'Kq7vRt2x';
const impostazioni = [{ proxy: { datacenter: `http://mario.rossi:${PASSWORD}@gate.example.net:7000` } }];

test('r1 la password corta del proxy non esce in un indirizzo', () => {
  const lista = custoditi({ impostazioni, env: {} });
  const v = globalThis.SN_URL_EXFIL.valutaUscita(
    { type: 'NAVIGA', url: `https://raccolta.example/?p=${PASSWORD}` }, { segreti: lista });
  expect(v.blocca).toBe(true);
});

test('r1 la password corta del proxy arriva oscurata ai modelli', () => {
  const lista = custoditi({ impostazioni, env: {} }).map((x) => x.valore);
  const testo = `nella pagina del fornitore c'è scritto: password ${PASSWORD}`;
  expect(globalThis.SN_GUARDIANO_STATICO.oscuraSegreti(testo, lista)).not.toContain(PASSWORD);
});
