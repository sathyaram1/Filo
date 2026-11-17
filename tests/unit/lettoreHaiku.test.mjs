// Le letture delegate vanno al sotto-agente `lettore`, Haiku e sola lettura (#2122): la misura sta in
// patterns/le-letture-delegate-girano-su-haiku.md. Il modello sta nella definizione perché il lancio può non avere `model`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const leggi = (...p) => readFileSync(resolve(ROOT, ...p), 'utf8').replace(/\r/g, '');

test('il lettore gira su Haiku, legge soltanto e non lancia altri sotto-agenti', () => {
  const testa = /^---\n([\s\S]*?)\n---\n/.exec(leggi('.claude', 'agents', 'lettore.md'));
  assert.ok(testa, 'intestazione YAML presente');
  const campo = (k) => testa[1].split('\n').filter((r) => r.startsWith(`${k}:`)).map((r) => r.slice(k.length + 1).trim());
  assert.deepEqual(campo('name'), ['lettore']);
  assert.deepEqual(campo('model'), ['haiku']);
  assert.deepEqual(campo('tools'), ['Read, Grep, Glob'], 'niente Agent, Bash, Edit o Write: Haiku solo come lettore');
});

test('chi delega una lettura sa che va al lettore, e il giudizio resta a lui', () => {
  const claude = leggi('CLAUDE.md').replace(/\s+/g, ' ');
  assert.match(claude, /Letture e ricerche vanno a `subagent_type: lettore`/);
  assert.match(claude, /il giudizio resta al ruolo/);
  const contratto = leggi('routines', 'roles', '_contratto-worker.md');
  const sezione = ((/^## Sotto-agenti\n([\s\S]*?)(?=^## )/m.exec(contratto) || [])[1] || '').replace(/\s+/g, ' ');
  assert.match(sezione, /va a `subagent_type: lettore`/);
  assert.match(sezione, /Il giudizio .* resta a te/);
  assert.match(leggi('routines', 'roles', 'risposta.md').replace(/\s+/g, ' '), /`subagent_type: lettore`/);
});
