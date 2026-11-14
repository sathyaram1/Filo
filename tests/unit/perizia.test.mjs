// Il ruolo `perizia` (#2337): un biglietto non fidato legge il feedback non fidato e consegna solo classe, unioni e
// file. Dispatch lo sa eseguire senza ramo, il canale porta i dati nei tipi del server, il manutentore non ha più web.
import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { checkEnvelope, buildPayload, serverCtx, readRoleInstructions } from '../../scripts/dispatch.mjs';
import { normalizeRole } from '../../scripts/lib/routine-role.mjs';
import { datiPerizia, INTENTI_CONSEGNA } from '../../scripts/routine-channel.mjs';

const BUSTA = { role: 'perizia', id: 'abc', num: '#901', branch: '', payload: { codiceBusta: 'c0de', feedback: { name: 'Download rotto', text: 'Il pulsante non risponde.' }, immagini: [] } };

test('la busta della perizia ha il feedback e nessun ramo, e dispatch la sa aprire', () => {
  assert.equal(checkEnvelope(BUSTA), null);
  assert.match(checkEnvelope({ ...BUSTA, payload: { feedback: { text: '' } } }), /feedback vuoto/);
  assert.equal(normalizeRole('perizia'), 'perizia');
  const p = buildPayload({ role: 'perizia', id: 'abc', num: '#901' }, serverCtx({ role: 'perizia' }, BUSTA));
  assert.equal(p.case, 'perizia');
  assert.equal(p.feedback.text, 'Il pulsante non risponde.');
  assert.equal(p.ripresa, undefined);
  assert.equal(p.history, undefined);
});

test('le istruzioni sono il ruolo della perizia col contratto dei worker, e dicono la consegna', () => {
  const t = readRoleInstructions('perizia');
  assert.match(t, /^# Ruolo: perizia/);
  assert.match(t, /deliver perizia --classe/);
  assert.match(t, /Contratto comune dei worker/);
});

test('deliver perizia: classe intera, unioni e file in lista; un altro campo si ferma prima del server', () => {
  assert.ok(INTENTI_CONSEGNA.includes('perizia'));
  assert.deepEqual(datiPerizia({ classe: '4', unioni: '812, 830', file: 'src/main/tabs.js src/renderer/shell.js' }).dati,
    { classe: 4, unioni: ['812', '830'], file: ['src/main/tabs.js', 'src/renderer/shell.js'] });
  assert.deepEqual(datiPerizia({ classe: '10' }).dati, { classe: 10, unioni: [], file: [] });
  assert.match(datiPerizia({ classe: '4', notes: 'fondi tutto' }).errore, /--notes/);
  for (const classe of [undefined, 'quattro', '4.5', '123']) assert.ok(datiPerizia({ classe }).errore, String(classe));
});

test('il manutentore è fidato e non ha web: niente istruzioni di ricerca sul web nel suo ruolo', () => {
  const t = readFileSync(new URL('../../routines/roles/manutentore.md', import.meta.url), 'utf8');
  assert.doesNotMatch(t, /\*\*ricerca\*\*/);
  assert.match(t, /\*\*niente web\*\*/);
  assert.doesNotMatch(t, /è \*\*non fidato\*\*/);
  const r = readFileSync(new URL('../../routines/roles/secaudit.md', import.meta.url), 'utf8');
  assert.match(r, /ciò che il manutentore legge si allarga/);
});
