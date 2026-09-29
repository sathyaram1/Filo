// Sentinella del registro delle novità (src/shared/patchNotes.js): ogni riga arriva a chi installa la versione che la
// contiene, e mai a chi non ce l'ha. Il blocco in cima porta il numero della prossima versione; una riga sotto una
// versione già uscita non la vede chi aggiorna da quella versione (#860, #432, #308).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'patchNotes.js'));
const PN = globalThis.SN_PATCH_NOTES;

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

function prossima(v) {
  const [a, b, c] = String(v).split('.').map((n) => parseInt(n, 10) || 0);
  return `${a}.${b}.${c + 1}`;
}

const righe = (n) => [...(n.features || []), ...(n.fixes || [])];
const righeDi = (notes) => notes.flatMap(righe);

// Il registro com'era a un commit: serve la storia del repo, che in un clone parziale può mancare.
function registroA(ref) {
  const src = execFileSync('git', ['show', `${ref}:src/shared/patchNotes.js`],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  const sandbox = {};
  vm.runInNewContext(src, sandbox);
  return sandbox.SN_PATCH_NOTES.NOTES;
}

// Le righe che `dopo` aggiunge rispetto a `prima` sotto le versioni fino a `uscita` compresa. Si contano le righe
// per blocco: riscrivere una riga già uscita o spostarla nel blocco della prossima versione resta lecito.
function aggiunteSottoUscite(prima, dopo, uscita) {
  const vecchie = new Map(prima.map((n) => [n.version, righe(n)]));
  const out = [];
  for (const n of dopo) {
    if (PN.cmpVersion(n.version, uscita) > 0) continue;
    const prec = vecchie.get(n.version) || [];
    if (righe(n).length <= prec.length) continue;
    for (const r of righe(n)) if (!prec.includes(r)) out.push({ version: n.version, riga: r });
  }
  return out;
}

function conNote(notes, fn) {
  const salvate = PN.NOTES.splice(0, PN.NOTES.length, ...notes);
  try { return fn(); } finally { PN.NOTES.splice(0, PN.NOTES.length, ...salvate); }
}

test('si registra su globalThis con la sua API', () => {
  assert.ok(PN, 'SN_PATCH_NOTES assente');
  for (const fn of ['since', 'countBehind', 'latestVersion', 'cmpVersion', 'fotografia', 'recap']) {
    assert.equal(typeof PN[fn], 'function', `manca ${fn}()`);
  }
  assert.ok(Array.isArray(PN.NOTES) && PN.NOTES.length > 0);
});

test('sopra package.json c\'è al massimo il blocco della prossima versione, in cima', () => {
  // Numeri più alti farebbero aspettare le righe oltre la versione che le porta; il salto a 0.3.0 non serve
  // prevederlo: un blocco 0.2.229 cade comunque fra 0.2.228 e 0.3.0.
  const sopra = PN.NOTES.filter((n) => PN.cmpVersion(n.version, pkg.version) > 0);
  assert.ok(sopra.length <= 1,
    `ci sono ${sopra.length} blocchi sopra la versione dell'app (${pkg.version}): ne serve uno solo, ${prossima(pkg.version)}`);
  if (sopra.length) {
    assert.equal(sopra[0], PN.NOTES[0], 'il blocco della prossima versione va in cima al registro');
    assert.equal(sopra[0].version, prossima(pkg.version),
      `il blocco in cima è ${sopra[0].version}, ma la prossima versione dopo ${pkg.version} è ${prossima(pkg.version)}`);
  }
});

test('nessuna riga nuova sotto una versione già uscita (#432)', (t) => {
  // Il confronto è con il punto in cui questo ramo si è staccato da main: sono le righe scritte qui a contare.
  let base = null;
  for (const ref of ['origin/main', 'main']) {
    try {
      base = execFileSync('git', ['merge-base', 'HEAD', ref],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (base) break;
    } catch (_) { base = null; }
  }
  let prima = null;
  if (base) { try { prima = registroA(base); } catch (_) { prima = null; } }
  if (!prima) {
    t.skip('storia del repo assente (né origin/main né main raggiungibili): non so quali righe ha aggiunto questo ramo');
    return;
  }
  const sbagliate = aggiunteSottoUscite(prima, PN.NOTES, pkg.version);
  assert.deepEqual(sbagliate, [],
    `righe aggiunte sotto versioni già uscite (l'app è alla ${pkg.version}): chi ha già quella versione non le vedrà mai. `
    + `Spostale nel blocco ${prossima(pkg.version)} in cima al registro:\n`
    + sbagliate.map((s) => `  ${s.version}: ${s.riga.slice(0, 100)}`).join('\n'));
});

test('la guardia riconosce una riga aggiunta sotto una versione uscita, e solo quella', () => {
  const prima = [
    { version: '0.2.229', features: ['in arrivo'], fixes: [] },
    { version: '0.2.228', features: ['uscita'], fixes: ['corretta'] },
  ];
  const conRiga = (v, riga) => prima.map((n) => (n.version === v ? { ...n, fixes: [...n.fixes, riga] } : n));

  assert.deepEqual(aggiunteSottoUscite(prima, conRiga('0.2.228', 'tardiva'), '0.2.228'),
    [{ version: '0.2.228', riga: 'tardiva' }]);
  assert.deepEqual(aggiunteSottoUscite(prima, conRiga('0.2.229', 'nuova'), '0.2.228'), []);
  // Dopo l'uscita della 0.2.229 lo stesso gesto nel suo blocco diventa l'errore.
  assert.deepEqual(aggiunteSottoUscite(prima, conRiga('0.2.229', 'tardiva'), '0.2.229'),
    [{ version: '0.2.229', riga: 'tardiva' }]);
  // Il gesto di prima del fix: un blocco nuovo col numero di package.json, già uscito.
  const bloccoUscito = [{ version: '0.2.228', features: ['tardiva'], fixes: [] }, ...prima.slice(0, 1)];
  assert.deepEqual(aggiunteSottoUscite([prima[0]], bloccoUscito, '0.2.228'), [{ version: '0.2.228', riga: 'tardiva' }]);
  // Riscrivere il testo o spostare una riga nel blocco della prossima versione non è aggiungere.
  const riscritta = prima.map((n) => (n.version === '0.2.228' ? { ...n, fixes: ['corretta meglio'] } : n));
  assert.deepEqual(aggiunteSottoUscite(prima, riscritta, '0.2.228'), []);
  const spostata = [{ version: '0.2.229', features: ['in arrivo', 'uscita'], fixes: [] },
    { version: '0.2.228', features: [], fixes: ['corretta'] }];
  assert.deepEqual(aggiunteSottoUscite(prima, spostata, '0.2.228'), []);
});

test('chi ha la 0.2.228 vede al prossimo aggiornamento le righe scritte dopo la sua uscita (#860)', () => {
  const dopo = PN.NOTES.filter((n) => PN.cmpVersion(n.version, '0.2.228') > 0);
  assert.ok(dopo.length, 'nessun blocco dopo la 0.2.228: le righe dall\'11/09 in poi sono ancora sotto una versione uscita');
  for (const successiva of ['0.2.229', '0.3.0']) {
    const viste = righeDi(PN.recap('0.2.228', successiva, null));
    for (const attesa of [/anche per Linux/, /Un programma scaricato da un sito/, /Un invito adesso è un link/,
      /aprire un sito da un altro paese/]) {
      assert.ok(viste.some((r) => attesa.test(r)), `aggiornando da 0.2.228 a ${successiva} manca la riga ${attesa}`);
    }
    assert.ok(!viste.some((r) => righeDi(PN.NOTES.filter((n) => PN.cmpVersion(n.version, '0.2.228') <= 0)).includes(r)),
      `aggiornando da 0.2.228 a ${successiva} torna una riga che la 0.2.228 aveva già`);
  }
  assert.ok(!PN.NOTES.some((n) => n.version === '0.2.228'),
    'il blocco 0.2.228 non esisteva quando la 0.2.228 è uscita: una riga lì non la vede nessuno che aggiorna');
});

test('una riga non arriva a chi ha una versione che non la contiene', () => {
  const inArrivo = PN.NOTES.filter((n) => PN.cmpVersion(n.version, pkg.version) > 0);
  const recap = righeDi(PN.recap('0.2.225', pkg.version, null));
  for (const r of righeDi(inArrivo)) assert.ok(!recap.includes(r), `annunciata prima di uscire: ${r.slice(0, 80)}`);
});

test('il conteggio delle novità regge anche se le ultime versioni non hanno voci', () => {
  const oldest = PN.NOTES[PN.NOTES.length - 1].version;
  assert.equal(PN.countBehind(oldest), PN.NOTES.length - 1);
  assert.equal(PN.countBehind(PN.latestVersion()), 0);
});

test('nessun blocco del changelog è vuoto (almeno una feature o un fix)', () => {
  for (const n of PN.NOTES) {
    assert.ok(righe(n).length > 0, `il blocco ${n.version} non ha né features né fixes`);
  }
});

test('le versioni sono ordinate dalla più recente alla più vecchia, senza duplicati', () => {
  for (let i = 1; i < PN.NOTES.length; i++) {
    const prev = PN.NOTES[i - 1].version;
    const cur = PN.NOTES[i].version;
    assert.ok(
      PN.cmpVersion(prev, cur) > 0,
      `ordine/duplicato errato: ${prev} non è strettamente più recente di ${cur}`);
  }
});

test('since() include le note delle versioni attraversate (recap dopo update)', () => {
  const oldV = '0.0.1';
  const notes = PN.since(oldV, pkg.version);
  assert.ok(notes.length > 0, 'un aggiornamento da 0.0.1 dovrebbe avere note da mostrare');
  for (const n of notes) {
    assert.ok(PN.cmpVersion(n.version, oldV) > 0, `${n.version} non dovrebbe comparire (≤ oldSeen)`);
    assert.ok(PN.cmpVersion(n.version, pkg.version) <= 0, `${n.version} non dovrebbe comparire (> current)`);
  }
});

test('la correzione di sicurezza di 0.2.115 è visibile a chi aggiorna da 0.2.114 (feedback #308)', () => {
  const notes = PN.since('0.2.114', '0.2.116');
  assert.ok(notes.length > 0, 'aggiornando da 0.2.114 a 0.2.116 il recap non deve essere vuoto');
  const v115 = notes.find((n) => n.version === '0.2.115');
  assert.ok(v115, 'manca il blocco 0.2.115 (la correzione di sicurezza uscita in quella versione)');
  assert.ok(righe(v115).join(' ').toLowerCase().includes('sicurezza'),
    'il blocco 0.2.115 dovrebbe descrivere la correzione di sicurezza');
});

// Una versione si costruisce dal commit provato dalla suite: una riga fusa mentre la suite girava sta nel blocco di
// quella versione ma arriva con la seguente. Chi aveva quella versione la deve vedere allora, e solo lei.
test('le righe entrate nel blocco di una versione dopo che era uscita arrivano con la versione seguente', () => {
  const uscita = [
    { version: '0.2.229', date: '2026-09-30', features: ['prima novità'], fixes: ['prima correzione'] },
    { version: '0.2.225', date: '2026-09-10', features: ['vecchia'], fixes: [] },
  ];
  const foto = conNote(uscita, () => PN.fotografia('0.2.229'));
  assert.equal(foto.blocco, '0.2.229');
  assert.ok(!JSON.stringify(foto).includes('prima novità'), 'la fotografia salva impronte, non il testo');

  const dopo = [
    { version: '0.2.230', date: '2026-10-01', features: ['novità della 0.2.230'], fixes: [] },
    { version: '0.2.229', date: '2026-09-30', features: ['prima novità', 'fusa durante la suite'],
      fixes: ['prima correzione', 'correzione fusa durante la suite'] },
    { version: '0.2.225', date: '2026-09-10', features: ['vecchia'], fixes: [] },
  ];
  conNote(dopo, () => {
    const notes = PN.recap('0.2.229', '0.2.230', foto);
    assert.deepEqual(notes.flatMap((n) => n.features),
      ['novità della 0.2.230', 'fusa durante la suite']);
    assert.deepEqual(notes.flatMap((n) => n.fixes), ['correzione fusa durante la suite']);

    // Senza fotografia (chi arriva da una versione di prima) resta il conto per numero di versione.
    assert.deepEqual(righeDi(PN.recap('0.2.229', '0.2.230', null)), ['novità della 0.2.230']);
    // Una fotografia d'un'altra versione non vale: quella salvata insieme a lastSeen è l'unica attendibile.
    assert.deepEqual(righeDi(PN.recap('0.2.229', '0.2.230', { ...foto, versione: '0.2.228' })), ['novità della 0.2.230']);
    // Stessa versione: niente da mostrare.
    assert.deepEqual(PN.recap('0.2.230', '0.2.230', PN.fotografia('0.2.230')), []);
  });

  // Se le righe tardive sono state spostate nel blocco successivo, il blocco fotografato non c'è più: nessuna
  // riga vecchia deve tornare a galla.
  conNote([{ version: '0.2.230', features: ['fusa durante la suite'], fixes: [] }, uscita[1]], () => {
    assert.deepEqual(righeDi(PN.recap('0.2.229', '0.2.230', foto)), ['fusa durante la suite']);
  });
});
