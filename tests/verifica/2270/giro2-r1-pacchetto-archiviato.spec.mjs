// #2270 giro 2, rilievo 1: un pacchetto archiviato senza risolversi lascia i suoi originali «assorbiti» per sempre:
// nessuna scheda pubblica per chi li ha segnalati (non sapranno mai niente) e nessuna lista di Gestione che li mostri.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
for (const m of ['constants.js', 'feedbackTransitions.js', 'feedbackStatus.js', 'domande.js', 'manageReview.js', 'feedbackClientIdHash.js', 'feedbackPublicView.js']) {
  require(join(ROOT, 'src', 'shared', m));
}
const MR = globalThis.SN_MANAGE_REVIEW;
const V = globalThis.SN_FEEDBACK_PUBLIC_VIEW;

const fb = (id, seq, status, extra = {}) => ({
  _id: id, seq, subSeq: 0, name: `Titolo di ${seq}`, status, priority: 1, createdAt: '2026-11-10T10:00:00Z',
  clientIdHash: 'a'.repeat(32), ...extra,
});
// Il pacchetto è stato archiviato (dall'owner, o come doppione) senza fusione: i suoi originali non si risolveranno.
const DATI = [
  fb('p', 300, 'archived', { unisce: [{ id: 'a1', num: '#101' }, { id: 'a2', num: '#102' }] }),
  fb('a1', 101, 'archived', { unitoIn: 'p' }),
  fb('a2', 102, 'archived', { unitoIn: 'p' }),
];

test('r1 chi ha segnalato un originale di un pacchetto archiviato ritrova la sua segnalazione, chiusa', () => {
  const { upsert } = V.planSync([], DATI, { complete: true });
  const ids = upsert.map((u) => u.id);
  for (const id of ['a1', 'a2']) expect(ids, `${id}: senza scheda chi l'ha mandata non saprà mai che fine ha fatto`).toContain(id);
});

test('r1 in Gestione gli originali di un pacchetto archiviato tornano fra gli Archiviati', () => {
  const archiviati = MR.listArchiveTab(DATI, {}).map((f) => f._id);
  for (const id of ['a1', 'a2']) expect(archiviati, `${id}: altrimenti non sta in nessuna lista`).toContain(id);
});
