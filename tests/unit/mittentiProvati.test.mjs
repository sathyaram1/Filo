// #912 — chi ha scritto un feedback si legge dalla prova, mai dal solo nome. Un nome riservato (owner:, local:,
// routine:, agent:) senza la prova che scrivono l'admin o il server è un utente, in ogni superficie dell'app.
// Il gemello sul server (filo-security, data/identities.js) ha i suoi test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'feedbackStatus.js'));
require(join(ROOT, 'src', 'shared', 'feedbackThread.js'));
require(join(ROOT, 'src', 'shared', 'manageReview.js'));
const TH = globalThis.SN_FEEDBACK_THREAD;
const MR = globalThis.SN_MANAGE_REVIEW;

const CASI = [
  [{ clientId: 'owner:qualcuno' }, 'user'],
  [{ clientId: 'Owner:qualcuno' }, 'user'],
  [{ clientId: 'local:claude' }, 'user'],
  [{ clientId: 'routine:verifier' }, 'user'],
  [{ clientId: 'agent:gemma-4' }, 'user'],
  [{ clientId: 'owner:qualcuno', senderProof: 'owner' }, 'user'],
  [{ clientId: 'routine:verifier', senderProof: 'Server' }, 'user'],
  // Quello che il server lascia sul documento quando rifiuta il nome.
  [{ clientId: 'non-provato:owner:qualcuno' }, 'user'],
  [{ clientId: 'non-provato:routine:verifier', senderProof: 'server' }, 'user'],
  [{ clientId: 'owner:sathya', senderProof: 'admin' }, 'owner'],
  [{ clientId: 'local:claude', senderProof: 'admin' }, 'local'],
  [{ clientId: 'routine:verifier', senderProof: 'server' }, 'verifier'],
  [{ clientId: 'agent:gemma-4', senderProof: 'admin' }, 'claude'],
  [{ clientId: 'filo:chat' }, 'filo'],
  [{ clientId: 'c-utente' }, 'user'],
  [{}, 'user'],
];

test('categoria d’autore, origine e lato della bolla dalla prova, non dal nome', () => {
  for (const [fb, kind] of CASI) {
    const chi = JSON.stringify(fb);
    assert.equal(TH.authorKind(fb), kind, chi);
    const daUtente = kind === 'user' || kind === 'filo';
    if (daUtente) {
      assert.equal(TH.originOf(fb), 'user', chi);
      assert.equal(TH.isFromModel(fb), false, chi);
      assert.equal(TH.isFromOwner(fb), false, chi);
      assert.equal(TH.parse({ ...fb, text: 'x' })[0].role, 'user', chi);
    }
  }
  assert.equal(TH.isFromOwner({ clientId: 'owner:sathya', senderProof: 'admin' }), true);
  assert.equal(TH.parse({ clientId: 'routine:verifier', senderProof: 'server', text: 'x' })[0].role, 'model');
});

test('il mittente efficace dell’app è lo stesso di Gestione e del server', () => {
  for (const [fb] of CASI) assert.equal(TH.senderOf(fb), MR.effectiveClientId(fb), JSON.stringify(fb));
});

// Chi passa il `clientId` grezzo di un feedback a queste funzioni legge il solo nome: è il buco del rilievo di #595.
test('nessuno classifica un feedback passando il clientId grezzo', () => {
  const RE = /\b(authorKind|originOf|isFromModel|isFromOwner)\(\s*[^()]*\.clientId\s*\)/;
  const trovati = [];
  const visita = (dir) => {
    for (const nome of readdirSync(dir)) {
      if (nome === 'node_modules') continue;
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) visita(p);
      else if (/\.(m?js|html)$/.test(nome)) {
        readFileSync(p, 'utf8').split('\n').forEach((riga, i) => {
          if (RE.test(riga)) trovati.push(`${relative(ROOT, p)}:${i + 1}: ${riga.trim()}`);
        });
      }
    }
  };
  for (const d of ['src', 'scripts']) visita(join(ROOT, d));
  assert.deepEqual(trovati, [], 'passa il feedback intero (si legge la prova)');
});
