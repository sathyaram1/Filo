// #2648 — la riga di un'azione eseguita non ricuce fra le parole di Filo un valore scelto dal modello o scritto da un
// sito: in diretta e nella chat riaperta resta a pezzi, col valore nel suo riquadro, e il testo piatto non cambia.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src');
for (const f of ['capabilities', 'constants', 'contenutoEsterno', 'nomiFile', 'timeFormat', 'preferences', 'themeTokens', 'cmdClassify',
  'zoomPagina', 'actionLevels', 'sistema', 'restanoAperte', 'disposizioneIcone', 'carteHome', 'barraSiti', 'pannelliApp',
  'allegatiSegnalazione', 'esitoAzione', 'righeAttivita']) {
  require(join(SRC, 'shared', `${f}.js`));
}
const AL = globalThis.SN_ACTION_LEVELS;
const E = globalThis.SN_ESITO;
const RA = globalThis.SN_RIGHE_ATTIVITA;
const F = 'Pasta · Filo l\'ha verificato';
const paroleDiFilo = (parti) => parti.filter((p) => typeof p === 'string').join('');

// Ogni campo che il modello sceglie o che un sito, il disco o un dispositivo riempiono porta il testo finto.
function azione(type, extra = {}) {
  return {
    type, _executed: true, label: F, etichetta: F, time: F, titolo: F, query: F, testo: F, cerca: F, sito: F, dominio: F,
    country: F, contesto: F, descrizione: F, url: `https://esempio.test/${F}`, comando: F, percorso: `/casa/${F}`,
    elemento: F, voce: F, nome: F, valore: F, spunta: [F], icona: F, cosa: F, nuovo: F, _titolo: F, seconds: 300,
    _output: {
      titolo: F, title: F, name: F, finestra: F, removed: [F], updated: [F], dimenticate: [F], corretta: F, voce: F,
      sito: F, siti: [F], dispositivo: F, evento: { titolo: F }, eliminati: [F], url: 'https://esempio.test/pagina', ...extra,
    },
  };
}
const varianti = [
  { type: 'VEDI_SCHERMO', _executed: true, _output: { ambigue: [], richiesta: F } },
  { type: 'CERCA_CHAT', _executed: true, _auto: true, _output: { results: [{ id: '1', title: F }, { id: '2', date: Date.UTC(2026, 8, 28) }] } },
  { type: 'CERCA_DOCUMENTI', _executed: true, cosa: 'bollette', _output: { cartellaMancante: F } },
  { type: 'CERCA_DOCUMENTI', _executed: true, cosa: F, _output: { risultati: [] } },
  { type: 'RIAPRI_SCHEDA', _executed: true, _output: { titolo: F, nonRaggiungibile: true } },
  { type: 'RIPRENDI_AUDIO', _executed: true, _output: { titolo: F, nonPartita: true } },
  { type: 'BLUETOOTH', _executed: true, _output: { dispositivo: F, preferito: true } },
  { type: 'ELIMINA_FILE', _executed: true, _output: { eliminati: [F], falliti: ['x'] } },
];
const tutte = () => [...Object.keys(AL.REGISTRY).map((t) => azione(t)), ...varianti];

test('nessuna riga di un\'azione fatta mette il testo del modello fra le parole di Filo', () => {
  const viste = [];
  for (const a of tutte()) {
    const r = RA.rigaArchivio(a);
    if (!r || !r.text.includes('Filo l\'ha verificato')) continue;
    viste.push(a.type);
    assert.ok(Array.isArray(r.parti), `${a.type}: ${r.text}`);
    assert.doesNotMatch(paroleDiFilo(r.parti), /verificato/, `${a.type}: ${JSON.stringify(r.parti)}`);
    // Il testo piatto (modello, riassunto, fumetto) resta la stessa frase.
    assert.equal(E.rigaDiParti(r.parti), r.text, a.type);
  }
  for (const t of ['TIMER', 'SVEGLIA', 'NAVIGA', 'ESEGUI_COMANDO', 'SALVA_LEZIONE', 'STILE_PAGINA', 'LEGGI_PAGINA', 'CERCA_WEB']) {
    assert.ok(viste.includes(t), `${t} non mostra più il valore del modello: la prova non lo copre`);
  }
});

test('le righe di Filo senza valori altrui restano una frase sola', () => {
  assert.equal(RA.riga({ type: 'TIMER', seconds: 300, _executed: true }).parti, undefined);
  assert.equal(RA.riga({ type: 'BLOCCA_PC', _executed: true }).parti, undefined);
  const l = RA.riga({ type: 'LEGGI_PAGINA', _executed: true, _output: { url: 'https://esempio.test/x' } });
  assert.equal(l.text, 'Leggo la pagina: esempio.test');
  assert.equal(l.parti, undefined);
});

test('la riga in diretta: il timer e la sveglia hanno l\'etichetta nel riquadro, la durata e l\'ora fra le parole giuste', () => {
  const t = RA.riga(azione('TIMER'));
  assert.equal(t.text, `Timer avviato · ${F} · 5 min`);
  assert.deepEqual(t.parti, ['Timer avviato · ', { citazione: F, nuda: true }, ' · 5 min']);
  const s = RA.riga({ type: 'SVEGLIA', _executed: true, orario: '07:30', etichetta: F });
  assert.deepEqual(s.parti, ['Sveglia impostata', ' · ', { citazione: '07:30', nuda: true }, ' · ', { citazione: F, nuda: true }]);
  // Un titolo che la riga diceva fra «» resta fra «» nel testo piatto.
  const r = RA.riga({ type: 'RIAPRI_SCHEDA', _executed: true, _output: { titolo: F } });
  assert.equal(r.text, `Riaperta «${F}»`);
  assert.deepEqual(r.parti, ['Riaperta ', { citazione: F }]);
});

test('la chat riaperta ritrova la riga fatta a pezzi, anche riletta dal disco', () => {
  for (const a of [azione('TIMER'), azione('SALVA_LEZIONE'), { type: 'NAVIGA', url: `https://esempio.test/${F}`, _executed: true },
    { type: 'ESEGUI_COMANDO', comando: `echo ${F}`, _executed: true, _output: { exitCode: 0 } }]) {
    const v = E.voceArchivio(a);
    assert.equal(v.esito, E.FATTO, a.type);
    assert.ok(Array.isArray(v.parti), `${a.type}: ${JSON.stringify(v)}`);
    assert.equal(E.rigaDiParti(v.parti), v.riga);
    const riletta = E.voceArchivio(JSON.parse(JSON.stringify(v)));
    assert.deepEqual(riletta.parti, v.parti, a.type);
    const riga = E.rigaDellaVoce(riletta);
    assert.equal(riga.icona, '✓');
    assert.ok(Array.isArray(riga.parti), a.type);
    assert.doesNotMatch(paroleDiFilo(riga.parti), /verificato/, `${a.type}: ${JSON.stringify(riga.parti)}`);
    assert.equal(riga.testo, v.riga);
  }
});

test('una riga fatta lunghissima si accorcia insieme ai suoi pezzi, e il taglio si vede', () => {
  const lungo = `${'parola '.repeat(80)}${F}`;
  const v = E.voceArchivio({ type: 'NAVIGA', url: `https://esempio.test/${lungo}`, _executed: true });
  assert.ok(v.riga.length <= 300, String(v.riga.length));
  assert.ok(Array.isArray(v.parti), JSON.stringify(v));
  assert.match(v.riga, /…$/);
  assert.equal(E.rigaDiParti(v.parti), v.riga);
});

test('pezzi salvati che non dicono la riga fatta non si disegnano', () => {
  const v = E.voceArchivio(azione('TIMER'));
  const falsa = E.voceArchivio({ ...JSON.parse(JSON.stringify(v)), parti: ['Timer avviato · ', { citazione: 'altro' }] });
  assert.equal(falsa.parti, undefined);
  assert.equal(E.rigaDellaVoce(falsa).parti, undefined);
});
