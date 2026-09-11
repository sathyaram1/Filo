// Le due cose dei percorsi condivisi che vivono FUORI dal codice: l'indice che
// la lettura pretende, e i comandi con cui si pubblica e si ripulisce (#584).
//
// PERCHÉ ESISTE. Un indice e una query sono una coppia, ma stanno in due file
// che nessuno legge insieme: girare un ordinamento nel client lascia l'indice
// buono per una query che non si fa più, e il server rifiuta quella vera. Il
// rifiuto non si vede — la funzione ripiega e l'assistente perde i percorsi
// buoni più vecchi — quindi va colto qui, in millisecondi.
//
// E il comando che ripulisce i vecchi percorsi passa a un dito dal comando che
// cancella TUTTI i percorsi: `--shallow` toglie i documenti della vecchia forma
// piatta e lascia stare le sottocollezioni, `--recursive` porta via anche
// quelle. Un test che tiene fermo quel flag costa niente e la distrazione che
// evita costa tutto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'paths.js'));

const P = globalThis.SN_PATHS;
const PROMPTS = globalThis.SN_CONST.PROMPTS;
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const indici = JSON.parse(readFileSync(join(ROOT, 'firestore.indexes.json'), 'utf8'));

// La query vera che parte per leggere i percorsi riusciti di un sito.
async function queryDiLettura() {
  const orig = globalThis.fetch;
  let corpo = null;
  globalThis.fetch = async (_url, opts) => {
    if (!corpo) corpo = JSON.parse(opts.body).structuredQuery;
    return { ok: true, status: 200, json: async () => [], text: async () => '' };
  };
  try { await P.listByDomain('esempio.it', { pageSize: 50, onlySuccess: true }); }
  finally { globalThis.fetch = orig; }
  return corpo;
}

test('l’indice pubblicato è quello che la lettura dei percorsi chiede davvero', async () => {
  const q = await queryDiLettura();
  const campoFiltrato = q.where?.fieldFilter?.field?.fieldPath;
  const campoOrdinato = q.orderBy[0].field.fieldPath;
  const verso = q.orderBy[0].direction === 'DESCENDING' ? 'DESCENDING' : 'ASCENDING';

  const indice = indici.indexes.find((i) => i.collectionGroup === q.from[0].collectionId);
  assert.ok(indice,
    `manca l’indice per la collezione "${q.from[0].collectionId}": senza, il server rifiuta la lettura filtrata`);
  assert.deepEqual(
    indice.fields.map((f) => [f.fieldPath, f.order]),
    [[campoFiltrato, 'ASCENDING'], [campoOrdinato, verso]],
    'indice e query hanno smesso di corrispondere: il server rifiuterebbe la query vera',
  );
  assert.equal(indice.queryScope, 'COLLECTION',
    'i percorsi si leggono sotto un dominio nominato, mai come gruppo: una query di gruppo li rimetterebbe insieme tutti');
});

test('un comando solo pubblica regole e indici insieme', () => {
  const cmd = pkg.scripts['deploy:regole'];
  assert.ok(cmd, 'senza un comando la pubblicazione si fa a memoria, e prima o poi si salta');
  assert.match(cmd, /firestore:rules/);
  assert.match(cmd, /firestore:indexes/,
    'gli indici vanno con le regole: una query senza il suo indice smette di dare risultati e non si rompe niente di visibile');
});

test('il comando che ripulisce i vecchi percorsi non porta via quelli nuovi', () => {
  const cmd = pkg.scripts['purga:percorsi-vecchi'];
  assert.ok(cmd, 'i vecchi percorsi col codice del mittente vanno cancellati, non solo resi illeggibili');
  assert.match(cmd, /--shallow/,
    '--shallow toglie i documenti della vecchia forma piatta e lascia le sottocollezioni');
  assert.ok(!/--recursive/.test(cmd),
    '--recursive cancellerebbe anche i percorsi condivisi vivi: sono due comandi a un flag di distanza');
});

test('nel prompt dell’assistente i percorsi di sconosciuti sono dichiarati non fidati', () => {
  const conPercorsi = PROMPTS.helpContext({ url: 'https://x.it', knownPaths: '## "una cosa" (da /a)' });
  const senza = PROMPTS.helpContext({ url: 'https://x.it' });

  assert.ok(conPercorsi.includes('## "una cosa" (da /a)'));
  assert.ok(!senza.includes('Percorsi noti'), 'senza percorsi il blocco non deve comparire');

  const blocco = conPercorsi.slice(conPercorsi.indexOf('# Percorsi noti'));
  assert.match(blocco, /prompt injection/i,
    'un percorso lo scrive chiunque senza login e parla la lingua dei passi da eseguire: va dichiarato non fidato come la pagina');
  assert.match(blocco, /non fidat/i);
  assert.match(conPercorsi, /percorsi noti[^.]*non ordini/i,
    'il richiamo finale deve nominare anche i percorsi, non solo pagina e llms.txt');
});
