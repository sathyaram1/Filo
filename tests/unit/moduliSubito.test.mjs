// Cosa paga ogni pagina web prima di essere usabile (#1093): i moduli che page-preload.js carica subito, e quanto pesano.
// Quelli che servono solo a richiesta stanno dentro suRichiesta(), coi nomi che registrano: il primo che li legge li
// carica. Un modulo nuovo caricato subito che sfonda il tetto fa fallire col suo nome: va su richiesta, o si alza il tetto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, posix } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leggi = (f) => readFileSync(join(ROOT, f), 'utf8');
const BASI = { SHARED_DIR: 'src/shared', CONTENT_DIR: 'src/content' };

// Quelli che la pagina carica alla prima richiesta, col perché possono aspettare.
const SU_RICHIESTA = {
  'src/shared/wallet.js': 'solo per riconoscere un link d’invito nel menu',
  'src/shared/qr.js': 'solo per «Codice QR della pagina»',
  'src/shared/feedback.js': 'il riquadro della segnalazione',
  'src/shared/feedbackClientIdHash.js': 'il riquadro della segnalazione',
  'src/shared/feedbackAttachTypes.js': 'il riquadro della segnalazione',
  'src/content/feedback.js': 'il riquadro della segnalazione',
  'src/content/redteamAttack.js': 'il riquadro dell’attacco di prova',
  'src/shared/modelCaps.js': 'i modelli della dettatura, chiesti col menu',
  'src/shared/ttsVoices.js': 'le voci della lettura: nessuno le legge dalla pagina',
  'src/shared/dictationSegmenter.js': 'la dettatura',
  'src/shared/ascolto.js': 'la dettatura e il microfono delle chat',
  'src/shared/voceChat.js': 'il microfono delle chat',
};

// Il peso dei moduli caricati subito, in byte di sorgente: misurato 2.05 MB a novembre 2026, col margine per crescere.
const TETTO_SUBITO = 2_400_000;

function corpo(src, nome) {
  const i = src.indexOf(`function ${nome}() {`);
  assert.ok(i >= 0, `manca function ${nome}()`);
  return src.slice(i, src.indexOf('\n}\n', i));
}
const percorsi = (testo) => [...testo.matchAll(/require\(path\.join\((SHARED_DIR|CONTENT_DIR)((?:,\s*'[^']*')+)\)\)/g)]
  .map((m) => posix.join(BASI[m[1]], ...[...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1])));

const src = leggi('src/preload/page-preload.js');
const tutti = corpo(src, 'loadScripts');
const gruppi = [...tutti.matchAll(/suRichiesta\(\[([^\]]*)\],\s*\(\)\s*=>\s*\{([\s\S]*?)\}\);/g)]
  .map((m) => ({ nomi: [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]), file: percorsi(m[2]) }));
const pigri = gruppi.flatMap((g) => g.file);
const subito = percorsi(tutti).filter((f) => !pigri.includes(f));

test('i moduli su richiesta sono quelli dell’elenco, e nessun altro', () => {
  assert.ok(subito.length >= 30, `letti solo ${subito.length} moduli caricati subito`);
  assert.deepEqual([...pigri].sort(), Object.keys(SU_RICHIESTA).sort());
});

test('i moduli caricati subito stanno sotto il tetto', () => {
  const pesi = subito.map((f) => [f, statSync(join(ROOT, f)).size]).sort((a, b) => b[1] - a[1]);
  const totale = pesi.reduce((s, [, n]) => s + n, 0);
  assert.ok(totale <= TETTO_SUBITO, `le pagine web caricano subito ${totale} byte (tetto ${TETTO_SUBITO}); i più pesanti: `
    + pesi.slice(0, 8).map(([f, n]) => `${f} ${Math.round(n / 1024)} KB`).join(', '));
});

// Il nome che fa partire il caricamento deve essere uno di quelli che il modulo registra: un nome sbagliato lascia il
// modulo per sempre su richiesta e chi lo cerca trova il vuoto.
test('ogni gruppo su richiesta parte dai nomi che i suoi moduli registrano', () => {
  for (const g of gruppi) {
    const registrati = new Set(g.file.flatMap((f) => [...leggi(f).matchAll(/\bglobal(?:This)?\.(SN_[A-Z0-9_]+)\s*=(?!=)/g)].map((m) => m[1])));
    for (const n of g.nomi) assert.ok(registrati.has(n), `${n} non è registrato da ${g.file.join(', ')}`);
    for (const f of g.file) {
      const suoi = [...leggi(f).matchAll(/\bglobal(?:This)?\.(SN_[A-Z0-9_]+)\s*=(?!=)/g)].map((m) => m[1]);
      assert.ok(suoi.some((n) => g.nomi.includes(n)), `${f}: nessuno dei suoi nomi lo carica`);
    }
  }
});

// Il menu del tasto destro, il correttore e i segnali della pagina devono esserci appena la pagina è pronta; l'aggancio
// dell'apertura scelta nasce nel preload stesso, fuori da qualunque gruppo (#1461.1).
test('tasto destro, correttore e segnali di pagina restano fra i moduli caricati subito', () => {
  for (const f of ['src/content/menu.js', 'src/content/content.js', 'src/content/actions.js', 'src/content/spellcheck.js',
    'src/content/pageColor.js', 'src/content/safebrowse.js', 'src/content/translatePage.js']) {
    assert.ok(subito.includes(f), `${f} deve essere caricato subito`);
  }
  assert.match(src, /globalThis\.SN_APERTURA_SCELTA = require\('\.\/apertura-scelta\.js'\)\(ipcRenderer\)/);
});

// Le risposte che il frame principale aspetta prima degli script della pagina arrivano in una chiamata sola: ognuna in
// più lo tiene fermo un viaggio in più verso il main. Il documento blob chiede i permessi da solo (non fa la chiamata).
test('il frame principale chiede le risposte d’avvio in una chiamata sincrona sola', () => {
  assert.equal(src.match(/sendSync\('filo:avvio-pagina'/g)?.length, 1);
  for (const c of ['fp-config', 'cookie-wipe']) assert.ok(!src.includes(`sendSync('filo:${c}'`), `page-preload chiede ancora ${c} da solo`);
  assert.equal(src.match(/sendSync\('filo:permessi-stato'/g)?.length, 1);
  assert.match(src, /AVVIO \? AVVIO\.permessi : ipcRenderer\.sendSync\('filo:permessi-stato'/);
});
