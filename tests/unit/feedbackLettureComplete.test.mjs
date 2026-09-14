// Le due letture complete dei feedback: la memoria breve e la collezione vera
// — #583, sesto giro di verifica.
//
// PRIMA PARTE — la memoria breve delle schede.
// L'annuncio della ricompensa gira a ogni caricamento della home, e la home è
// la pagina di OGNI SCHEDA NUOVA. Da quando quella lettura chiede tutte le
// schede invece di una pagina, chi ha mandato almeno una segnalazione si
// riscaricava la bacheca intera ogni volta che apriva una scheda: misurate,
// quattro aperture costavano 2208 schede in otto richieste, e il numero cresce
// da solo a ogni fix che esce. Dall'altra parte, sul computer di chi i feedback
// li gestisce, la stessa lettura passava già da una memoria breve: due cammini
// uguali di cui uno solo ricordava.
//
// SECONDA PARTE — tutte le segnalazioni, non una pagina.
// L'archiviazione automatica decide quali fix chiusi possono uscire dalla
// bacheca, e chiedeva le 500 più recenti PER DATA D'INVIO. Con 711 segnalazioni
// ne restavano fuori 211, e sono proprio quelle che un giro di archiviazione
// dovrebbe prendere per prime: i loro fix non uscivano mai dalla bacheca,
// restavano votabili e riapribili a pagamento, e per loro non si accendeva
// nemmeno il segnale «gli utenti dicono che non va».
//
// Senza le due correzioni questo file è rosso: la memoria non c'era e
// `listAll` non esisteva.
// Il racconto: patterns/una-pagina-dei-piu-recenti-non-e-tutto.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const require = createRequire(import.meta.url);
require(join(ROOT, 'src', 'shared', 'feedback.js'));

const FB = globalThis.SN_FEEDBACK;

// Una sorgente che si comporta come Firestore: ordinata per nome, tagliata a
// `pageSize`, e che riparte dopo il cursore. Conta anche quante volte la si
// interroga e quante righe ha consegnato.
function sorgenteVera(righe) {
  const conto = { chiamate: 0, righe: 0 };
  const fn = async ({ pageSize = 500, afterName = null } = {}) => {
    conto.chiamate += 1;
    const out = typeof afterName === 'string'
      ? righe.slice(afterName ? righe.findIndex((r) => afterName.endsWith(`/${r._id}`)) + 1 : 0,
        (afterName ? righe.findIndex((r) => afterName.endsWith(`/${r._id}`)) + 1 : 0) + pageSize)
      : righe.slice(0, pageSize);
    conto.righe += out.length;
    return out;
  };
  fn.conto = conto;
  return fn;
}

// ── La memoria breve delle schede ────────────────────────────────────────────

const SCHEDE = Array.from({ length: 552 }, (_, i) => ({ _id: `c${String(i).padStart(4, '0')}` }));

async function conSchede(fn, corpo) {
  const vera = FB.listPublic;
  FB.listPublic = fn;
  FB.forgetAllPublic();
  try { return await corpo(); } finally { FB.listPublic = vera; FB.forgetAllPublic(); }
}

test('quattro letture di fila non costano quattro bacheche', async () => {
  const sorgente = sorgenteVera(SCHEDE);
  await conSchede(sorgente, async () => {
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await FB.listAllPublic();
      assert.equal(rows.length, 552, 'ogni lettura deve comunque portare tutte le schede');
    }
    assert.equal(sorgente.conto.righe, 552,
      `la bacheca si è riscaricata ogni volta: ${sorgente.conto.righe} schede lette invece di 552`);
  });
});

test('chi deve vedere le schede appena cambiate chiede una lettura fresca', async () => {
  const sorgente = sorgenteVera(SCHEDE);
  await conSchede(sorgente, async () => {
    await FB.listAllPublic();
    await FB.listAllPublic({ fresh: true });
    assert.equal(sorgente.conto.righe, 1104, 'con `fresh` la memoria non deve valere');
  });
});

test('dopo aver scritto o tolto una scheda la memoria non vale più', async () => {
  const sorgente = sorgenteVera(SCHEDE);
  await conSchede(sorgente, async () => {
    await FB.listAllPublic();
    FB.forgetAllPublic();
    await FB.listAllPublic();
    assert.equal(sorgente.conto.righe, 1104);
  });
});

test('una sorgente diversa non si ritrova davanti le schede di quella prima', async () => {
  const prima = sorgenteVera(SCHEDE);
  await conSchede(prima, async () => {
    const a = await FB.listAllPublic();
    assert.equal(a.length, 552);
  });
  // Una prova che rimette in scena schede diverse: la memoria non deve servire
  // quelle di prima solo perché sono passati meno di trenta secondi.
  const dopo = sorgenteVera([{ _id: 'unica' }]);
  await conSchede(dopo, async () => {
    const b = await FB.listAllPublic();
    assert.deepEqual(b.map((r) => r._id), ['unica']);
  });
});

test('una lettura troncata non si ricorda: ripeterla è l\'unico modo di completarla', async () => {
  const sorgente = sorgenteVera(SCHEDE);
  await conSchede(sorgente, async () => {
    const { rows, complete } = await FB.listAllPublicPaged({ maxPages: 1 });
    assert.equal(complete, false);
    assert.equal(rows.length, 500);
    // La lettura completa che segue NON deve trovare in memoria il troncamento.
    const tutte = await FB.listAllPublic();
    assert.equal(tutte.length, 552);
  });
});

// ── Tutte le segnalazioni, non una pagina ───────────────────────────────────

// 711 segnalazioni: le cifre vere del progetto a settembre 2026, cioè 211 oltre
// il tetto di 500.
const SEGNALAZIONI = Array.from({ length: 711 }, (_, i) => ({ _id: `f${String(i).padStart(4, '0')}` }));

async function conSegnalazioni(fn, corpo) {
  const vera = FB.list;
  FB.list = fn;
  try { return await corpo(); } finally { FB.list = vera; }
}

test('711 segnalazioni e un tetto di 500: le legge tutte, una volta sola ciascuna', async () => {
  await conSegnalazioni(sorgenteVera(SEGNALAZIONI), async () => {
    const { rows, complete } = await FB.listAllPaged();
    assert.equal(rows.length, 711, 'con una pagina sola ne arrivavano 500 e 211 sparivano');
    assert.equal(new Set(rows.map((r) => r._id)).size, 711, 'il cursore ha ripetuto delle righe');
    assert.equal(complete, true);
  });
});

test('c\'è anche la segnalazione più vecchia, quella che la finestra tagliava', async () => {
  await conSegnalazioni(sorgenteVera(SEGNALAZIONI), async () => {
    const rows = await FB.listAll();
    assert.ok(rows.some((r) => r._id === 'f0710'), 'manca l\'ultima della collezione');
  });
});

test('il freno sulle pagine non mente: se scatta, lo dice', async () => {
  await conSegnalazioni(sorgenteVera(SEGNALAZIONI), async () => {
    const { rows, complete } = await FB.listAllPaged({ maxPages: 1 });
    assert.equal(rows.length, 500);
    assert.equal(complete, false, 'un troncamento silenzioso qui vuol dire numeri già presi e fix mai archiviati');
  });
});

test('chi vuole tutte le segnalazioni passa dalla porta esposta, non da una privata', async () => {
  // Chi sostituisce `SN_FEEDBACK.list` in una prova deve vedersi sostituita
  // anche la lettura completa, o si ritroverebbe la rete vera sotto dati finti.
  let passata = false;
  await conSegnalazioni(async () => { passata = true; return []; }, async () => {
    await FB.listAll();
  });
  assert.equal(passata, true);
});
