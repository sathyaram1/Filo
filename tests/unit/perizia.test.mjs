// Il ruolo `perizia` (#2337): un biglietto non fidato legge il feedback non fidato e consegna solo classe, unioni e
// file. Dispatch lo sa eseguire senza ramo, il canale porta i dati nei tipi del server, il manutentore non ha più web.
import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

import { checkEnvelope, buildPayload, serverCtx, readRoleInstructions, apreUnRamo } from '../../scripts/dispatch.mjs';
import { normalizeRole } from '../../scripts/lib/routine-role.mjs';
import { datiPerizia, INTENTI_CONSEGNA, CAMPI_PERIZIA, CAMPI_DELLA_RIGA } from '../../scripts/routine-channel.mjs';
import { chiamaLaRete, STRUMENTO_RETE } from '../../scripts/session-report.mjs';
import { ramiInCorso } from '../../scripts/lib/su-main.mjs';
import { rigaRamo } from '../../scripts/manutentore.mjs';

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

test('il censimento delle schede lascia fuori il non fidato che il server dà al fidato senza contenuto', async () => {
  const { letturaCloud } = await import('../../scripts/schede.mjs');
  const riga = (n) => ({ _id: `f${n}`, seq: n, subSeq: 0, status: 'todo', priority: 1, updatedAt: '2026-11-14T10:00:00.000Z', waitsFor: [], unisce: [], schedaAt: '2026-11-13T10:00:00.000Z' });
  const chiama = async () => ({ status: 200, body: { ok: true, resto: [], voci: [
    { num: '900', id: 'f900', riga: riga(900), schedaNonFidata: true },
    { num: '901', id: 'f901', riga: riga(901), nonFidato: true, schedaNonFidata: true },
  ] } });
  const r = await letturaCloud('tk', { chiama });
  assert.deepEqual(r.righe.map((x) => x._id), ['f900'], 'il non fidato non entra nell’indice da scrivere');
  assert.equal(r.nonFidati, 1);
  assert.equal(r.illeggibili, 0, 'una scheda non fidata data senza contenuto non è da riscrivere');
});

test('il manutentore è fidato e non ha web: niente istruzioni di ricerca sul web nel suo ruolo', () => {
  const t = readFileSync(new URL('../../routines/roles/manutentore.md', import.meta.url), 'utf8');
  assert.doesNotMatch(t, /\*\*ricerca\*\*/);
  assert.match(t, /\*\*niente web\*\*/);
  assert.doesNotMatch(t, /è \*\*non fidato\*\*/);
  const r = readFileSync(new URL('../../routines/roles/secaudit.md', import.meta.url), 'utf8');
  assert.match(r, /ciò che il manutentore legge si allarga/);
});
