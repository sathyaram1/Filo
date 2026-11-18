// #2473 giro 1: quando la compattazione non parte, il tetto in token è l'ultima rete; ma taglia solo la conversazione, e
// istruzioni, strumenti e memoria stanno sopra. La richiesta intera deve restare sotto i 100.000 token di Anthropic.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const radice = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const loader = fs.readFileSync(path.join(radice, 'src/main/services/loader.js'), 'utf8');
for (const m of loader.matchAll(/require\(path\.join\(SHARED, '([^']+)'\)\)/g)) {
  try { require(path.join(radice, 'src/shared', m[1])); } catch (_) { /* un modulo che vuole il main */ }
}
const FC = globalThis.SN_FILO_CONTESTO;
const L = globalThis.SN_FILO_COMPATTAZIONE;
// Il rapporto peggiore delle misure col contatore di Anthropic (SPEC-CONTESTO, 07/10): token veri per carattere.
const VERI_PER_CARATTERE = 21700 / 45460;

test('r1 al tetto di serie la richiesta intera della chat resta sotto i 100.000 token di Anthropic', () => {
  const ora = Date.parse('2026-11-18T12:00:00Z');
  const tetti = FC.tetti(null, null);
  const testo = 'Parliamo ancora del viaggio a Lisbona, degli orari dei treni e di cosa vedere. '.repeat(25);
  let tratto = 0;
  for (let n = 60; n <= 140; n++) {
    const lista = Array.from({ length: n }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user', text: testo, chat: 'c1', ts: new Date(ora - (n - i) * 60000).toISOString(),
    }));
    const f = FC.finestra(lista, { ora, giorni: tetti.giorni, token: tetti.token, chatCorrente: 'c1' });
    tratto = Math.max(tratto, FC.caratteriDi(f.messaggi));
  }
  const fissi = JSON.stringify(globalThis.SN_ACTION_TOOLS.definitions()).length
    + globalThis.SN_CONST.PROMPTS.filoChatStatic().length
    + L.USO.parteUtente * FC.CARATTERI_PER_TOKEN;
  const veri = Math.ceil((tratto + fissi) * VERI_PER_CARATTERE);
  expect(veri, `conversazione ${tratto} caratteri, parte fissa ${fissi}: circa ${veri} token per Anthropic`).toBeLessThanOrEqual(100000);
});
