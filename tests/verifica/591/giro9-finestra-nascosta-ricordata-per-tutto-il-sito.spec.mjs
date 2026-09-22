// Verifica #591 — giro 9. Il controllo nella finestra nascosta riguarda UN
// indirizzo e viene ricordato per tutto il sito.
//
// Il giro 8 ha stabilito la regola per la consultazione dell'elenco dei siti di
// truffa: la risposta è di un indirizzo, e ricordarla per tutto il sito, dove i
// file sono di persone diverse, copre il file di truffa col «pulito» del vicino
// e viceversa. La regola è arrivata a quella memoria e non a questa: la
// finestra nascosta apre l'indirizzo INTERO, ne segue i salti e ne guarda i
// download — è il controllo più legato all'indirizzo che Filo abbia — e il suo
// esito si ricorda per l'host, mezz'ora, nei due versi.
//
// Logica pura: la finestra nascosta e le chiamate di rete sono finte.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
const SB = require_(join(REPO, 'src/main/services/safebrowse/index.js'));

// Due file di due persone diverse sullo stesso sito di condivisione.
const INNOCUO = 'http://banca-intesa.verify.top/utente-qualunque';
const TRUFFA = 'http://banca-intesa.verify.top/accesso-clienti';

function banco(esito) {
  const aperte = [];
  SB.setProviders({
    gsb: () => Promise.resolve({ hit: false }),
    rdap: () => Promise.resolve(null),
    ct: () => Promise.resolve(null),
    llm: () => Promise.resolve(null),
    sandbox: (url) => { aperte.push(url); return Promise.resolve(esito(url)); },
  });
  for (const c of Object.values(SB._caches)) c.clear();
  for (const s of Object.values(SB._inFlight)) s.clear();
  return aperte;
}

const respira = () => new Promise((r) => setTimeout(r, 120));

test('il file innocuo aperto per primo non deve coprire quello di truffa', async () => {
  const aperte = banco(() => ({ verdict: 'clean' }));
  SB.analyze(INNOCUO, { hasPassword: true }, () => {});
  await respira();
  SB.analyze(TRUFFA, { hasPassword: true }, () => {});
  await respira();
  expect(
    aperte,
    'la finestra nascosta apre l\'indirizzo intero e ne segue i salti: il suo esito è di quell\'indirizzo, '
    + `non di tutto il sito (aperte: ${JSON.stringify(aperte)})`,
  ).toContain(TRUFFA);
});

test('il file di truffa non deve sbarrare gli altri file dello stesso sito', async () => {
  const aperte = banco((url) => (url === TRUFFA ? { verdict: 'dangerous' } : { verdict: 'clean' }));
  SB.analyze(TRUFFA, { hasPassword: true }, () => {});
  await respira();
  const v = SB.checkSync(INNOCUO, { hasPassword: true });
  expect(
    v.level,
    'la pagina rossa a tutto schermo si prende un file che nessuno ha guardato, e ci scrive il nome del sito '
    + 'al posto di quello del file',
  ).not.toBe('pericoloso');
  expect(aperte).toContain(TRUFFA);
});

test('caso di riscontro: lo stesso indirizzo non si apre due volte', async () => {
  const aperte = banco(() => ({ verdict: 'clean' }));
  SB.analyze(TRUFFA, { hasPassword: true }, () => {});
  await respira();
  SB.analyze(TRUFFA, { hasPassword: true }, () => {});
  await respira();
  expect(aperte.filter((u) => u === TRUFFA)).toHaveLength(1);
});
