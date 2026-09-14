// Le schede pubbliche si leggono TUTTE, non una pagina — #583.
//
// Il caso che l'ha fatta nascere. La vista pubblica (`feedback-public`) si
// leggeva con una finestra: le N più recenti PER DATA D'INVIO. Ma le domande
// che si fanno alle schede non stanno su quell'asse:
//
//   · «mi spetta una ricompensa?» — una segnalazione vecchia chiusa oggi ha una
//     data d'invio vecchia, quindi la sua scheda nasce già in fondo. Fuori dalla
//     finestra, chi l'aveva mandata non riceveva né l'annuncio né i crediti,
//     mentre il suo fix compariva in bacheca sotto i suoi occhi;
//   · «quali schede vanno tolte?» — una scheda fuori dalla finestra non la
//     poteva togliere più nessuno: un fix vecchio rimesso in lavorazione restava
//     in bacheca come risolto, votabile e riapribile a pagamento;
//   · «cosa mostra la bacheca?» e «quali voti ha questo fix?» — stessa cosa.
//
// Con 552 schede e un tetto di 500, la risposta ne dimenticava 52 senza dirlo.
//
// Senza il fix questo test è ROSSO: `listAllPublic` non esisteva e chi voleva
// tutte le schede chiedeva una pagina.

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

// 552 schede: le cifre vere del progetto a settembre 2026, cioè 52 oltre il
// tetto di 500.
const TUTTE = Array.from({ length: 552 }, (_, i) => ({ _id: `c${String(i).padStart(4, '0')}` }));

// Una sorgente che si comporta come Firestore: ordinata per nome, tagliata a
// `pageSize`, e che riparte dopo il cursore che le viene passato.
function sorgenteVera(righe) {
  return async ({ pageSize = 500, afterName = null } = {}) => {
    if (typeof afterName !== 'string') return righe.slice(0, pageSize);
    const dopo = afterName ? righe.findIndex((r) => afterName.endsWith(`/${r._id}`)) + 1 : 0;
    return righe.slice(dopo, dopo + pageSize);
  };
}

async function conSorgente(fn, corpo) {
  const vera = FB.listPublic;
  FB.listPublic = fn;
  try { return await corpo(); } finally { FB.listPublic = vera; }
}

test('552 schede e un tetto di 500: le legge tutte, una volta sola ciascuna', async () => {
  await conSorgente(sorgenteVera(TUTTE), async () => {
    const { rows, complete } = await FB.listAllPublicPaged();
    assert.equal(rows.length, 552, 'con una pagina sola ne arrivavano 500 e 52 sparivano');
    assert.equal(new Set(rows.map((r) => r._id)).size, 552, 'il cursore ha ripetuto delle righe');
    assert.equal(complete, true);
  });
});

test('l\'ultima scheda, quella che la finestra tagliava, c\'è', async () => {
  await conSorgente(sorgenteVera(TUTTE), async () => {
    const rows = await FB.listAllPublic();
    const ids = rows.map((r) => r._id);
    assert.ok(ids.includes(TUTTE[551]._id), 'la 552esima scheda non arriva: è esattamente il caso del difetto');
    assert.ok(ids.includes(TUTTE[0]._id));
  });
});

test('una raccolta più corta di una pagina si legge con una domanda sola', async () => {
  let domande = 0;
  const corta = TUTTE.slice(0, 7);
  await conSorgente(async (opts) => { domande += 1; return sorgenteVera(corta)(opts); }, async () => {
    const rows = await FB.listAllPublic();
    assert.equal(rows.length, 7);
    assert.equal(domande, 1, 'una raccolta corta non deve costare una seconda lettura');
  });
});

test('una raccolta vuota torna vuota, non un giro a vuoto', async () => {
  await conSorgente(async () => [], async () => {
    const { rows, complete } = await FB.listAllPublicPaged();
    assert.deepEqual(rows, []);
    assert.equal(complete, true);
  });
});

test('una sorgente che ignora il cursore non fa girare a vuoto (le prove la sostituiscono così)', async () => {
  // Una prova che rimpiazza `listPublic` con un array fisso torna sempre la
  // stessa pagina: senza la guardia sarebbe un ciclo lungo quanto `maxPages`,
  // con le stesse righe ripetute quaranta volte.
  let domande = 0;
  await conSorgente(async ({ pageSize = 500 } = {}) => { domande += 1; return TUTTE.slice(0, pageSize); }, async () => {
    const { rows, complete } = await FB.listAllPublicPaged();
    assert.equal(new Set(rows.map((r) => r._id)).size, rows.length, 'righe ripetute');
    assert.ok(domande <= 2, `la sorgente è stata interrogata ${domande} volte`);
    assert.equal(complete, true);
  });
});

test('il freno sulle pagine non mente: se scatta, lo dice', async () => {
  // Una raccolta più grande di quanto il freno permetta non deve tornare come
  // se fosse tutta: un troncamento silenzioso qui vuol dire schede che nessuno
  // può più togliere e ricompense che non arrivano.
  await conSorgente(sorgenteVera(TUTTE), async () => {
    const { rows, complete } = await FB.listAllPublicPaged({ pageSize: 100, maxPages: 2 });
    assert.equal(rows.length, 200);
    assert.equal(complete, false, 'il freno è scattato e la risposta si è spacciata per completa');
  });
});

test('chi chiede tutte le schede passa da qui, non da una pagina', async () => {
  assert.equal(typeof FB.listAllPublic, 'function');
  assert.equal(typeof FB.listAllPublicPaged, 'function');
});
