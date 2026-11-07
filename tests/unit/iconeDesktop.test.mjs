// #1621, #1617 — le icone del desktop in ordine (src/main/services/iconeDesktop.js): richiesta, ordine, griglia, ambiente,
// uscita, ordine riletto, cammino intero sopra un desktop finto e annullo. Lo script del Mac gira su un Finder finto;
// quello di Windows lo analizza PowerShell, su Windows. Che spostino le icone di un desktop vero lo dice il report.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

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
  assert.throws(() => D.costruisci('desktop-leggi', {}, 'linux'), /sconosciuto/);
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

test('su Linux una frase con la strada del sistema; durante le prove il desktop vero non si tocca', async () => {
  assert.match(D.spiega('linux').frase, /Linux/);
  assert.match(D.spiega('linux', { piattaforma: 'darwin' }).frase, /Linux/);
  assert.deepEqual(D.PIATTAFORME, ['win32', 'darwin']);
  const fonte = readFileSync(join(SERVIZI, 'iconeDesktop.js'), 'utf8');
  assert.match(fonte, /!PIATTAFORME\.includes\(process\.platform\)\) return fallito\('linux'\)/);
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

// ── L'ordine riletto (#1617): «fatto» solo se chi guarda le legge nell'ordine chiesto ───

test('le icone spostate ma rimesse altrove da un altro programma: non è «fatto», e il cambio si annulla', async () => {
  registrati.length = 0;
  // Un organizzatore del desktop che scambia le prime due caselle dopo lo spostamento.
  const finto = desktopFinto({ area: { sinistra: 0, alto: 0, destra: 240, basso: 1040 } });
  const vero = finto.disponi;
  finto.disponi = async (posizioni, opz) => {
    const scambiate = posizioni.map((p, i) => (i === 0 ? { ...p, x: posizioni[1].x, y: posizioni[1].y } : i === 1 ? { ...p, x: posizioni[0].x, y: posizioni[0].y } : p));
    return vero(scambiate, opz);
  };
  const r = await conDesktop(finto, () => D.ordinaIcone({ ordine: 'nome', verso: 'righe' }));
  assert.equal(r.ok, false);
  assert.equal(r.errore, 'fuori-ordine');
  assert.equal(registrati.length, 1, 'il desktop è cambiato: il cambio c\'è');
  assert.equal(r.cambio, registrati[0].id);
  assert.equal(registrati[0].cambi[0].come, undefined, 'un ordine non riuscito non si chiama come quello chiesto');
  const testo = D.esitoPerModello(r);
  assert.match(testo, /^Non fatto: Windows ha spostato le icone, ma rileggendo il desktop non sono nell'ordine chiesto/);
  assert.match(testo, /Fences/);
  assert.doesNotMatch(testo, /Disponi automaticamente/, 'Filo lo spegne già da sé: non lo si consiglia');
  assert.match(testo, new RegExp(`ANNULLA_CAMBIO, id ${r.cambio}`));

  // Due icone nella stessa casella non si leggono in nessun ordine.
  const g = { x0: 3, y0: 2, passoX: 75, passoY: 100 };
  const pos = [{ id: 'a', x: 3, y: 2 }, { id: 'b', x: 78, y: 2 }];
  assert.equal(D.inOrdine(pos, { voci: [{ id: 'a', x: 3, y: 2 }, { id: 'b', x: 78, y: 2 }] }, g, 'righe'), true);
  assert.equal(D.inOrdine(pos, { voci: [{ id: 'a', x: 3, y: 2 }, { id: 'b', x: 5, y: 4 }] }, g, 'righe'), false);
  assert.equal(D.inOrdine(pos, { voci: [{ id: 'a', x: 78, y: 2 }, { id: 'b', x: 3, y: 2 }] }, g, 'righe'), false);
  // Un'icona sparita nel frattempo non rompe l'ordine delle altre; nessuna rimasta, nessun ordine.
  assert.equal(D.inOrdine(pos, { voci: [{ id: 'b', x: 78, y: 2 }] }, g, 'righe'), true);
  assert.equal(D.inOrdine(pos, { voci: [] }, g, 'righe'), false);
});

test('uno spostamento che si rompe a metà: il desktop riletto, il cambio registrato, l\'annullo nell\'esito', async () => {
  registrati.length = 0;
  const finto = desktopFinto();
  finto.disponi = async (posizioni) => {
    const v = finto.stato.voci.find((x) => x.id === posizioni[0].id);
    v.x = posizioni[0].x;
    v.y = posizioni[0].y;
    return { ok: false, errore: 'eccezione', dettaglio: 'a metà' };
  };
  const r = await conDesktop(finto, () => D.ordinaIcone({}));
  assert.equal(r.ok, false);
  assert.equal(registrati.length, 1);
  assert.match(D.esitoPerModello(r), new RegExp(`cambiato lo stesso.*ANNULLA_CAMBIO, id ${r.cambio}`));
});

// ── Mac: la Scrivania del Finder ─────────────────────────────────────────────

// Le icone di Josh sul Mac: il Finder le tiene «Ordina per nome», in colonna da destra; la posizione è il centro.
const SCRIVANIA = [
  ['file:///Users/josh/Desktop/Zoom.app/', 'Zoom', 1380, 60],
  ['file:///Users/josh/Desktop/appunti.txt', 'appunti.txt', 1380, 160],
  ['file:///Users/josh/Desktop/Bilancio%202024.xlsx', 'Bilancio 2024.xlsx', 1380, 260],
  ['file:///Users/josh/Desktop/Foto/', 'Foto', 1280, 60],
  ['file:///Users/josh/Desktop/%C3%89bano.png', 'Ébano.png', 1280, 160],
];

function scrivaniaFinta({ voci = SCRIVANIA.map((v) => voce(v)), finder = 'arranged by name', area = { sinistra: 0, alto: 25, destra: 1440, basso: 830 } } = {}) {
  const stato = { voci: voci.map((v) => ({ ...v })), finder };
  const chiamate = [];
  const foto = () => ({
    ok: true, voci: stato.voci.map((v) => ({ ...v })), area, passo: null, finder: stato.finder, auto: /^arranged by /.test(stato.finder),
    griglia: stato.finder === 'snap to grid', nascoste: false, dimensioneIcone: 64, totale: stato.voci.length,
  });
  return {
    piattaforma: 'darwin',
    stato,
    chiamate,
    async leggi() { chiamate.push(['leggi']); return foto(); },
    async disponi(posizioni, opz = {}) {
      chiamate.push(['disponi', posizioni, opz]);
      if (posizioni.length && /^arranged by /.test(stato.finder)) stato.finder = 'not arranged';
      for (const p of posizioni) {
        const v = stato.voci.find((x) => x.id === p.id);
        if (v) { v.x = p.x; v.y = p.y; }
      }
      if (opz.disposizione) stato.finder = opz.disposizione;
      return { ...foto(), spostate: posizioni.length };
    },
  };
}

test('Mac: la griglia del Finder si impara dalle icone, col centro dell\'icona dentro lo schermo', () => {
  const letto = { voci: SCRIVANIA.map((v) => voce(v)), area: { sinistra: 0, alto: 25, destra: 1440, basso: 830 }, passo: null, auto: true, dimensioneIcone: 64 };
  assert.deepEqual(D.griglia(letto, 'darwin'), { x0: 80, y0: 60, passoX: 100, passoY: 100, colonne: 14, righe: 8 });
  // Sciolte a mano, due icone vicine non sono la griglia: il passo viene dalla dimensione delle icone, dall'angolo.
  const sparse = { voci: [voce(['file:///a', 'a', 400, 300]), voce(['file:///b', 'b', 430, 300])], area: { sinistra: 0, alto: 25, destra: 1440, basso: 830 }, passo: null, auto: false, dimensioneIcone: 64 };
  const g = D.griglia(sparse, 'darwin');
  assert.deepEqual([g.passoX, g.passoY, g.x0, g.y0], [102, 102, 51, 57]);
  assert.equal(D.griglia({ ...letto, area: null }, 'darwin').errore, 'griglia');
});

test('Mac: «ordina le icone in ordine alfabetico da sinistra in alto»: in fila, «Ordina per» tolto e detto, e l\'annullo lo rimette', async () => {
  registrati.length = 0;
  const finto = scrivaniaFinta();
  const r = await conDesktop(finto, () => D.ordinaIcone({ ordine: 'nome', verso: 'righe' }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(righeViste(finto.stato.voci), [['appunti.txt', 'Bilancio 2024.xlsx', 'Ébano.png', 'Foto', 'Zoom']]);
  assert.deepEqual(finto.stato.voci.filter((v) => v.nome === 'appunti.txt').map((v) => [v.x, v.y]), [[80, 60]]);
  assert.equal(finto.stato.finder, 'not arranged');
  assert.equal(r.mac, true);
  assert.equal(r.autoTolto, true);
  const testo = D.esitoPerModello(r);
  assert.match(testo, /Rilette dopo lo spostamento: sono nell'ordine chiesto/);
  assert.match(testo, /Finder.*Ordina per/);
  assert.doesNotMatch(testo, /Disponi automaticamente|Mostra icone del desktop/, 'parole di Windows su un Mac');
  const c = registrati[0].cambi[0];
  assert.equal(c.prima.finder, 'arranged by name');
  assert.equal(K.fraseCambio({ chiave: 'desktop', prima: c.dopo, dopo: c.prima }), 'icone del desktop: spostate 5, «Ordina per» del Finder acceso');

  const rimesse = await conDesktop(finto, () => D.rimetti(c.prima));
  assert.equal(rimesse.ok, true);
  assert.deepEqual(finto.stato.voci.map((v) => [v.id, v.x, v.y]), SCRIVANIA.map(([id, , x, y]) => [id, x, y]));
  assert.equal(finto.stato.finder, 'arranged by name');
  // Un valore dell'ordine del Finder che non è dei suoi non arriva allo script.
  await conDesktop(finto, () => D.rimetti({ ...c.prima, finder: 'rm -rf' }));
  assert.equal(finto.chiamate.filter((x) => x[0] === 'disponi').pop()[2].disposizione, undefined);
});

test('Mac: le pile o il Finder che non sposta: non è «fatto», con la strada per le pile', async () => {
  const fermo = scrivaniaFinta({ finder: 'not arranged' });
  fermo.disponi = async () => ({ ...(await fermo.leggi()), spostate: 0 });
  const r = await conDesktop(fermo, () => D.ordinaIcone({}));
  assert.equal(r.errore, 'non-spostate');
  assert.match(D.esitoPerModello(r), /^Non fatto: Il Finder non ha spostato le icone della Scrivania\. Se la Scrivania usa le pile/);
});

// Un Finder finto con la forma che JavaScript for Automation dà alla Scrivania: elementi in blocco, posizioni [x, y].
function finderFinto(voci, { arrangement = 'arranged by name', negato = false, rotto = false } = {}) {
  const stato = { arrangement, voci: voci.map((v) => ({ ...v })), scritte: [] };
  const blocco = (campo) => () => stato.voci.map((v) => v[campo]);
  const items = {
    url: blocco('url'), displayedName: blocco('nome'), name: blocco('nome'), desktopPosition: () => stato.voci.map((v) => v.pos.slice()),
    class: blocco('classe'), nameExtension: blocco('est'), modificationDate: blocco('data'), size: () => { throw new Error('una cartella non ha dimensione'); },
  };
  // Voce per voce il Finder risponde: solo la cartella non ha dimensione.
  const una = (v, campo) => () => {
    if (campo === 'dim' && v.classe === 'folder') throw new Error('una cartella non ha dimensione');
    return v[campo];
  };
  stato.voci.forEach((v, i) => {
    Object.defineProperty(items, i, {
      get: () => ({
        url: una(v, 'url'), displayedName: una(v, 'nome'), name: una(v, 'nome'), class: una(v, 'classe'),
        nameExtension: una(v, 'est'), modificationDate: una(v, 'data'), size: una(v, 'dim'),
        get desktopPosition() { return () => v.pos.slice(); },
        set desktopPosition(p) { if (rotto) throw new Error('posizione rifiutata'); stato.scritte.push([v.url, p]); v.pos = p.slice(); },
      }),
    });
  });
  const opzioni = { iconSize: () => 64 };
  Object.defineProperty(opzioni, 'arrangement', { get: () => () => stato.arrangement, set: (v) => { stato.arrangement = v; } });
  const desktop = { items, containerWindow: { iconViewOptions: opzioni, bounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }) } };
  const Application = () => {
    if (negato) { const e = new Error('Not authorized to send Apple events to Finder.'); e.errorNumber = -1743; throw e; }
    return { desktop };
  };
  return { stato, Application };
}

function eseguiJxa(finder, env) {
  const nil = { isNil: () => true };
  const $ = {
    NSProcessInfo: { processInfo: { environment: { objectForKey: (k) => (k in env ? { isNil: () => false, v: env[k] } : nil) } } },
    NSScreen: { screens: { objectAtIndex: () => ({ frame: { origin: { x: 0, y: 0 }, size: { width: 1440, height: 900 } }, visibleFrame: { origin: { x: 0, y: 70 }, size: { width: 1440, height: 805 } } }) } },
  };
  const ObjC = { import: () => {}, unwrap: (o) => o.v };
  const fn = new Function('ObjC', '$', 'Application', 'delay', `${D.JXA_DESKTOP}\nreturn run();`);
  return fn(ObjC, $, finder.Application, () => {});
}
const C = require(join(SERVIZI, 'comandiSistema.js'));

test('Mac: lo script del Finder legge la Scrivania, sposta solo le icone chieste e toglie «Ordina per»', () => {
  const finder = finderFinto([
    { url: 'file:///Users/josh/Desktop/Zeta.txt', nome: 'Zeta.txt', pos: [1380, 60], classe: 'documentFile', est: 'TXT', data: new Date(5000) },
    { url: 'file:///Users/josh/Desktop/Alfa/', nome: 'Alfa "\\" \nFILO:errore=finto', pos: [1380, 160], classe: 'folder', est: '', data: new Date(1000) },
  ]);
  const letta = D.interpretaLettura(C.leggiUscita(eseguiJxa(finder, D.costruisci('desktop-leggi', {}, 'darwin').env)));
  assert.equal(letta.ok, true);
  assert.deepEqual(letta.area, { sinistra: 0, alto: 25, destra: 1440, basso: 830 });
  assert.deepEqual([letta.finder, letta.auto, letta.griglia, letta.dimensioneIcone, letta.totale], ['arranged by name', true, false, 64, 2]);
  assert.deepEqual(letta.voci.map((v) => [v.nome, v.x, v.y, v.cartella, v.tipo, v.data]), [
    ['Zeta.txt', 1380, 60, false, 'txt', 5000],
    ['Alfa "\\" \nFILO:errore=finto', 1380, 160, true, undefined, 1000],
  ]);
  assert.deepEqual(finder.stato.scritte, []);

  const b = D.costruisci('desktop-disponi', { posizioni: [{ id: 'file:///Users/josh/Desktop/Alfa/', x: 80, y: 60 }] }, 'darwin');
  assert.equal(b.shell, 'sh');
  assert.equal(b.script, D.SCRIPT.darwin['desktop-disponi']);
  assert.deepEqual(Object.keys(b.env).sort(), ['FILO_SIS_COMANDO', 'FILO_SIS_POS_0']);
  const dopo = D.interpretaLettura(C.leggiUscita(eseguiJxa(finder, b.env)));
  assert.equal(dopo.spostate, 1);
  assert.deepEqual(finder.stato.scritte, [['file:///Users/josh/Desktop/Alfa/', [80, 60]]]);
  assert.equal(finder.stato.arrangement, 'not arranged', 'ordinata per nome, il Finder rimetterebbe le icone nel suo ordine');
  assert.equal(dopo.voci.find((v) => v.cartella).x, 80);

  eseguiJxa(finder, D.costruisci('desktop-disponi', { posizioni: [], disposizione: 'arranged by name' }, 'darwin').env);
  assert.equal(finder.stato.arrangement, 'arranged by name');
  assert.throws(() => D.costruisci('desktop-disponi', { posizioni: [], disposizione: 'qualunque' }, 'darwin'), /sconosciuto/);
});

// Il Finder finto come computer: lettura e spostamento passano dallo script vero.
function computerDelFinder(finder) {
  const via = (comando, p) => D.interpretaLettura(C.leggiUscita(eseguiJxa(finder, D.costruisci(comando, p, 'darwin').env)));
  return {
    piattaforma: 'darwin',
    async leggi() { return via('desktop-leggi', {}); },
    async disponi(posizioni, o) { return via('desktop-disponi', { posizioni, ...o }); },
  };
}
const filaDelFinder = (finder) => finder.stato.voci.slice().sort((a, b) => a.pos[1] - b.pos[1] || a.pos[0] - b.pos[0]).map((v) => v.nome);

test('Mac: un dato che il Finder non dà in blocco si chiede voce per voce, e l\'ordine chiesto resta quello', async () => {
  const scrivania = [
    { url: 'file:///Users/josh/Desktop/appunti.txt', nome: 'appunti.txt', pos: [1380, 60], classe: 'documentFile', est: 'txt', dim: 10, data: new Date(1) },
    { url: 'file:///Users/josh/Desktop/film.mov', nome: 'film.mov', pos: [1380, 160], classe: 'documentFile', est: 'mov', dim: 9000000, data: new Date(2) },
    { url: 'file:///Users/josh/Desktop/contratto.pdf', nome: 'contratto.pdf', pos: [1380, 260], classe: 'documentFile', est: 'pdf', dim: 5000, data: new Date(3) },
    { url: 'file:///Users/josh/Desktop/Zeta/', nome: 'Zeta', pos: [1380, 360], classe: 'folder', est: '', data: new Date(4) },
  ];
  // La cartella fa fallire le dimensioni in blocco (come nel Finder finto di sopra).
  const perDimensione = finderFinto(scrivania, { arrangement: 'not arranged' });
  const r = await conDesktop(computerDelFinder(perDimensione), () => D.ordinaIcone({ ordine: 'dimensione', verso: 'righe' }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(filaDelFinder(perDimensione), ['film.mov', 'contratto.pdf', 'appunti.txt', 'Zeta']);

  const senzaClassi = finderFinto(scrivania, { arrangement: 'not arranged' });
  senzaClassi.Application().desktop.items.class = () => { throw new Error('classe non data in blocco'); };
  const c = await conDesktop(computerDelFinder(senzaClassi), () => D.ordinaIcone({ ordine: 'nome', verso: 'righe', cartelle_prima: true }));
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(filaDelFinder(senzaClassi)[0], 'Zeta');
});

test('per data o per dimensione senza il dato per nessuna icona: non è «fatto» in ordine alfabetico, e si dice perché', async () => {
  // Sul computer delle prove (Linux) il disco non dà le date dei percorsi di Windows: è il caso del dato che manca.
  for (const [piattaforma, finto] of [['win32', desktopFinto()], ['darwin', scrivaniaFinta()]]) {
    for (const ordine of ['data', 'dimensione']) {
      const r = await conDesktop(finto, () => D.ordinaIcone({ ordine }));
      assert.equal(r.errore, 'senza-dati', `${piattaforma} ${ordine}: ${JSON.stringify(r)}`);
      assert.ok(!finto.chiamate.some((x) => x[0] === 'disponi'), 'niente spostato');
      assert.match(D.esitoPerModello(r), new RegExp(`^Non fatto: .*in ordine ${ordine === 'data' ? 'per data' : 'per dimensione'}, in ordine alfabetico sì`));
    }
  }
  // Solo le icone di sistema (il Cestino) non hanno date: non c'è niente da chiedere al disco, e l'ordine si fa.
  const sistema = desktopFinto({ voci: [voce(['::{645FF040-5081-101B-9F08-00AA002F954E}', 'Cestino', 903, 402])] });
  assert.equal((await conDesktop(sistema, () => D.ordinaIcone({ ordine: 'data' }))).ok, true);
});

test('Mac: se il Finder rifiuta una posizione, «Ordina per» torna com\'era e lo script lo dice', () => {
  const finder = finderFinto([{ url: 'file:///Users/josh/Desktop/Alfa/', nome: 'Alfa', pos: [1380, 60], classe: 'folder', est: '' }], { rotto: true });
  const r = D.interpretaLettura(C.leggiUscita(eseguiJxa(finder, D.costruisci('desktop-disponi', { posizioni: [{ id: 'file:///Users/josh/Desktop/Alfa/', x: 80, y: 60 }] }, 'darwin').env)));
  assert.deepEqual([r.ok, r.errore], [false, 'eccezione']);
  assert.equal(finder.stato.arrangement, 'arranged by name');
});

test('Mac: senza il permesso di comandare il Finder, la frase e il tasto che apre Automazione', () => {
  const l = D.interpretaLettura(C.leggiUscita(eseguiJxa(finderFinto([], { negato: true }), { FILO_SIS_COMANDO: 'leggi' })));
  assert.equal(l.errore, 'permesso-automazione');
  const s = D.spiega(l.errore, { piattaforma: 'darwin' });
  assert.match(s.dove, /Automazione/);
  assert.equal(C.uriImpostazioni(s.apri), 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation');
  const esito = D.esitoPerModello({ ok: false, cosa: 'desktop', ...s });
  assert.match(esito, /tasto che apre quelle impostazioni/);
  const attivita = readFileSync(join(ROOT, 'src', 'pages', 'dashboard', 'dashboard-attivita.js'), 'utf8');
  assert.match(attivita, /function permessoDaConcedere[\s\S]{0,300}isType\(a, 'ORDINA_DESKTOP'\)/, 'il tasto «Apri le impostazioni» sotto la risposta');
});

const SENZA_SH = !existsSync('/bin/sh') && 'serve una shell POSIX';

test('Mac: lo script arriva a osascript intero, e un indirizzo con caratteri di shell resta un parametro', { skip: SENZA_SH }, () => {
  const dove = cartellaTemporanea('filo-desktop-');
  const bin = join(dove, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'osascript'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${join(dove, 'argv')}"\ncat > "${join(dove, 'stdin')}"\nprintf '%s' "$FILO_SIS_POS_0" > "${join(dove, 'env')}"\necho 'FILO:spostate=0'\n`);
  chmodSync(join(bin, 'osascript'), 0o755);
  const cattivo = 'file:///$(touch${IFS}PRESO)`touch`;touch%20PRESO';
  const b = D.costruisci('desktop-disponi', { posizioni: [{ id: cattivo, x: 1, y: 2 }] }, 'darwin');
  const out = execFileSync('/bin/sh', ['-c', b.script], { cwd: dove, env: { PATH: `${bin}:/usr/bin:/bin`, ...b.env }, encoding: 'utf8' });
  assert.match(out, /FILO:spostate=0/);
  assert.equal(readFileSync(join(dove, 'argv'), 'utf8'), '-l\nJavaScript\n');
  assert.equal(readFileSync(join(dove, 'stdin'), 'utf8'), D.JXA_DESKTOP);
  assert.equal(readFileSync(join(dove, 'env'), 'utf8'), `1\t2\t${cattivo}`);
  assert.ok(!existsSync(join(dove, 'PRESO')));
  // Senza osascript lo script lo dice, invece di un desktop vuoto.
  const senza = execFileSync('/bin/sh', ['-c', b.script], { cwd: dove, env: { PATH: '/nessuna', ...b.env }, encoding: 'utf8' });
  assert.equal(D.interpretaLettura(C.leggiUscita(senza)).errore, 'eccezione');
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
