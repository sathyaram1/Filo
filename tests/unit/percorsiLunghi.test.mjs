// Un percorso condiviso con campi lunghissimi non ferma l'Aiuto (#1173): la pulizia costa quanto quello che ne resta,
// dà lo stesso testo delle espressioni che ha sostituito, e il taglio prima della pulizia non lascia mezza email.
// Regola nel codice: src/shared/pathsSafety.js (redigiEmail, tagliaPrimaDiPulire).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { costoInUnita } from '../helpers/tempoRelativo.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'constants.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'pathsSafety.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'paths.js'));
const Safety = globalThis.SN_PATHS_SAFETY;
const I = Safety._internal;
const P = globalThis.SN_PATHS;
const { MAX_SELECTOR_LEN, MAX_INTENT_LEN, MAX_URL_LEN } = Safety.LIMITI;
const FORMA_MAX = I.FORMA_MAX || 320;
const tettoDi = (max) => max * 2 + FORMA_MAX;

function fsDoc(id, { initialUrl, intent, steps }) {
  const s = (v) => ({ stringValue: v });
  return {
    document: {
      name: `projects/x/databases/(default)/documents/paths/esempio.it/entries/${id}`,
      fields: {
        initialUrl: s(initialUrl), intent: s(intent), success: { booleanValue: true },
        steps: { arrayValue: { values: steps.map((p) => ({ mapValue: { fields: { selector: s(p.selector), action: s('click') } } })) } },
      },
    },
  };
}

test('#1173 trenta passi da trentamila caratteri: l’Aiuto su quel sito parte subito, e i percorsi ci sono', async () => {
  const forme = ['a', '1.', 'x@', 'Ab1'];
  const lungo = fsDoc('lungo', {
    initialUrl: '/' + 'a'.repeat(30_000),
    intent: 'aprire le fatture' + '"'.repeat(30_000) + '.',
    steps: Array.from({ length: 30 }, (_, i) => ({ selector: `#passo${i} ` + forme[i % 4].repeat(30_000) })),
  });
  const normale = fsDoc('normale', { initialUrl: '/account', intent: 'disdire l’abbonamento', steps: [{ selector: '#menu' }, { selector: '.disdici' }] });
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [lungo, normale] });
  let righe;
  try {
    P._internal.svuotaCache();
    righe = await P.listByDomain('esempio.it', { onlySuccess: true });
  } finally { globalThis.fetch = orig; }
  assert.equal(righe.length, 2);

  let prompt = '';
  const c = costoInUnita(() => { prompt = Safety.formatKnownPathsForPrompt(righe); }, { tetto: 10, giri: 3 });
  assert.ok(c.entro, c.come);
  assert.match(prompt, /## "aprire le fatture/);
  assert.match(prompt, /## "disdire l’abbonamento" \(da \/account\)/);
  assert.match(prompt, /1\. click su #passo0 a+/);
  for (const riga of prompt.split('\n').filter((r) => / click su /.test(r))) {
    assert.ok(riga.length <= MAX_SELECTOR_LEN + 40, `un passo resta nel suo tetto: ${riga.length}`);
  }
});

test('#1173 ogni campo del percorso costa quanto ne resta, comunque sia fatto', () => {
  const n = 60_000;
  const casi = [
    ['elemento di lettere', () => I.redactSelector('a'.repeat(n))],
    ['elemento di cifre e punti', () => I.redactSelector('1.'.repeat(n / 2))],
    ['elemento con una chiocciola e un dominio senza fine', () => I.redactSelector('a@' + 'b'.repeat(n))],
    ['intento con una fila di virgolette', () => I.sanitizeIntent('x' + '"'.repeat(n) + 'y')],
    ['intento con una fila di asterischi', () => I.sanitizeIntent('x' + '*'.repeat(n) + 'y')],
    ['sezione di partenza già ridotta', () => I.sanitizeInitialUrl('/u/' + 'a'.repeat(n), 'esempio.it')],
    ['sezione di partenza da un indirizzo', () => I.sanitizeInitialUrl('https://esempio.it/' + 'a1.'.repeat(n / 3))],
    ['testo da pulire, senza tagli', () => I.redigiDatiPersonali('a'.repeat(n))],
  ];
  for (const [nome, op] of casi) {
    const c = costoInUnita(op, { tetto: 3, giri: 3 });
    assert.ok(c.entro, `${nome}: ${c.come}`);
  }
});

// Le espressioni che la pulizia usava: qui sono il metro di quello che deve dare.
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const conEspressione = (t) => t.replace(EMAIL_RE, '[EMAIL]');
const bordiConEspressione = (t) => t.replace(/^["'`]+|["'`]+$/g, '').trim().replace(/^[*_]+|[*_]+$/g, '').trim();

function generatore(seme) {
  let a = seme >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('#1173 le email si trovano come le trovava l’espressione, carattere per carattere', () => {
  const fissi = [
    'mario.rossi@gmail.com', 'a@b.com1@c.org', 'x@y.co.uk', '@a.bc', 'a@.bc', 'a@b.c', 'a@bc.de-f', 'a@b.cc@d.ee',
    'Profilo di Mario.Rossi+spesa@Posta.IT, scrivi', 'a_b%c@d-e.f.gh9', 'é@ä.it a@b.ïtx', '..@..aa', 'a@b..cc', 'a@-.cc',
    '1@2.34', 'a@b.c1d.ef', 'ab@cd.efgh.ij.k', '', '@', '@@a.bc', 'a@@b.cc',
  ];
  for (const t of fissi) assert.equal(I.redigiEmail(t), conEspressione(t), JSON.stringify(t));
  const caso = generatore(1173);
  const alfabeti = ['a@.b', 'ab@.-_%+1 ', '@.', 'xY.@co', 'a1@.', 'abc@d.e.fg h@i.jk', 'a@b.cc@d.ee', 'mario.rossi@gmail.com '];
  for (let k = 0; k < 40_000; k++) {
    const alf = alfabeti[k % alfabeti.length];
    let t = '';
    for (let i = 0, n = 1 + Math.floor(caso() * 30); i < n; i++) t += alf[Math.floor(caso() * alf.length)];
    assert.equal(I.redigiEmail(t), conEspressione(t), JSON.stringify(t));
  }
});

test('#1173 l’intento perde ai bordi le stesse virgolette e gli stessi asterischi di prima', () => {
  const caso = generatore(585);
  const alf = '"\'`*_ xa';
  for (let k = 0; k < 20_000; k++) {
    let t = '';
    for (let i = 0, n = Math.floor(caso() * 16); i < n; i++) t += alf[Math.floor(caso() * alf.length)];
    assert.equal(I.togliAiBordi(I.togliAiBordi(t, '"\'`').trim(), '*_').trim(), bordiConEspressione(t), JSON.stringify(t));
  }
});

// Davanti al dato una fila di email lunghe, che la pulizia accorcia a «[EMAIL] »: così quello che il taglio lascia in
// fondo arriva dentro il tetto e si vede, che è il caso peggiore. Il dato si fa scorrere a cavallo del taglio.
const RIEMPITIVO = 'a'.repeat(30) + '@' + 'b'.repeat(30) + '.it ';
function aCavallo(dato, tetto, dentro) {
  const prima = (RIEMPITIVO.repeat(Math.ceil(tetto / RIEMPITIVO.length))).slice(0, tetto - dentro).replace(/\S+$/, (m) => ' '.repeat(m.length));
  return prima + dato + ' ' + RIEMPITIVO.repeat(3);
}
const SEGNAPOSTI = /\[(EMAIL|IBAN|CODICE|NUMERO|ID)\]/g;

test('#1173 il taglio prima della pulizia non lascia in fondo mezzo dato personale', () => {
  const dati = ['mario.rossi@gmail.com', 'IT60X0542811101000000123456', 'RSSMRA80A01H501U', '3331234567', '@mariorossi'];
  const campi = [
    ['elemento', (t) => I.redactSelector(t), tettoDi(MAX_SELECTOR_LEN)],
    ['intento', (t) => I.sanitizeIntent(t), tettoDi(MAX_INTENT_LEN)],
  ];
  for (const [campo, pulisci, tetto] of campi) {
    for (const dato of dati) {
      for (let dentro = 1; dentro < dato.length; dentro++) {
        const fuori = pulisci(aCavallo(dato, tetto, dentro));
        assert.ok(fuori.includes('[EMAIL]'), `${campo}: la prova deve arrivare al taglio`);
        assert.equal(fuori.replace(SEGNAPOSTI, '').trim(), '', `${campo}, ${dato} tagliato dopo ${dentro}: ${JSON.stringify(fuori.slice(-60))}`);
      }
    }
  }
});

test('#1173 un numero scritto a gruppi tagliato a metà non lascia sei cifre', () => {
  const dato = '4111 1111 1111 1111';
  const tetto = tettoDi(MAX_SELECTOR_LEN);
  for (let dentro = 1; dentro < dato.length; dentro++) {
    const fuori = I.redactSelector(aCavallo(dato, tetto, dentro));
    assert.ok((fuori.replace(SEGNAPOSTI, '').match(/\d/g) || []).length < 6, `tagliato dopo ${dentro}: ${JSON.stringify(fuori.slice(-60))}`);
  }
});

test('#1173 un indirizzo si taglia fra un pezzo e l’altro: un’email cifrata a cavallo non esce', () => {
  const tetto = tettoDi(MAX_URL_LEN);
  // Pezzi che la pulizia accorcia (21 caratteri → «[NUMERO]»), così il fondo del taglio finisce dentro il tetto.
  const pezzo = '12345678901234567890/';
  const dato = 'mario.rossi%40gmail.com';
  for (const dentro of [1, 6, 12, 14, 15, 18, dato.length - 1]) {
    const prima = pezzo.repeat(Math.ceil(tetto / pezzo.length)).slice(0, tetto - dentro).replace(/[^/]+$/, (m) => '0'.repeat(m.length - 1) + '/');
    for (const indirizzo of [`https://esempio.it/${prima}${dato}/fine`, `/${prima}${dato}/fine`]) {
      const fuori = I.sanitizeInitialUrl(indirizzo, 'esempio.it');
      assert.ok(fuori.length <= MAX_URL_LEN);
      assert.ok(fuori.includes('[NUMERO]'), 'la prova deve arrivare al taglio');
      assert.doesNotMatch(fuori, /mario|rossi|%40|@/, `tagliato dopo ${dentro}: ${fuori.slice(-60)}`);
      assert.match(fuori, /\/\[EMAIL\]\/fine$/, 'la pulizia accorcia, e quello che segue arriva lo stesso');
    }
  }
});

test('#1173 un campo che la pulizia accorcia molto tiene la coda: quale pulsante, dove si va', () => {
  assert.equal(I.redactSelector(`[data-id="${'1'.repeat(1400)}"] button.Paga`), '[data-id="[NUMERO]"] button.Paga');
  assert.match(I.redactSelector(`[aria-label="${'mario.rossi.lunghissimo@example-company.com, '.repeat(40)}"] .invia`), /\.invia$/);
  assert.equal(I.sanitizeIntent(`Pagare la pratica ${'1'.repeat(800)} dal menu Fatture`), 'Pagare la pratica [NUMERO] dal menu Fatture');
  assert.equal(I.sanitizeInitialUrl(`https://esempio.it/area/${'1'.repeat(4500)}/ordini`), '/area/[NUMERO]/ordini');
  assert.equal(I.sanitizeInitialUrl(`/area/${'1'.repeat(4500)}/ordini`, 'esempio.it'), '/area/[NUMERO]/ordini');
  // In testa quello che la pulizia toglie del tutto: spazi, virgolette, segni invisibili.
  assert.equal(I.redactSelector(' '.repeat(3000) + 'button.Paga'), 'button.Paga');
  assert.equal(I.sanitizeIntent('"'.repeat(2000) + 'aprire le fatture'), 'aprire le fatture');
  assert.equal(I.sanitizeInitialUrl('​'.repeat(6000) + '/area/ordini', 'esempio.it'), '/area/ordini');
  // Il pezzo cresce, ma non fino al mega: un documento ostile fatto di sole cifre costa come uno di lettere.
  const c = costoInUnita(() => I.redactSelector(`[data-id="${'1'.repeat(600_000)}"] button.Paga`), { tetto: 3, giri: 3 });
  assert.ok(c.entro, `un campo che si accorcia tutto: ${c.come}`);
});

test('#1173 quello che sta nel tetto resta quello di prima: il taglio anticipato non toglie niente', () => {
  const parole = 'button[aria-label="Apri il riepilogo delle fatture del mese"] > span.voce ';
  const lungo = parole.repeat(80);
  assert.equal(I.redactSelector(lungo), I.neutralizzaMarcature(I.redigiDatiPersonali(lungo)).trim().slice(0, MAX_SELECTOR_LEN));
  const frase = 'Aprire le fatture del mese e scaricarle '.repeat(60);
  assert.equal(I.sanitizeIntent(frase), I.neutralizzaMarcature(I.redigiDatiPersonali(frase)).trim().slice(0, MAX_INTENT_LEN).trim());
  const percorso = '/area-clienti/fatture/elenco'.repeat(400);
  assert.equal(I.sanitizeInitialUrl(percorso, 'esempio.it'), I.redigiPercorso(percorso, 'esempio.it').slice(0, MAX_URL_LEN));
});

test('#1173 due percorsi che la pulizia rende uguali entrano nel prompt una volta sola', () => {
  const prompt = Safety.formatKnownPathsForPrompt([
    { domain: 'esempio.it', initialUrl: '/conto', intent: 'vedere il saldo', steps: [{ selector: '#saldo', action: 'click' }] },
    { domain: 'esempio.it', initialUrl: '/conto', intent: 'vedere il saldo', steps: [{ selector: '#sal​do', action: 'click' }] },
  ]);
  assert.equal(prompt.match(/## "vedere il saldo"/g).length, 1);
});
