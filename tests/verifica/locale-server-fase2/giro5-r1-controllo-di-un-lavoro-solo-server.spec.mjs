// Giro 5, rilievo 1: il controllo di sicurezza di un lavoro solo server (ramo dell'app senza commit propri) riceve il
// diff del server, e nessun testo deve dirgli che non c'è niente da giudicare e che il controllo passa. Non apre Filo.

import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const sha = (c) => c.repeat(40);

async function stampaDelControllo() {
  const d = await import(pathToFileURL(join(ROOT, 'scripts', 'dispatch.mjs')).href);
  const bucket = { role: 'secaudit', branch: 'worker/solo-server-1', id: 'fb-solo-server', num: '#1' };
  const diffServer = {
    diff: 'diff --git a/functions/src/routine/fusioneServer.js b/functions/src/routine/fusioneServer.js\n+const urgente = true;\n',
    base: { ref: 'origin/main', sha: sha('c') }, head: sha('d'),
  };
  const appVuota = { ok: true, diff: '', base: { ref: 'origin/main', sha: sha('a') }, head: sha('b'), vuoto: { commitPropri: 0 } };
  const ctx = d.serverCtx(bucket, { payload: { diffServer } }, appVuota);
  return { payload: d.buildPayload(bucket, ctx), istruzioni: d.readRoleInstructions('secaudit', {}) };
}

test('r1 lavoro solo server: la spiegazione del diff vuoto non dice che il lavoro non porta modifiche', async () => {
  const { payload } = await stampaDelControllo();
  expect(payload.diffServer, 'il diff del server arriva al controllo').toContain('fusioneServer.js');
  expect(payload.diffVuoto || '').not.toMatch(/non porta nessuna modifica/);
});

test('r1 lavoro solo server: la regola del diff vuoto non fa passare il controllo quando c’è il diff del server', async () => {
  const { istruzioni } = await stampaDelControllo();
  const paragrafo = istruzioni.split(/\n(?=- |\n)/).find((p) => /Un diff \*\*vuoto\*\*/.test(p)) || '';
  expect(paragrafo, 'la regola del diff vuoto c’è').not.toBe('');
  expect(paragrafo).toMatch(/server/i);
});
