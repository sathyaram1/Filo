// L'indirizzo di un'azione si legge in UN posto solo.
//
// Il modello scrive l'indirizzo col nome che gli pare (url, href, link,
// indirizzo, pagina) e Filo li accetta tutti. Finché ogni punto teneva il
// proprio elenco, il freno anti-esfiltrazione ne conosceva uno in meno di chi
// eseguiva: bastava chiamare il campo «pagina» perché la richiesta partisse
// senza conferma, portando fuori i dati dell'utente (#553, giro 1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

await import(`file://${join(ROOT, 'src', 'shared', 'urlNav.js')}`);
const NAV = globalThis.SN_URL_NAV;

test('l\'indirizzo si trova comunque il modello abbia chiamato il campo', () => {
  const atteso = 'https://esempio.test/pagina';
  for (const campo of NAV.CAMPI_INDIRIZZO) {
    assert.equal(NAV.indirizzoAzione({ type: 'LEGGI_PAGINA', [campo]: atteso }), atteso);
  }
  assert.equal(NAV.indirizzoAzione({ type: 'LEGGI_PAGINA' }), '');
  assert.equal(NAV.indirizzoAzione({ url: '   ' }), '');
  assert.equal(NAV.indirizzoAzione(null), '');
  assert.equal(NAV.indirizzoAzione({ url: `  ${atteso}  ` }), atteso);
});

test('«pagina» è fra i campi riconosciuti, perché chi esegue lo accetta', () => {
  assert.ok(NAV.CAMPI_INDIRIZZO.includes('pagina'));
  assert.ok(NAV.CAMPI_INDIRIZZO.includes('indirizzo'));
});

// Sentinella: nessuno si riscrive l'elenco a mano. Un secondo elenco diverge
// dal primo senza che nessun test diventi rosso, ed è esattamente così che è
// nata la strada d'uscita senza conferma.
const SORVEGLIATI = [
  join('src', 'main', 'services', 'handlers.js'),
  join('src', 'shared', 'actionLevels.js'),
  join('src', 'pages', 'dashboard', 'dashboard-attivita.js'),
];

const CATENA = /\b(?:a|action)\.url\s*(?:\?\?|\|\|)\s*(?:a|action)\.(?:href|link|indirizzo|pagina)\b/;

test('nessun punto si riscrive a mano l\'elenco dei campi dell\'indirizzo', () => {
  for (const rel of SORVEGLIATI) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    const righe = src.split('\n');
    for (let i = 0; i < righe.length; i++) {
      assert.ok(
        !CATENA.test(righe[i]),
        `${rel}:${i + 1} legge l'indirizzo con un elenco suo: usa SN_URL_NAV.indirizzoAzione`,
      );
    }
  }
});

// Chi descrive un'azione nel popup di conferma chiede l'indirizzo a urlNav. Se
// il caricatore lo mettesse dopo, la conferma mostrerebbe «una pagina» invece
// dell'indirizzo, e l'utente confermerebbe alla cieca.
test('il caricatore mette urlNav prima di actionLevels', () => {
  const src = readFileSync(join(ROOT, 'src', 'main', 'services', 'loader.js'), 'utf8');
  const nav = src.indexOf('urlNav.js');
  const liv = src.indexOf('actionLevels.js');
  assert.ok(nav >= 0 && liv >= 0, 'il caricatore deve caricarli entrambi');
  assert.ok(nav < liv, 'urlNav.js va caricato prima di actionLevels.js');
});
