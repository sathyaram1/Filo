// #2371 — l'assistente vede chi ha fatto cosa (sé, l'utente col pulsante, la segnalazione automatica) e il testo intero
// di ogni segnalazione partita o proposta a nome dell'utente; un'azione secca non chiude il turno su una domanda;
// gli strumenti nuovi della chat (scheda dopo e prima, Google Lens) e l'invio anonimo uno per voce e per versione.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['constants.js', 'contenutoEsterno.js', 'nomiFile.js', 'timeFormat.js', 'cmdClassify.js', 'actionLevels.js',
  'sistema.js', 'esitoAzione.js', 'righeAttivita.js', 'chatArchive.js', 'filoEventi.js', 'filoApp.js', 'filoContesto.js',
  'filoTrattoVivo.js', 'cambi.js', 'tasti.js', 'urlNav.js', 'autoFeedback.js']) {
  require(join(ROOT, 'src', 'shared', f));
}
const TV = globalThis.SN_TRATTO_VIVO;
const EV = globalThis.SN_FILO_EVENTI;
const ESITO = globalThis.SN_ESITO;

const azione = (campi, opz) => EV.crea('azione', { nome: 'INVIA_FEEDBACK', esito: { eseguita: true }, ...campi },
  { dispositivo: 'prova', ts: new Date().toISOString(), ...opz });

test('rigaAzione: tre autori distinti, l\'assistente, l\'utente col pulsante, la segnalazione automatica', () => {
  const assistente = TV.rigaDi(azione({ parametri: { testo: 'ciao' }, via: 'chat' }, { autore: EV.autoreDi('chat') }));
  const conferma = TV.rigaDi(azione({ parametri: { testo: 'ciao' }, via: 'conferma' }, { autore: EV.autoreDi('conferma') }));
  const automatica = TV.rigaDi(azione({ parametri: { testo: 'ciao' }, via: 'segnalazione' }, { autore: EV.autoreDi('segnalazione') }));
  assert.match(assistente, /^l'assistente: INVIA_FEEDBACK/);
  assert.match(conferma, /^l'utente, col pulsante di conferma: INVIA_FEEDBACK/);
  assert.match(automatica, /^la segnalazione automatica di Filo \(non l'assistente\): INVIA_FEEDBACK/);
  assert.equal(new Set([assistente, conferma, automatica].map((r) => r.split(':')[0])).size, 3);
  // L'evento resta valido per il filo: l'autore è uno di quelli che il formato conosce.
  assert.ok(EV.valido(azione({ via: 'segnalazione' }, { autore: EV.autoreDi('segnalazione') })));
});

test('rigaAzione: il testo di una segnalazione arriva intero; oltre un tetto largo il taglio si dice', () => {
  const lungo = `Ho chiesto a Filo: "${'parola '.repeat(400)}" fine del testo`;
  const riga = TV.rigaDi(azione({ parametri: { titolo: 'Un buco', testo: lungo }, via: 'segnalazione' }, { autore: 'automazione' }));
  assert.ok(riga.includes('fine del testo»'), 'il testo è stato tagliato');
  assert.match(riga, /\{"titolo":"Un buco"\}/);
  const enorme = 'x'.repeat(9000);
  const tagliata = TV.rigaDi(azione({ parametri: { testo: enorme }, via: 'segnalazione' }, { autore: 'automazione' }));
  assert.match(tagliata, /\[tagliato qui: 9000 caratteri in tutto\]/);
});

test('la proposta della segnalazione automatica arriva al modello intera, col suo autore', () => {
  const testo = `Ho chiesto a Filo: "aprimi una finestra in incognito"\nFilo sa fare «Finestra in incognito», ${'ma '.repeat(150)}fine.`;
  const voce = ESITO.voceArchivio({
    type: 'INVIA_FEEDBACK', testo, titolo: 'Aprimi una finestra', _proposta: true,
    _confirm: { level: 2, text: 'Inviare una segnalazione' },
  });
  assert.equal(voce.autore, 'segnalazione');
  const perModello = ESITO.perModello([voce]);
  assert.match(perModello, /proposta dalla segnalazione automatica di Filo, non da te/);
  assert.ok(perModello.includes('fine.»'), 'il testo della proposta arriva tagliato');
  // Riaperta dall'archivio la voce tiene l'autore.
  assert.equal(ESITO.voceArchivio(JSON.parse(JSON.stringify(voce))).autore, 'segnalazione');
});

test('un\'azione secca non chiude il turno se il messaggio ha anche una domanda (#2349)', () => {
  const { chiudeIlTurno } = require(join(ROOT, 'src', 'main', 'services', 'giroAzioni.js'));
  const tema = [{ action: { type: 'IMPOSTA_PREFERENZA' }, res: { executed: true, kept: true }, rendered: { type: 'IMPOSTA_PREFERENZA' } }];
  assert.equal(chiudeIlTurno(tema, { messaggio: 'metti il tema scuro' }), true);
  assert.equal(chiudeIlTurno(tema, { messaggio: 'puoi mettere il tema scuro?' }), true);
  assert.equal(chiudeIlTurno(tema, { messaggio: 'metti il tema scuro. Non ho capito quel feedback: cos\'era?' }), false);
});

test('la scheda dopo e quella prima: la stessa regola di Ctrl+Tab, in tondo', () => {
  const T = globalThis.SN_TASTI;
  assert.equal(T.schedaNelVerso('dopo', 0, 3), 1);
  assert.equal(T.schedaNelVerso('dopo', 2, 3), 0);
  assert.equal(T.schedaNelVerso('prima', 0, 3), 2);
  assert.equal(T.schedaNelVerso('prima', 1, 3), 0);
  assert.equal(T.indiceSchedaVicina({ key: 'Tab', ctrlKey: true, shiftKey: true }, 0, 3), T.schedaNelVerso('prima', 0, 3));
});

test('Google Lens: un\'immagine mandata in chat parte come modulo, coi suoi byte', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const invio = globalThis.SN_URL_NAV.invioRicercaImmagine(`data:image/png;base64,${png.toString('base64')}`);
  assert.equal(new URL(invio.url).hostname, 'lens.google.com');
  assert.equal(invio.contentType, 'multipart/form-data');
  const corpo = invio.data[0].bytes;
  assert.ok(corpo.includes(png), 'i byte dell\'immagine non ci sono');
  assert.ok(corpo.toString('latin1').includes(`--${invio.boundary}--`));
  assert.match(corpo.toString('latin1'), /name="encoded_image"; filename="immagine\.png"/);
  assert.equal(globalThis.SN_URL_NAV.invioRicercaImmagine('https://esempio.it/a.png'), null);
  assert.equal(globalThis.SN_URL_NAV.invioRicercaImmagine('data:text/html;base64,PGI+'), null);
});

test('l\'invio anonimo: tre turni insieme sulla stessa voce ne prenotano uno, e il conto resta su disco', async () => {
  const disco = {};
  const finto = {
    get: async (k) => ({ [k]: disco[k] === undefined ? undefined : JSON.parse(JSON.stringify(disco[k])) }),
    set: async (o) => { await new Promise((r) => setTimeout(r, 5)); Object.assign(disco, JSON.parse(JSON.stringify(o))); },
    runNormale: (fn) => fn(),
  };
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (/shim[\\/]storage$/.test(request)) return finto;
    return origLoad.call(this, request, parent, isMain);
  };
  try {
    const Inviati = require(join(ROOT, 'src', 'main', 'services', 'autoFeedbackInviati.js'));
    const chiave = globalThis.SN_AUTO_FEEDBACK.chiaveInvio({ kind: 'capability-uncommandable', capabilityId: 'switch-tab-next-prev' });
    const tre = await Promise.all([1, 2, 3].map(() => Inviati.prenota('1.4.10', chiave)));
    assert.deepEqual(tre.filter(Boolean).length, 1);
    assert.deepEqual(disco[Inviati.CHIAVE], { versione: '1.4.10', chiavi: [chiave] });
    assert.equal(await Inviati.prenota('1.4.10', chiave), false);
    assert.equal(await Inviati.prenota('1.4.11', chiave), true, 'con una versione nuova si segnala di nuovo');
  } finally {
    Module._load = origLoad;
  }
});
