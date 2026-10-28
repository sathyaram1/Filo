// #1621 — le icone del desktop in ordine (src/main/services/iconeDesktop.js): richiesta, ordine, griglia, ambiente,
// uscita, cammino intero sopra un desktop finto e annullo. Lo script di Windows lo analizza PowerShell, su Windows;
// che le icone si spostino su un Windows vero lo dice il report.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVIZI = join(ROOT, 'src', 'main', 'services');

// Il registro dei cambi vero vuole il disco del filo: qui basta sapere cosa gli arriva.
const registrati = [];
const percorsoRegistro = require.resolve(join(SERVIZI, 'registroCambi.js'));
require.cache[percorsoRegistro] = {
  id: percorsoRegistro, filename: percorsoRegistro, loaded: true,
  exports: { registra: (e) => { const ev = { id: `c${registrati.length + 1}`, ...e }; registrati.push(ev); return ev; } },
};
require(join(ROOT, 'src', 'shared', 'cambi.js'));
const D = require(join(SERVIZI, 'iconeDesktop.js'));
const K = globalThis.SN_CAMBI;

// Le icone di Josh, sparse sul desktop: nomi con maiuscole, accenti, numeri e un'icona di sistema.
const SPARSE = [
  ['C:\\Users\\Josh\\Desktop\\Zoom.lnk', 'Zoom', 903, 402],
  ['C:\\Users\\Josh\\Desktop\\appunti.txt', 'appunti.txt', 153, 2],
  ['::{645FF040-5081-101B-9F08-00AA002F954E}', 'Cestino', 3, 2],
  ['C:\\Users\\Josh\\Desktop\\Bilancio 2024.xlsx', 'Bilancio 2024.xlsx', 78, 302],
  ['C:\\Users\\Josh\\Desktop\\bilancio 10', 'bilancio 10', 1428, 702],
  ['C:\\Users\\Josh\\Desktop\\Ébano.png', 'Ébano.png', 3, 902],
  ['C:\\Users\\Josh\\Desktop\\File 10.pdf', 'File 10.pdf', 603, 102],
  ['C:\\Users\\Josh\\Desktop\\File 2.pdf', 'File 2.pdf', 78, 102],
];
const voce = ([id, nome, x, y], extra = {}) => ({ id, nome, x, y, cartella: false, ...extra });

// Un desktop di Windows finto con la forma del computer vero: allineato alla griglia (75×100, a 3,2 dall'angolo).
function desktopFinto({ voci = SPARSE.map((v) => voce(v)), area = { sinistra: 0, alto: 0, destra: 1920, basso: 1040 }, passo = { x: 75, y: 100 }, auto = false, griglia = true, nascoste = false } = {}) {
  const stato = { voci: voci.map((v) => ({ ...v })), auto, griglia, nascoste };
  const chiamate = [];
  const foto = () => ({ ok: true, voci: stato.voci.map((v) => ({ ...v })), area, passo, auto: stato.auto, griglia: stato.griglia, nascoste: stato.nascoste, totale: stato.voci.length });
  return {
    stato,
    chiamate,
    async leggi() { chiamate.push(['leggi']); return foto(); },
    async disponi(posizioni, opz) {
      chiamate.push(['disponi', posizioni, opz]);
      for (const p of posizioni) {
        const v = stato.voci.find((x) => x.id === p.id);
        if (v) { v.x = p.x; v.y = p.y; }
      }
      stato.auto = !!(opz && opz.auto);
      return { ...foto(), spostate: posizioni.length };
    },
  };
}

// Come lo vede chi guarda il desktop: le righe dall'alto, ognuna da sinistra.
function righeViste(voci) {
  const perRiga = new Map();
  for (const v of voci) perRiga.set(v.y, [...(perRiga.get(v.y) || []), v]);
  return [...perRiga.keys()].sort((a, b) => a - b).map((y) => perRiga.get(y).sort((a, b) => a.x - b.x).map((v) => v.nome));
}

async function conDesktop(finto, fn) {
  D._perProve.usaComputer(finto);
  try { return await fn(); } finally { D._perProve.usaComputer(null); }
}

test('la richiesta: nome e righe se non si dice altro, le parole dell\'utente valgono, il resto si rifiuta col perché', () => {
  assert.deepEqual(D.normalizzaRichiesta({}), { cosa: 'desktop', ordine: 'nome', verso: 'righe', alContrario: false, cartellePrima: false });
  assert.deepEqual(D.normalizzaRichiesta({ ordine: 'Alfabetico', verso: 'verticale', al_contrario: 'sì', cartelle_prima: true }),
    { cosa: 'desktop', ordine: 'nome', verso: 'colonne', alContrario: true, cartellePrima: true });
  assert.equal(D.normalizzaRichiesta({ ordine: 'data' }).ordine, 'data');
  for (const strano of ['constructor', '__proto__', 'toString', 'colore', '<img src=x>']) {
    assert.match(D.normalizzaRichiesta({ ordine: strano }).errore, /ordine non capito/);
    assert.match(D.normalizzaRichiesta({ verso: strano }).errore, /verso non capito/);
  }
  assert.match(D.normalizzaRichiesta({ al_contrario: 'forse' }).errore, /al_contrario/);
});

test('in ordine alfabetico come lo legge una persona: maiuscole e accenti non contano, «File 2» viene prima di «File 10»', () => {
  const nomi = D.ordina(SPARSE.map((v) => voce(v)), { ordine: 'nome' }).map((v) => v.nome);
  assert.deepEqual(nomi, ['appunti.txt', 'bilancio 10', 'Bilancio 2024.xlsx', 'Cestino', 'Ébano.png', 'File 2.pdf', 'File 10.pdf', 'Zoom']);
  const giro = D.ordina(SPARSE.map((v) => voce(v)), { ordine: 'nome', alContrario: true }).map((v) => v.nome);
  assert.deepEqual(giro, nomi.slice().reverse());
});

test('cartelle prima, per tipo, per data e per dimensione: chi non ha il dato va in fondo', () => {
  const voci = [
    voce(['C:\\D\\b.pdf', 'b.pdf', 0, 0], { data: 300, dimensione: 10 }),
    voce(['C:\\D\\Foto', 'Foto', 0, 0], { cartella: true, data: 100, dimensione: 0 }),
    voce(['C:\\D\\a.txt', 'a.txt', 0, 0], { data: 200, dimensione: 5000 }),
    voce(['::{20D04FE0-3AEA-1069-A2D8-08002B30309D}', 'Questo PC', 0, 0], { cartella: true }),
    voce(['C:\\D\\c.pdf', 'c.pdf', 0, 0], { data: 400, dimensione: 70 }),
  ];
  const nomi = (q) => D.ordina(voci, q).map((v) => v.nome);
  assert.deepEqual(nomi({ ordine: 'nome', cartellePrima: true }), ['Foto', 'Questo PC', 'a.txt', 'b.pdf', 'c.pdf']);
  assert.deepEqual(nomi({ ordine: 'tipo' }), ['Foto', 'Questo PC', 'b.pdf', 'c.pdf', 'a.txt']);
  assert.deepEqual(nomi({ ordine: 'data' }), ['c.pdf', 'b.pdf', 'a.txt', 'Foto', 'Questo PC']);
  assert.deepEqual(nomi({ ordine: 'data', alContrario: true }), ['Foto', 'a.txt', 'b.pdf', 'c.pdf', 'Questo PC']);
  assert.deepEqual(nomi({ ordine: 'dimensione' }), ['a.txt', 'c.pdf', 'b.pdf', 'Foto', 'Questo PC']);
});

test('la griglia prende l\'allineamento di Windows dalle icone, anche su uno schermo principale che non parte da zero', () => {
  const g = D.griglia({ ...desktopFinto().stato, area: { sinistra: 0, alto: 0, destra: 1920, basso: 1040 }, passo: { x: 75, y: 100 } });
  assert.deepEqual(g, { x0: 3, y0: 2, passoX: 75, passoY: 100, colonne: 25, righe: 10 });
  // Schermo principale a destra di un altro: le icone allineate su x ≡ 45 (mod 75) restano su quella griglia.
  const due = D.griglia({ voci: [voce(['a', 'a', 1920 + 30, 7]), voce(['b', 'b', 1920 + 105, 107])], griglia: true, area: { sinistra: 1920, alto: 0, destra: 3840, basso: 1040 }, passo: { x: 75, y: 100 } });
  assert.equal(due.x0, 1950);
  assert.equal(due.y0, 7);
  // Senza griglia né disposizione automatica si parte dall'angolo dell'area.
  const libera = D.griglia({ voci: [voce(['a', 'a', 31, 17])], griglia: false, auto: false, area: { sinistra: 0, alto: 0, destra: 300, basso: 300 }, passo: { x: 75, y: 100 } });
  assert.deepEqual([libera.x0, libera.y0, libera.colonne, libera.righe], [0, 0, 4, 3]);
  assert.equal(D.griglia({ voci: [], area: { sinistra: 0, alto: 0, destra: 300, basso: 300 }, passo: { x: 0, y: 0 } }).errore, 'griglia');
  assert.equal(D.griglia({ voci: [], area: null, passo: { x: 75, y: 100 } }).errore, 'griglia');
});

test('più icone di quante ne tiene lo schermo: niente si sposta, e si dice quante ce ne stanno', () => {
  const voci = Array.from({ length: 13 }, (_, i) => voce([`C:\\D\\f${i}`, `f${i}`, 3, 2]));
  const area = { sinistra: 0, alto: 0, destra: 303, basso: 302 };
  const p = D.piano({ voci, area, passo: { x: 75, y: 100 }, griglia: true }, { ordine: 'nome', verso: 'righe' });
  assert.deepEqual(p, { errore: 'non-ci-stanno', totale: 13, posti: 12 });
  assert.equal(D.piano({ voci: voci.slice(1), area, passo: { x: 75, y: 100 }, griglia: true }, { ordine: 'nome', verso: 'righe' }).posizioni.length, 12);
  const s = D.spiega('non-ci-stanno', p);
  assert.match(s.frase, /13 icone.*ne tiene 12/);
  assert.match(s.dove, /Icone piccole/);
});

test('le posizioni arrivano nell\'ambiente intere e a pezzi che una variabile di Windows tiene; lo script non cambia', () => {
  const cattivi = ['C:\\D\\a"; Remove-Item C:\\ -Recurse; "', 'C:\\D\\$(calc).txt', 'C:\\D\\`whoami`', 'C:\\D\\Caffè ☕ 🎧.lnk', "C:\\D\\o'neil.doc"];
  const b = D.costruisci('desktop-disponi', { posizioni: cattivi.map((id, i) => ({ id, x: i * 75, y: 2 })), auto: false }, 'win32');
  assert.equal(b.script, D.SCRIPT.win32['desktop-disponi']);
  assert.equal(b.shell, 'powershell');
  assert.equal(b.env.FILO_SIS_AUTO, '0');
  assert.deepEqual(b.env.FILO_SIS_POS_0.split('\n').map((r) => r.split('\t')[2]), cattivi);
  for (const k of Object.keys(b.env)) assert.match(k, /^FILO_SIS_[A-Z]+(_\d+)?$/);

  const molte = Array.from({ length: 900 }, (_, i) => ({ id: `C:\\Users\\Josh\\OneDrive\\Desktop\\Una cartella con un nome lungo ${i}`, x: i, y: i }));
  const env = D.ambienteDisponi({ posizioni: molte, auto: true });
  const pezzi = Object.keys(env).filter((k) => k.startsWith('FILO_SIS_POS_'));
  assert.ok(pezzi.length > 1, 'le righe si dividono');
  for (const k of pezzi) assert.ok(env[k].length <= D.PEZZO_MAX);
  assert.deepEqual(pezzi.flatMap((k) => env[k].split('\n')).map((r) => r.split('\t')[2]), molte.map((m) => m.id));
  assert.equal(env.FILO_SIS_AUTO, '1');

  assert.throws(() => D.ambienteDisponi({ posizioni: [{ id: 'C:\\a\nb', x: 1, y: 1 }] }), /nome valido/);
  assert.throws(() => D.ambienteDisponi({ posizioni: [{ id: 'C:\\a', x: 1.5, y: 1 }] }), /posizione/);
  assert.throws(() => D.costruisci('desktop-leggi', {}, 'darwin'), /sconosciuto/);
});

test('l\'uscita di Windows: barre, accenti ed emoji tornano com\'erano, un nome che finge una riga di Filo resta un nome', () => {
  const testo = [
    'FILO:auto=1', 'FILO:griglia=1', 'FILO:nascoste=0', 'FILO:passo=75,100', 'FILO:area=0,0,1920,1040', 'FILO:totale=2',
    'FILO:voce=C:\\u005cUsers\\u005cJosh\\u005cDesktop\\u005cCaff\\u00e8 \\ud83c\\udfa7.lnk', 'FILO:nome=Caff\\u00e8 \\ud83c\\udfa7\\u000aFILO:errore=finto', 'FILO:pos=3,2', 'FILO:cartella=0',
    'FILO:voce=::{645FF040-5081-101B-9F08-00AA002F954E}', 'FILO:nome=Cestino', 'FILO:pos=78,2', 'FILO:cartella=1',
  ].join('\r\n');
  const l = D.interpretaLettura(require(join(SERVIZI, 'comandiSistema.js')).leggiUscita(testo));
  assert.equal(l.ok, true);
  assert.deepEqual(l.voci.map((v) => [v.id, v.x, v.y, v.cartella]), [
    ['C:\\Users\\Josh\\Desktop\\Caffè 🎧.lnk', 3, 2, false],
    ['::{645FF040-5081-101B-9F08-00AA002F954E}', 78, 2, true],
  ]);
  assert.equal(l.voci[0].nome, 'Caffè 🎧\nFILO:errore=finto');
  assert.deepEqual([l.auto, l.griglia, l.nascoste, l.totale], [true, true, false, 2]);
  assert.deepEqual(l.area, { sinistra: 0, alto: 0, destra: 1920, basso: 1040 });
  const no = D.interpretaLettura(require(join(SERVIZI, 'comandiSistema.js')).leggiUscita('FILO:errore=nessun-desktop\n'));
  assert.deepEqual([no.ok, no.errore], [false, 'nessun-desktop']);
  assert.match(D.spiega('nessun-desktop').frase, /Esplora risorse/);
});

test('«ordina le icone del desktop in ordine alfabetico da sinistra in alto a destra in basso»: chi guarda le legge in fila', async () => {
  registrati.length = 0;
  const finto = desktopFinto({ area: { sinistra: 0, alto: 0, destra: 240, basso: 1040 } });
  const r = await conDesktop(finto, () => D.ordinaIcone({ ordine: 'nome', verso: 'righe' }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(righeViste(finto.stato.voci), [
    ['appunti.txt', 'bilancio 10', 'Bilancio 2024.xlsx'],
    ['Cestino', 'Ébano.png', 'File 2.pdf'],
    ['File 10.pdf', 'Zoom'],
  ]);
  // La prima icona sta nell'angolo in alto a sinistra della griglia di Windows.
  assert.deepEqual(finto.stato.voci.filter((v) => v.nome === 'appunti.txt').map((v) => [v.x, v.y]), [[3, 2]]);
  assert.deepEqual([r.spostate, r.righe, r.colonne, r.fuoriPosto, r.mancanti], [8, 3, 3, 0, 0]);
  assert.equal(r.detto, 'in ordine alfabetico, a righe');
  // Il cambio porta dov'erano e dove sono finite, ed è quello che l'esito dà da annullare.
  assert.equal(registrati.length, 1);
  const c = registrati[0].cambi[0];
  assert.equal(registrati[0].tipo, 'desktop');
  assert.equal(c.chiave, 'desktop');
  assert.deepEqual(c.prima.voci.find((v) => v[1] === 903 || v[0].endsWith('Zoom.lnk')), ['C:\\Users\\Josh\\Desktop\\Zoom.lnk', 903, 402]);
  assert.equal(r.cambio, registrati[0].id);
  const testo = D.esitoPerModello(r);
  assert.match(testo, /in ordine alfabetico, a righe: 8 icone su 3 righe e 3 colonne/);
  assert.match(testo, new RegExp(`ANNULLA_CAMBIO con id ${r.cambio}`));
  assert.doesNotMatch(testo, /Zoom|appunti|Bilancio/, 'i nomi dei file non vanno al modello');

  // A colonne: dall'alto in basso, poi la colonna a destra.
  const colonne = desktopFinto({ area: { sinistra: 0, alto: 0, destra: 1920, basso: 302 } });
  await conDesktop(colonne, () => D.ordinaIcone({ verso: 'colonne' }));
  const perColonna = [...new Set(colonne.stato.voci.map((v) => v.x))].sort((a, b) => a - b)
    .map((x) => colonne.stato.voci.filter((v) => v.x === x).sort((a, b) => a.y - b.y).map((v) => v.nome));
  assert.deepEqual(perColonna, [['appunti.txt', 'bilancio 10', 'Bilancio 2024.xlsx'], ['Cestino', 'Ébano.png', 'File 2.pdf'], ['File 10.pdf', 'Zoom']]);
});

test('con «Disponi automaticamente» acceso lo si spegne e lo si dice; già in ordine non si sposta niente; desktop vuoto lo dice', async () => {
  registrati.length = 0;
  const finto = desktopFinto({ auto: true, nascoste: true });
  const r = await conDesktop(finto, () => D.ordinaIcone({}));
  assert.equal(r.autoTolto, true);
  assert.equal(finto.stato.auto, false);
  assert.deepEqual(finto.chiamate.find((c) => c[0] === 'disponi')[2], { auto: false });
  const testo = D.esitoPerModello(r);
  assert.match(testo, /Disponi automaticamente.*spento/);
  assert.match(testo, /Mostra icone del desktop/);
  assert.equal(registrati[0].cambi[0].prima.auto, true);

  const ancora = await conDesktop(finto, () => D.ordinaIcone({}));
  assert.equal(ancora.gia, true);
  assert.equal(finto.chiamate.filter((c) => c[0] === 'disponi').length, 1, 'già in ordine: nessuno spostamento');
  assert.equal(registrati.length, 1);

  const vuoto = await conDesktop(desktopFinto({ voci: [] }), () => D.ordinaIcone({}));
  assert.equal(vuoto.vuoto, true);
  assert.match(D.esitoPerModello(vuoto), /non ci sono icone/);
});

test('rimettere com\'erano: ogni icona ancora sul desktop torna al suo posto, e «Disponi automaticamente» com\'era', async () => {
  registrati.length = 0;
  const finto = desktopFinto({ auto: true });
  const prima = finto.stato.voci.map((v) => [v.id, v.x, v.y]);
  await conDesktop(finto, () => D.ordinaIcone({}));
  const cambio = registrati[0].cambi[0];
  // Nel frattempo l'utente ha cancellato un file.
  finto.stato.voci = finto.stato.voci.filter((v) => v.nome !== 'Zoom');
  const r = await conDesktop(finto, () => D.rimetti(cambio.prima));
  assert.equal(r.ok, true);
  assert.equal(r.sparite, 1);
  assert.deepEqual(finto.stato.voci.map((v) => [v.id, v.x, v.y]), prima.filter((v) => !v[0].endsWith('Zoom.lnk')));
  assert.equal(finto.stato.auto, true);
  // Anche l'annullo è un cambio: annullarlo rifà l'ordine.
  assert.equal(registrati.length, 2);
  assert.equal(registrati[1].cambi[0].come, undefined);
});

test('Windows che non sposta niente lo si dice, e un errore del desktop diventa una frase', async () => {
  const fermo = desktopFinto();
  fermo.disponi = async () => ({ ...(await fermo.leggi()), spostate: 0 });
  const r = await conDesktop(fermo, () => D.ordinaIcone({}));
  assert.equal(r.ok, false);
  assert.equal(r.errore, 'non-spostate');
  assert.match(D.esitoPerModello(r), /^Non fatto: Windows non ha spostato le icone/);

  const rotto = desktopFinto();
  rotto.leggi = async () => ({ ok: false, errore: 'nessun-desktop' });
  const e = await conDesktop(rotto, () => D.ordinaIcone({}));
  assert.match(D.esitoPerModello(e), /Esplora risorse.*Riavvia/);
  assert.match(D.esitoPerModello(await D.ordinaIcone({ ordine: 'colore' })), /Correggi i parametri/);
});

test('su Mac e Linux una frase con la strada del sistema; durante le prove il desktop vero non si tocca', async () => {
  assert.match(D.spiega('mac').frase, /Mac/);
  assert.match(D.spiega('mac').dove, /Ordina per/);
  assert.match(D.spiega('linux').frase, /Linux/);
  const fonte = require('node:fs').readFileSync(join(SERVIZI, 'iconeDesktop.js'), 'utf8');
  assert.match(fonte, /process\.platform === 'darwin' \? 'mac' : 'linux'/);
  const prima = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    const r = await D.ordinaIcone({});
    assert.equal(r.errore, 'prove');
  } finally {
    if (prima === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prima;
  }
});

test('il cambio nel filo: una frase che dice l\'ordine, l\'annullo che dice quante, livello 1', () => {
  const come = { ordine: 'data', verso: 'colonne', alContrario: true, cartellePrima: true };
  const prima = { auto: true, voci: [['a', 3, 2], ['b', 78, 2], ['c', 153, 2]] };
  const dopo = { auto: false, voci: [['a', 3, 102], ['b', 78, 2], ['c', 3, 2]] };
  assert.equal(K.fraseCambio({ chiave: 'desktop', prima, dopo, come }), 'icone del desktop per data al contrario, a colonne, cartelle prima');
  assert.equal(K.fraseCambio({ chiave: 'desktop', prima: dopo, dopo: prima }), 'icone del desktop: spostate 2, «Disponi automaticamente» acceso');
  assert.equal(K.livello({ tipo: 'desktop', cambi: [{ chiave: 'desktop', prima, dopo, come }] }), 1);
  assert.equal(K.annullabile({ tipo: 'desktop', cambi: [{ chiave: 'desktop', prima, dopo }] }), true);
});

// ── Windows: lo script lo legge PowerShell, che su Windows c'è sempre ───────

test('Windows: PowerShell legge gli script senza errori e compila il C# del desktop', { skip: process.platform !== 'win32' && 'serve il PowerShell di Windows' }, () => {
  for (const [comando, script] of Object.entries(D.SCRIPT.win32)) {
    const controllo = `$e = $null; $t = $null; [void][System.Management.Automation.Language.Parser]::ParseInput($env:FILO_PROVA, [ref]$t, [ref]$e); $e.Count`;
    const errori = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', controllo], {
      env: { ...process.env, FILO_PROVA: script }, encoding: 'utf8',
    }).trim();
    assert.equal(errori, '0', `${comando}: PowerShell trova errori di sintassi`);
  }
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'try { Add-Type -TypeDefinition $env:FILO_PROVA; "ok" } catch { $_.Exception.Message }'], {
    env: { ...process.env, FILO_PROVA: D.CS_DESKTOP }, encoding: 'utf8',
  }).trim();
  assert.equal(out, 'ok', 'il C# del desktop non compila col PowerShell di Windows');
});
