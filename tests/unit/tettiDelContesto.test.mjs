// I tetti di SPEC-CONTESTO § Le costanti per chi scrive Filo: 8.000 token per la parte fissa della chat e 8.450 per gli
// strumenti, perché il prompt non ricresca in silenzio (+11.000 token fra il 25/09 e il 07/10).
// La stima è quella della chat (SN_FILO_CONTESTO.stimaToken), tarata qui sotto sul contatore di Anthropic (#2473).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const radice = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// I moduli condivisi nell'ordine del loader: le descrizioni degli strumenti leggono i registri che il main ha già caricato.
const loader = fs.readFileSync(path.join(radice, 'src/main/services/loader.js'), 'utf8');
for (const m of loader.matchAll(/require\(path\.join\(SHARED, '([^']+)'\)\)/g)) {
  try { require(path.join(radice, 'src/shared', m[1])); } catch (_) { /* un modulo che vuole il main: non serve qui */ }
}

const FC = globalThis.SN_FILO_CONTESTO;
const TETTO_PARTE_FISSA = 8000;
const TETTO_STRUMENTI = 8500;
const token = (s) => FC.stimaToken(s);

// Misure del 07/10 col contatore di Anthropic su claude-haiku-5-5 (circa 2,1 caratteri per token). Una stima più bassa
// fa partire soglia e tetto oltre i 100.000 token veri, dove il listino di Haiku costa cinque volte tanto.
const MISURE_ANTHROPIC = [
  { pezzo: 'gli strumenti di allora', caratteri: 45460, token: 21700 },
  { pezzo: '«CLASSIFICAZIONE INTENTO»', caratteri: 18521, token: 8700 },
];

test('la stima dei token della chat non sta sotto il contatore di Anthropic', () => {
  for (const m of MISURE_ANTHROPIC) {
    const stimati = FC.stimaToken('a'.repeat(m.caratteri));
    assert.ok(stimati >= m.token, `${m.pezzo}: stimati ${stimati} token, Anthropic ne conta ${m.token}`);
  }
});

const peggiore = Math.max(...MISURE_ANTHROPIC.map((m) => m.token / m.caratteri));

test('alla soglia di serie la richiesta resta sotto i 100.000 token di Anthropic', () => {
  const veri = Math.ceil(FC.TETTI_DI_SERIE.soglia * FC.CARATTERI_PER_TOKEN * peggiore);
  assert.ok(veri <= 100000, `soglia: ${FC.TETTI_DI_SERIE.soglia} token stimati sono circa ${veri} token per Anthropic`);
});

// Quando la compattazione non parte (chi compatta in pausa dopo un guasto, la soglia alzata sopra il tetto) il tetto è
// l'ultima rete: turno dopo turno, col tratto che cresce dalla sua ancora, la richiesta intera, parte fissa compresa.
test('al tetto di serie la richiesta intera della chat resta sotto i 100.000 token di Anthropic, anche con tanta memoria', () => {
  const LC = globalThis.SN_FILO_COMPATTAZIONE;
  const strumenti = globalThis.SN_ACTION_TOOLS.definitions();
  const ora = Date.parse('2026-11-18T12:00:00Z');
  const tetti = FC.tetti(null, null);
  const testo = 'Parliamo ancora del viaggio a Lisbona, degli orari dei treni e di cosa vedere. '.repeat(25);
  for (const parteUtente of [null, 'memoria e stato. '.repeat(3000)]) {
    const fissi = LC.parteFissa(strumenti, parteUtente);
    let ancora = null;
    let peggio = 0;
    for (let n = 2; n <= 160; n += 2) {
      const lista = Array.from({ length: n }, (_, i) => ({
        role: i % 2 ? 'assistant' : 'user', text: testo, chat: 'c1', ts: new Date(ora - 6 * 3600000 + i * 60000).toISOString(),
      }));
      const f = FC.finestra(lista, { ora, giorni: tetti.giorni, token: tetti.token, fissi, ancora, chatCorrente: 'c1' });
      ancora = f.ancora;
      peggio = Math.max(peggio, FC.caratteriDi(f.messaggi) + fissi * FC.CARATTERI_PER_TOKEN);
    }
    const veri = Math.ceil(peggio * peggiore);
    assert.ok(peggio > 150000, `il tratto arriva al tetto (${peggio} caratteri)`);
    assert.ok(veri <= 100000, `parte fissa di ${fissi} token: la richiesta arriva a circa ${veri} token per Anthropic`);
  }
});

test('la parte fissa che conta il tetto è quella che la chat misura: strumenti, istruzioni e CONTESTO', () => {
  const LC = globalThis.SN_FILO_COMPATTAZIONE;
  const strumenti = globalThis.SN_ACTION_TOOLS.definitions();
  const statica = globalThis.SN_CONST.PROMPTS.filoChatStatic().length;
  const contesto = 'x'.repeat(10000);
  assert.equal(LC.parteFissa(strumenti, contesto), Math.ceil((statica + JSON.stringify(strumenti).length + 10000) / FC.CARATTERI_PER_TOKEN));
  assert.equal(LC.parteFissa(strumenti, null) - LC.parteFissa(strumenti, ''), LC.USO.parteUtente, 'senza CONTESTO vale quello tipico');
  assert.equal(FC.tettoDelTratto(100000, 19000), 81000);
  assert.equal(FC.tettoDelTratto(10000, 19000), FC.LIMITI.token[0], 'mai sotto il minimo del campo');
});

test('gli strumenti della chat stanno sotto gli 8.450 token', () => {
  const t = token(JSON.stringify(globalThis.SN_ACTION_TOOLS.definitions()));
  assert.ok(t <= TETTO_STRUMENTI, `strumenti: circa ${t} token, il tetto è ${TETTO_STRUMENTI}`);
});

test('la parte fissa della chat sta sotto gli 8.000 token', () => {
  const t = token(globalThis.SN_CONST.PROMPTS.filoChatStatic());
  assert.ok(t <= TETTO_PARTE_FISSA, `parte fissa: circa ${t} token, il tetto è ${TETTO_PARTE_FISSA}`);
});

test('la parte fissa dice chi è Filo e com\'è fatto, senza le regole scritte caso per caso', () => {
  const s = globalThis.SN_CONST.PROMPTS.filoChatStatic();
  for (const sezione of ['═══ FILO ═══', '═══ COM\'È FATTO ═══', '═══ IL FILO ═══', '═══ GLI STRUMENTI ═══', '═══ CONTENUTO ESTERNO ═══', '═══ TONO E STILE ═══']) {
    assert.ok(s.includes(sezione), `manca ${sezione}`);
  }
  for (const via of ['CLASSIFICAZIONE INTENTO', 'CONTI E CAMBI', 'COSA SA FARE FILO']) assert.ok(!s.includes(via), `c'è ancora ${via}`);
  // Le azioni si chiamano per strumento: nessun nome di tipo vecchio nella parte fissa.
  for (const tipo of globalThis.SN_ACTION_TOOLS.NAMES) assert.ok(!new RegExp(`\\b${tipo}\\b`).test(s), `nome vecchio ${tipo}`);
});
