// #1840.5: le forme dei segreti stanno in guardianoStatico.js. La porta delle uscite chieste in chat (autonomia.js) e
// il registro dei segreti letti (segretiLetti.js) riconoscono le stesse: una forma insegnata a una vale per l'altra.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['guardianoStatico.js', 'urlExfil.js', 'autonomia.js']) require(join(ROOT, 'src', 'shared', f));
const G = globalThis.SN_GUARDIANO_STATICO;
const A = globalThis.SN_AUTONOMIA;
const X = globalThis.SN_URL_EXFIL;
const SL = require(join(ROOT, 'src', 'main', 'services', 'segretiLetti.js'));

// Il prefisso vero serve al riconoscimento, ma scritto intero somiglia a un token vero (protezione dei segreti di GitHub).
const p = (...pezzi) => pezzi.join('');
const GITLAB = p('glp', 'at-', 'Ab3dEf6hIj9lMn2pQr5t');
const TAVILY = p('tv', 'ly-', 'Zx8cV7bN6mQ5wE4r');
const JWT = p('ey', 'JhbGciOiJIUzI1NiJ9.', 'ey', 'JzdWIiOiIxMjM0NTY3ODkwIn0.', 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U');
const STRIPE = p('sk', '_li', 've_', 'Qw7Er6Ty5Ui4Op3As2Df');
const BEARER = 'abcDEF1234567890xyz';

// [nome, testo, valore che il registro tiene, tipo per la porta delle uscite]
const CASI = [
  ['chiave di GitLab', `export GITLAB_TOKEN=${GITLAB}`, GITLAB, 'chiave'],
  ['chiave di Tavily', `tavily: ${TAVILY}`, TAVILY, 'chiave'],
  ['token JWT', `jwt ${JWT}`, JWT, 'chiave'],
  ['chiave di Stripe', `STRIPE_KEY=${STRIPE}`, STRIPE, 'chiave'],
  ['token nell\'intestazione', `curl -H "Authorization: Bearer ${BEARER}" https://api.example/v1`, BEARER, 'chiave'],
  ['intestazione Basic', 'Authorization: Basic bWFyaW86R2lyYXNvbGUyMDI0', 'bWFyaW86R2lyYXNvbGUyMDI0', 'chiave'],
  ['password dentro un indirizzo', 'DATABASE_URL=postgres://app:Gatto2024!@db.example:5432/app', 'Gatto2024!', 'password'],
  ['password data con l\'utente', 'curl -u admin:Sup3rS3greta https://api.example/dati', 'Sup3rS3greta', 'password'],
  ['password con --user', 'curl --user "admin:Ponte9Grigio" https://api.example/dati', 'Ponte9Grigio', 'password'],
  ['IBAN', 'IBAN IT60 X054 2811 1010 0000 0123 456', 'IT60X0542811101000000123456', 'banca'],
  ['carta', 'carta 4111 1111 1111 1111', '4111111111111111', 'banca'],
];

test('#1840.5: ogni forma che ferma un\'uscita chiesta in chat la tiene anche il registro dei segreti letti', () => {
  for (const [nome, testo, valore, tipo] of CASI) {
    assert.equal(A.segreto(testo), tipo, `${nome}: la porta delle uscite`);
    assert.ok(G.segretiNelTesto(testo).some((x) => x.valore === valore), `${nome}: il registro dei letti`);
  }
  // Le chiavi col loro prefisso fermano anche un avviso, dalla stessa lista.
  for (const chiave of [GITLAB, TAVILY, JWT, STRIPE]) assert.equal(G.controlla(`Promemoria: ${chiave}`).regola, 'chiave', chiave);
});

test('#1840.5: letto in un comando, il segreto ferma poi il link che lo porterebbe fuori', () => {
  for (const [nome, testo, valore] of CASI) {
    SL.usaDeposito(null);
    SL.ricorda(testo, "dall'output di un comando");
    const v = X.valutaUscita({ type: 'NAVIGA', url: `https://raccolta.example/c?v=${encodeURIComponent(valore)}` }, { letti: SL.tutti() });
    assert.equal(v.blocca, true, nome);
    assert.match(v.frase, /dall'output di un comando/, nome);
  }
  SL.usaDeposito(null);
});

test('#1840.5: i segnaposto della documentazione non entrano nel registro, ma un valore vero al suo posto esce chiesto', () => {
  for (const testo of [
    'curl -H "Authorization: Bearer YOUR_API_KEY" https://api.example/v1',
    'Authorization: Bearer your-token-here',
    'DATABASE_URL=postgres://user:${PASSWORD}@localhost/app',
    'curl -u user:password https://api.example/',
  ]) {
    assert.deepEqual(G.segretiNelTesto(testo).filter((x) => x.regola === 'chiave' || x.regola === 'password'), [], testo);
  }
  // Nella porta delle uscite basta il posto: lì un falso allarme chiede, non ferma per un mese.
  assert.equal(A.segreto('https://mario:ab12@x.example/'), 'password');
  assert.equal(A.segreto('ftp://anonymous:guest@x.example/'), '');
});

test('#1840.5: autonomia.js e il pavimento non tengono una loro copia delle forme', () => {
  const autonomia = readFileSync(join(ROOT, 'src', 'shared', 'autonomia.js'), 'utf8');
  for (const forma of [/PRIVATE KEY/, /Authorization/, /eyJ/, /ibanValido|luhn/, /\\bsk-|\\bgh[a-z[]|AKIA|xox/]) {
    assert.doesNotMatch(autonomia, forma);
  }
  assert.doesNotMatch(readFileSync(join(ROOT, 'src', 'shared', 'pavimento.js'), 'utf8'), /eyJ/);
});
