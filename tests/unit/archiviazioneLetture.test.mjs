// L'archiviazione automatica: quello che costa ARCHIVIARE sta nel conto.
//
// La scansione che decide chi archiviare adesso chiede i campi che le servono e
// si paga una volta sola (#680). Il passo successivo — scrivere `archived` su
// ognuna — rileggeva però la segnalazione INTERA, testo cifrato, note e
// allegati compresi, e quelle letture non entravano nella riga del costo: un
// giro che riusa la scansione dichiarava «letti: 0» mentre pagava una lettura
// per ogni segnalazione archiviata (#680, secondo giro).
//
// Senza il fix questo file è rosso.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const require = createRequire(import.meta.url);
require(join(ROOT, 'src', 'shared', 'feedback.js'));
require(join(ROOT, 'src', 'shared', 'manageReview.js'));
require(join(ROOT, 'src', 'shared', 'boardArchive.js'));

const FB = globalThis.SN_FEEDBACK;
const { runAutoArchive } = await import('../../scripts/auto-archive.mjs');

const ORA = Date.parse('2026-09-20T12:00:00Z');
const VECCHIO = new Date(ORA - 5 * 24 * 3600_000).toISOString();
const voto = () => ({ a: { vote: 'works', at: VECCHIO, weight: 3 }, b: { vote: 'works', at: VECCHIO, weight: 3 } });

// Un Firestore finto che registra COME viene chiesto un singolo documento.
function firestoreFinto() {
  const letture = [];
  const patch = [];
  const fatto = async (url, opts = {}) => {
    const u = String(url);
    if (/token|oauth/i.test(u)) {
      return { ok: true, status: 200, json: async () => ({ id_token: 'tok', access_token: 'tok' }) };
    }
    if (opts.method === 'PATCH') {
      patch.push(u);
      return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
    }
    const m = u.match(/documents\/feedback\/([^/?]+)(?:\?(.*))?$/);
    if (m) {
      letture.push({ id: decodeURIComponent(m[1]), maschera: new URLSearchParams(m[2] || '').getAll('mask.fieldPaths') });
      return {
        ok: true,
        status: 200,
        json: async () => ({ name: `p/documents/feedback/${m[1]}`, fields: { status: { stringValue: 'done' } } }),
      };
    }
    return { ok: false, status: 404, text: async () => `non gestito: ${u}` };
  };
  return { fatto, letture, patch };
}

async function archivia(finto, opts) {
  const vereFB = { list: FB.list, listPublic: FB.listPublic };
  const veraFetch = globalThis.fetch;
  const veroRT = process.env.FILO_ADMIN_REFRESH_TOKEN;
  const righe = [
    { _id: 'uno', status: 'done', resolvedAt: VECCHIO, resolvedInVersion: '1.0.0', seq: 1, subSeq: 0 },
    { _id: 'due', status: 'done', resolvedAt: VECCHIO, resolvedInVersion: '1.0.0', seq: 2, subSeq: 0 },
  ];
  FB.list = async (o) => (o.afterName ? [] : righe.map((r) => ({ ...r, votes: voto() })));
  FB.listPublic = async (o) => (o.afterName ? [] : []);
  globalThis.fetch = finto.fatto;
  process.env.FILO_ADMIN_REFRESH_TOKEN = 'rt-di-prova';
  const log = console.log;
  console.log = () => {};
  try {
    return await runAutoArchive({ now: ORA, releasedVersion: '1.0.0', ...opts });
  } finally {
    console.log = log;
    FB.list = vereFB.list;
    FB.listPublic = vereFB.listPublic;
    FB.forgetAllPublic();
    globalThis.fetch = veraFetch;
    if (veroRT === undefined) delete process.env.FILO_ADMIN_REFRESH_TOKEN;
    else process.env.FILO_ADMIN_REFRESH_TOKEN = veroRT;
  }
}

test('archiviare rilegge SOLO i campi che guarda, non la segnalazione intera', async () => {
  const finto = firestoreFinto();
  const r = await archivia(finto, { dryRun: false, copiaDir: cartellaTemporanea('archivio-campi-') });
  assert.equal(r.toArchive.length, 2, 'non ha archiviato niente: la prova non prova niente');
  assert.equal(finto.letture.length, 2);
  for (const l of finto.letture) {
    assert.ok(l.maschera.length > 0, `${l.id}: riletta intera, senza dire quali campi servono`);
    assert.ok(!l.maschera.includes('text') && !l.maschera.includes('images'),
      `${l.id}: chiede ancora il testo o gli allegati (${l.maschera.join(', ')})`);
  }
});

test('la riga del costo comprende le letture fatte per archiviare, anche quando la scansione è riusata', async () => {
  const dir = cartellaTemporanea('archivio-conto-');
  // La prova a secco mette da parte la scansione: nessuna scrittura, nessuna
  // rilettura.
  const secco = firestoreFinto();
  await archivia(secco, { dryRun: true, copiaDir: dir });
  assert.deepEqual(secco.patch, []);

  // L'applicazione che la segue non ripaga la scansione, ma rilegge per
  // archiviare: il numero dichiarato non può essere zero.
  const applica = firestoreFinto();
  const r = await archivia(applica, { dryRun: false, copiaDir: dir });
  assert.equal(applica.letture.length, 2, 'non ha archiviato: la prova non prova niente');
  assert.equal(r.letture, applica.letture.length,
    `dichiarati ${r.letture}, letti davvero ${applica.letture.length}`);
  assert.match(r.rigaLetture, /: 2/);
});
