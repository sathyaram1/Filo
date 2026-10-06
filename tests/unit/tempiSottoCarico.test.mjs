// Sentinella (#943): negli unit test il tempo di un lavoro sincrono non si confronta con millisecondi fissi, perché gli
// unit girano in parallelo e su una macchina carica la soglia cade senza che il codice sia cambiato. Si chiede a
// costoInUnita (tests/helpers/tempoRelativo.mjs); racconto in patterns/un-test-chiede-al-sistema-non-presume-quello-su-cui-e-nato.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { collectTestFiles } from '../../scripts/run-unit-tests.mjs';
import { costoInUnita, rapportoFraCosti, unitaDiRiferimento, GIRI } from '../helpers/tempoRelativo.mjs';

const QUI = fileURLToPath(import.meta.url);
const ROOT = join(dirname(QUI), '..', '..');

const NUMERO = String.raw`\d[\d_]*(?:\.\d+)?(?:e\d+)?`;
const INIZIO = /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:Date|performance)\.now\(\)/g;

/** Le righe in cui un tempo misurato senza `await` in mezzo (un timer atteso misura il timer) finisce contro un numero. */
function confrontiFissi(testo) {
  const righe = new Set();
  const riga = (i) => testo.slice(0, i).split('\n').length;
  for (const m of testo.matchAll(INIZIO)) {
    const da = m.index + m[0].length;
    const fine = new RegExp(String.raw`(?:Date|performance)\.now\(\)\s*-\s*${m[1]}\b`, 'g');
    fine.lastIndex = da;
    const f = fine.exec(testo);
    if (!f || /\bawait\b/.test(testo.slice(da, f.index))) continue;
    const dopo = testo.slice(f.index + f[0].length);
    const prima = testo.slice(Math.max(0, f.index - 40), f.index);
    if (new RegExp(String.raw`^\s*\)?\s*<=?\s*${NUMERO}`).test(dopo) || new RegExp(String.raw`${NUMERO}\s*>=?\s*\(?\s*$`).test(prima)) {
      righe.add(riga(f.index));
      continue;
    }
    const nome = /\b(?:const|let|var)\s+(\w+)\s*=\s*\(?\s*$/.exec(prima)?.[1];
    if (!nome) continue;
    const seguito = dopo.split('\n').slice(0, 15).join('\n');
    const uso = new RegExp(String.raw`\b${nome}\s*<=?\s*${NUMERO}|${NUMERO}\s*>=?\s*${nome}\b`).exec(seguito);
    if (uso) righe.add(riga(f.index + f[0].length + uso.index));
  }
  return [...righe];
}

test('nessuno unit test confronta il tempo di un lavoro sincrono con millisecondi fissi', () => {
  const fuori = [];
  for (const file of collectTestFiles(join(ROOT, 'tests', 'unit'))) {
    if (file === QUI) continue;
    for (const r of confrontiFissi(readFileSync(file, 'utf8'))) fuori.push(`${relative(ROOT, file).replace(/\\/g, '/')}:${r}`);
  }
  assert.deepEqual(fuori, [], 'su una macchina carica queste soglie cadono: misurale con costoInUnita (tests/helpers/tempoRelativo.mjs)');
});

test('la sentinella riconosce le forme della soglia fissa, e lascia stare i timer attesi e i costi relativi', () => {
  const casi = {
    'const t = Date.now();\nlavora();\nassert.ok(Date.now() - t < 1500, `${Date.now() - t} ms`);': [3],
    'const t0 = performance.now();\nconst h = render(x);\nconst ms = performance.now() - t0;\nassert.ok(ms < 1000);': [4],
    'const t0 = Date.now();\nf();\nconst quanto = Date.now() - t0;\nassert.ok(quanto <= 1_000);': [4],
    'const t0 = Date.now();\nf();\nassert.ok((Date.now() - t0) < 2e3);': [3],
    'const t0 = Date.now();\nf();\nassert.ok(2000 > Date.now() - t0);': [3],
    'const t0 = Date.now();\nawait D.detonate(u);\nassert.ok(Date.now() - t0 < 2000);': [],
    'const t0 = Date.now();\nf();\nassert.ok(Date.now() - t0 < Appunti.ATTESA_MS);': [],
    'const c = costoInUnita(() => f(), { tetto: 10 });\nassert.ok(c.entro, c.come);': [],
    'const t0 = performance.now();\nf();\nconst ms = performance.now() - t0;\nassert.ok(ms < altro * 3);': [],
  };
  for (const [testo, atteso] of Object.entries(casi)) assert.deepEqual(confrontiFissi(testo), atteso, testo);
});

// Un processo vero sotto carico parte quando può (#1063): il suo tempo massimo è una guardia contro l'appeso, non una
// misura, e si chiede a TETTO_ATTESA_MS (tests/helpers/attese.mjs). Un numero scritto lì cadeva a macchina carica.
const TETTO_A_MANO = /\b(?:spawnSync|execFileSync|execSync|spawn|execFile|exec)\s*\([^;]*?\btimeout:\s*\d/;

test('nessuno unit test dà a un processo vero un tempo massimo scritto a mano', () => {
  assert.ok(TETTO_A_MANO.test("spawnSync(process.execPath, ['x'], { encoding: 'utf8', timeout: 60_000 });"));
  assert.ok(TETTO_A_MANO.test('execFileSync(node, [\n  a,\n], { timeout: 20000 })'));
  assert.ok(!TETTO_A_MANO.test("spawnSync(process.execPath, ['x'], { timeout: TETTO_ATTESA_MS });"));
  const fuori = [];
  for (const file of collectTestFiles(join(ROOT, 'tests', 'unit'))) {
    if (file === QUI) continue;
    if (TETTO_A_MANO.test(readFileSync(file, 'utf8'))) fuori.push(relative(ROOT, file).split(sep).join('/'));
  }
  assert.deepEqual(fuori, [], 'usa TETTO_ATTESA_MS da tests/helpers/attese.mjs: sotto carico un tetto stretto è un rosso finto');
});

// Un orologio finto: ogni chiamata avanza del costo che le si dà, così il conto si prova senza misurare niente.
function banco(costiOp, costiRif) {
  let adesso = 0;
  let iOp = 0;
  let iRif = 0;
  return {
    ora: () => adesso,
    op: () => { adesso += costiOp[Math.min(iOp++, costiOp.length - 1)]; },
    riferimento: () => { adesso += costiRif[Math.min(iRif++, costiRif.length - 1)]; },
  };
}

test('un costo nel tetto basta un giro; uno lento a ogni giro resta fuori dopo tutti i giri', () => {
  const svelto = banco([30], [10]);
  const a = costoInUnita(svelto.op, { tetto: 10, ora: svelto.ora, riferimento: svelto.riferimento });
  assert.deepEqual([a.entro, a.unita, a.giri], [true, 3, 1]);

  const lento = banco([500], [10]);
  const b = costoInUnita(lento.op, { tetto: 10, ora: lento.ora, riferimento: lento.riferimento });
  assert.deepEqual([b.entro, b.unita, b.giri], [false, 50, GIRI]);
  assert.match(b.come, /50\.0 unità di riferimento \(tetto 10\)/);
});

test('un carico passeggero su un giro non fa cadere la prova, e il carico visto dal riferimento conta', () => {
  const raffica = banco([900, 30], [10]);
  const a = costoInUnita(raffica.op, { tetto: 10, ora: raffica.ora, riferimento: raffica.riferimento });
  assert.deepEqual([a.entro, a.unita, a.giri], [true, 3, 2]);

  // Il carico arriva durante l'operazione e lo vede anche il riferimento dopo: vale il riferimento più lento.
  const carica = banco([300], [10, 30]);
  const b = costoInUnita(carica.op, { tetto: 10, ora: carica.ora, riferimento: carica.riferimento });
  assert.deepEqual([b.entro, b.unita, b.giri], [true, 10, 1]);
});

test("l'unità di riferimento fa davvero del lavoro e dura abbastanza da stare sopra l'imprecisione dell'orologio", () => {
  assert.ok(unitaDiRiferimento() > 0);
  const c = costoInUnita(() => {}, { tetto: 1 });
  assert.ok(c.msRif >= 1, c.come);
});

// Due lavori asincroni su un orologio finto: ogni chiamata avanza del costo che le tocca, nell'ordine.
function coppia(costiA, costiB) {
  let adesso = 0;
  let iA = 0;
  let iB = 0;
  return {
    ora: () => adesso,
    a: async () => { adesso += costiA[Math.min(iA++, costiA.length - 1)]; },
    b: async () => { adesso += costiB[Math.min(iB++, costiB.length - 1)]; },
  };
}

test('rapportoFraCosti: un carico passeggero su qualche campione non conta, un costo che cresce davvero sì', async () => {
  const pari = coppia([10], [900, 12, 800]);
  const a = await rapportoFraCosti(pari.a, pari.b, { tetto: 3, ora: pari.ora });
  assert.deepEqual([a.entro, a.rapporto, a.giri], [true, 1.2, 1]);

  const cresce = coppia([10], [50]);
  const b = await rapportoFraCosti(cresce.a, cresce.b, { tetto: 3, ora: cresce.ora });
  assert.deepEqual([b.entro, b.rapporto, b.giri], [false, 5, GIRI]);
  assert.match(b.come, /5\.00 volte \(tetto 3\)/);
});

test('rapportoFraCosti misura i due lavori a turno, non uno tutto e poi l’altro', async () => {
  const ordine = [];
  await rapportoFraCosti(async () => { ordine.push('a'); }, async () => { ordine.push('b'); }, { campioni: 4 });
  assert.equal(ordine.join(''), 'abbaabba');
});
