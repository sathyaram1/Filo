// #578.1 — l'attesa dell'Aiuto sui siti non inventa frasi, e le regole dello stop sono quelle della chat della home,
// scritte in un posto solo. Il comportamento vero lo prova tests/aiuto-attesa.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leggi = (p) => readFileSync(join(ROOT, p), 'utf8');

test('l\'Aiuto non ha più l\'elenco di frasi fisse che scorrevano mentre lavorava', () => {
  const s = leggi('src/content/sidebar.js');
  assert.doesNotMatch(s, /THINKING_PHRASES|appendThinking/);
  for (const f of ['Analizzo lo screenshot', 'Controllo la struttura del DOM', 'Identifico gli elementi interattivi',
    'Riconosco i pattern noti', 'Stimo cosa serve']) {
    assert.ok(!s.includes(f), `frase fissa rimasta: ${f}`);
  }
  assert.doesNotMatch(leggi('src/styles/sidebar.css'), /sn-sidebar-thinking/);
});

test('le righe del lavoro fermato e la pausa del quadrato vivono in un posto solo', async () => {
  globalThis.self = globalThis;
  await import(pathToFileURL(join(ROOT, 'src/shared/chatErrors.js')).href);
  await import(pathToFileURL(join(ROOT, 'src/shared/constants.js')).href);
  const CE = globalThis.SN_CHAT_ERRORS;
  assert.equal(typeof CE.FERMATO_QUI, 'string');
  assert.equal(typeof CE.FERMATO_PRIMA, 'string');
  assert.ok(globalThis.SN_CONST.PAUSA_QUADRATO_MS > 0);
  for (const f of ['src/content/sidebar.js', 'src/pages/dashboard/dashboard.js', 'src/pages/dashboard/dashboard-attivita.js']) {
    const s = leggi(f);
    assert.ok(!s.includes(`'${CE.FERMATO_QUI}'`) && !s.includes(`'${CE.FERMATO_PRIMA}'`), `${f} riscrive una riga dello stop`);
    assert.doesNotMatch(s, /PAUSA_QUADRATO\s*=\s*\d/, `${f} riscrive la pausa del quadrato`);
  }
});
