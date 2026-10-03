// Livelli di autonomia (#530): le 32 celle della tabella, le regole sopra la tabella, lo stato del compito
// dalle fonti lette, i segreti, e la sentinella che tiene ogni superficie dentro il modulo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
for (const f of ['constants.js', 'contenutoEsterno.js', 'capabilities.js', 'themeTokens.js', 'cmdClassify.js',
  'zoomPagina.js', 'autonomia.js', 'preferences.js', 'actionLevels.js']) {
  require(join(ROOT, 'src', 'shared', f));
}
const A = globalThis.SN_AUTONOMIA;
const AL = globalThis.SN_ACTION_LEVELS;
const P = globalThis.SN_PREF;

// La tabella com'è scritta nel feedback, copiata a mano: il modulo deve dire la stessa cosa.
const ATTESA = {
  conservativo: { pulito: 'sì, sì, chiede, chiede', contaminato: 'sì, chiede, chiede, no' },
  default: { pulito: 'sì, sì, sì, chiede', contaminato: 'sì, sì, chiede, conferma' },
  automatico: { pulito: 'sì, sì, sì, sì+G', contaminato: 'sì, sì, sì+G, chiede' },
  yolo: { pulito: 'sì, sì, sì, sì+G', contaminato: 'sì, sì+G, sì+G, sì+G' },
};
const PESO = { si: 0, 'si+G': 1, chiede: 2, conferma: 3, no: 4 };
const cella = (t) => t.trim().replace('sì', 'si');

test('le 32 celle: senza guardiano «+G» chiede, col guardiano parte', () => {
  let n = 0;
  for (const [livello, righe] of Object.entries(ATTESA)) {
    for (const [stato, riga] of Object.entries(righe)) {
      riga.split(',').map(cella).forEach((attesa, costo) => {
        n += 1;
        const senza = A.decide({ livello, stato, costo });
        const con = A.decide({ livello, stato, costo, guardiano: true });
        assert.equal(senza, attesa === 'si+G' ? 'chiede' : attesa, `${livello}/${stato}/costo ${costo}`);
        assert.equal(con, attesa === 'si+G' ? 'si' : attesa, `${livello}/${stato}/costo ${costo} col guardiano`);
        assert.equal(A.decideDettaglio({ livello, stato, costo }).digita, attesa === 'conferma');
      });
    }
  }
  assert.equal(n, 32);
});

test('sentinella: nessuna cella vuota, e un compito contaminato non è mai più permissivo di uno pulito', () => {
  assert.deepEqual(Object.keys(A.TABELLA).sort(), A.LIVELLI.map((l) => l.id).sort());
  for (const [livello, righe] of Object.entries(A.TABELLA)) {
    for (const stato of ['pulito', 'contaminato']) {
      assert.equal(righe[stato].length, 4, `${livello}/${stato}: servono 4 costi`);
      for (const c of righe[stato]) assert.ok(Object.prototype.hasOwnProperty.call(PESO, c), `${livello}/${stato}: cella «${c}»`);
    }
    for (let costo = 0; costo < 4; costo++) {
      assert.ok(PESO[righe.contaminato[costo]] >= PESO[righe.pulito[costo]], `${livello}, costo ${costo}: contaminato più permissivo`);
    }
  }
});

test('stato del compito: la classe peggiore letta, contro la soglia del livello', () => {
  const f = (classe) => ({ classe, motivo: `classe ${classe}` });
  assert.equal(A.stato({ fonti: [], livello: 'conservativo' }).stato, 'pulito');
  assert.equal(A.stato({ fonti: [f(2)], livello: 'conservativo' }).stato, 'contaminato');
  assert.equal(A.stato({ fonti: [f(2)], livello: 'default' }).stato, 'pulito');
  assert.equal(A.stato({ fonti: [f(3)], livello: 'default' }).stato, 'contaminato');
  assert.equal(A.stato({ fonti: [f(3)], livello: 'automatico' }).stato, 'pulito');
  assert.equal(A.stato({ fonti: [f(3)], livello: 'yolo' }).stato, 'pulito');
  const s = A.stato({ fonti: [f(1), f(5), f(4)], livello: 'automatico' });
  assert.equal(s.stato, 'contaminato');
  assert.equal(s.classe, 5);
  assert.equal(s.fonte.motivo, 'classe 5', 'il motivo è quello della fonte peggiore');
  assert.equal(A.stato({ fonti: [f(1)], livello: 'livello-inventato' }).stato, 'pulito', 'livello ignoto = default');
});

test('fonti spostate dall’utente e manopola del campo: la manopola può solo abbassare la fiducia', () => {
  const sito = { classe: 5, campo: 'web', chiave: 'sito:blog.esempio.it', motivo: 'ho letto una pagina web' };
  assert.equal(A.classeFonte(sito, { spostamenti: { 'sito:blog.esempio.it': 3 } }), 3);
  assert.equal(A.stato({ fonti: [sito], livello: 'automatico', spostamenti: { 'sito:blog.esempio.it': 3 } }).stato, 'pulito');
  const file = { classe: 2, campo: 'file', motivo: 'file' };
  assert.equal(A.classeFonte(file, { manopole: { file: { diffida: true } } }), 3);
  assert.equal(A.classeFonte(sito, { manopole: { web: { diffida: true } } }), 5, 'oltre la 5 non si va');
  assert.equal(A.stato({ fonti: [file], livello: 'default', manopole: { file: { diffida: true } } }).stato, 'contaminato');
  // «quanto è grave sbagliare qui» alza il costo delle azioni del campo, mai sopra 3.
  assert.equal(A.decide({ livello: 'default', stato: 'pulito', costo: 2, campo: 'posta', manopole: { posta: { grave: true } } }), 'chiede');
  assert.equal(A.decide({ livello: 'default', stato: 'pulito', costo: 2, campo: 'web', manopole: { posta: { grave: true } } }), 'si');
  assert.equal(A.costoEffettivo(3, 'posta', { posta: { grave: true } }), 3);
  // Alzare una fonte vuole «conferma», abbassarla no.
  assert.equal(A.richiestaSpostamentoFonte(5, 3), 'conferma');
  assert.equal(A.richiestaSpostamentoFonte(3, 5), 'si');
});

test('sopra la tabella (a): un\'uscita fuori perimetro chiede, o cade nella cella contaminata col guardiano', () => {
  for (const livello of ['conservativo', 'default']) {
    for (let costo = 0; costo < 4; costo++) {
      const d = A.decide({ livello, stato: 'pulito', costo, dentroPerimetro: false });
      assert.ok(PESO[d] >= PESO.chiede, `${livello}/costo ${costo}: ${d}`);
    }
  }
  assert.equal(A.decide({ livello: 'automatico', stato: 'pulito', costo: 1, dentroPerimetro: false }), 'chiede');
  assert.equal(A.decide({ livello: 'automatico', stato: 'pulito', costo: 1, dentroPerimetro: false, guardiano: true }), 'si');
  assert.equal(A.decide({ livello: 'automatico', stato: 'pulito', costo: 3, dentroPerimetro: false, guardiano: true }), 'chiede');
  assert.equal(A.decide({ livello: 'yolo', stato: 'pulito', costo: 2, dentroPerimetro: false, guardiano: true }), 'si');
  assert.equal(A.decide({ livello: 'default', stato: 'pulito', costo: 1, dentroPerimetro: false, origine: 'automazione' }), 'propone');
});

test('sopra la tabella (b): da un\'automazione CHIEDE diventa PROPONE, CONFERMA propone con la parola', () => {
  const chiede = A.decideDettaglio({ livello: 'default', stato: 'contaminato', costo: 2, origine: 'automazione' });
  assert.deepEqual([chiede.risposta, chiede.digita], ['propone', false]);
  const conferma = A.decideDettaglio({ livello: 'default', stato: 'contaminato', costo: 3, origine: 'automazione' });
  assert.deepEqual([conferma.risposta, conferma.digita], ['propone', true]);
  assert.equal(A.decide({ livello: 'default', stato: 'pulito', costo: 1, origine: 'automazione' }), 'si');
  assert.equal(A.decide({ livello: 'conservativo', stato: 'contaminato', costo: 3, origine: 'automazione' }), 'no');
});

test('sopra la tabella (c): l\'elenco fisso dice no a ogni livello, stato, costo e origine', () => {
  for (const { id } of A.ELENCO_FISSO) {
    for (const livello of Object.keys(A.TABELLA)) {
      for (const stato of ['pulito', 'contaminato']) {
        for (let costo = 0; costo < 4; costo++) {
          for (const origine of ['chat', 'automazione']) {
            assert.equal(A.decide({ livello, stato, costo, origine, elenco: id, guardiano: true }), 'no', `${id}/${livello}/${stato}/${costo}/${origine}`);
          }
        }
      }
    }
  }
});

test('il testo di un no: «a nessun livello» solo per l\'elenco fisso; quello della tabella dice cosa ha letto e le strade', () => {
  const d = A.decideDettaglio({ livello: 'conservativo', stato: 'contaminato', costo: 3 });
  assert.equal(d.risposta, 'no');
  const fonte = { classe: 5, motivo: 'ho fatto una ricerca sul web' };
  const tabella = A.fraseNo({ regola: d.regola, fonte, livello: 'conservativo' });
  for (const t of [tabella.breve, tabella.perModello]) {
    assert.doesNotMatch(t, /nessun livello|elenco fisso|fra le cose che Filo non fa/, t);
    assert.match(t, /ricerca sul web/);
    assert.match(t, /conversazione nuova/);
    assert.match(t, /Preferenze/);
  }
  assert.match(tabella.breve, /Conservativo/);
  assert.doesNotMatch(tabella.perModello, /non cercare un'altra strada/);
  // Sulla pagina web la pagina stessa è la fonte: una conversazione nuova nasce uguale, resta il livello.
  const pagina = A.fraseNo({ regola: d.regola, fonte, livello: 'conservativo', daPagina: true });
  assert.doesNotMatch(`${pagina.breve} ${pagina.perModello}`, /conversazione nuova/);
  assert.match(pagina.perModello, /Preferenze/);
  // Lo stesso no, uscito dal perimetro, è ancora un no della tabella.
  const fuori = A.decideDettaglio({ livello: 'conservativo', stato: 'contaminato', costo: 3, dentroPerimetro: false });
  assert.equal(fuori.risposta, 'no');
  assert.doesNotMatch(A.fraseNo({ regola: fuori.regola, fonte, livello: 'conservativo' }).perModello, /nessun livello/);

  const e = A.decideDettaglio({ livello: 'automatico', stato: 'pulito', costo: 1, elenco: 'cancella-definitivo' });
  const elenco = A.fraseNo({ regola: e.regola, elenco: 'cancella-definitivo', dove: 'In Preferenze.' });
  assert.match(elenco.perModello, /nessun livello/);
  assert.match(elenco.perModello, /In Preferenze\./);
  assert.match(A.fraseNo({ regola: 'elenco', elenco: 'segreto', segreto: 'password' }).breve, /una password/);
});

test('sopra la tabella (d): abbassare una difesa vuole «conferma» a ogni livello', () => {
  for (const livello of Object.keys(A.TABELLA)) {
    for (const stato of ['pulito', 'contaminato']) {
      const d = A.decideDettaglio({ livello, stato, costo: 1, difesa: true, guardiano: true });
      if (d.risposta === 'no') continue;
      assert.deepEqual([d.risposta, d.digita, d.regola], ['conferma', true, 'difesa'], `${livello}/${stato}`);
    }
  }
  const auto = A.decideDettaglio({ livello: 'yolo', stato: 'pulito', costo: 0, difesa: true, origine: 'automazione' });
  assert.deepEqual([auto.risposta, auto.digita], ['propone', true]);
  // Il selettore delle Preferenze: alzare il livello vuole «conferma», abbassarlo no, yolo non si sceglie.
  assert.equal(A.richiestaCambioLivello('default', 'automatico'), 'conferma');
  assert.equal(A.richiestaCambioLivello('conservativo', 'default'), 'conferma');
  assert.equal(A.richiestaCambioLivello('automatico', 'conservativo'), 'si');
  assert.equal(A.richiestaCambioLivello('default', 'yolo'), 'no');
  assert.equal(A.selezionabile('yolo'), false, 'yolo esiste come valore ma aspetta il guardiano dei registri');
  assert.ok(A.livelloValido('yolo'));
  assert.deepEqual(A.livelliSelezionabili().map((l) => l.id), ['conservativo', 'default', 'automatico']);
});

test('un backup che rientra, o un ripristino, non alzano l\'autonomia: vince la più stretta', () => {
  assert.equal(A.unisciPiuStretta({ livello: 'conservativo' }, { livello: 'automatico' }).livello, 'conservativo');
  assert.equal(A.unisciPiuStretta({ livello: 'automatico' }, { livello: 'conservativo' }).livello, 'conservativo');
  assert.equal(A.unisciPiuStretta(undefined, { livello: 'yolo' }).livello, 'default');
  const m = A.unisciPiuStretta({ manopole: { posta: { grave: true } } }, { manopole: { posta: { grave: false, diffida: true } } }).manopole;
  assert.deepEqual(m.posta, { diffida: true, grave: true }, 'una manopola accesa resta accesa');
  const f = A.unisciPiuStretta({ fonti: { 'sito:a': 3 } }, { fonti: { 'sito:a': 1, 'sito:b': 1 } }).fonti;
  assert.deepEqual(f, { 'sito:a': 3 }, 'nessuna fonte sale di fiducia senza «conferma»');
  assert.equal(A.livelloAttivo('yolo'), 'default', 'yolo non vale finché non si può scegliere');
});

test('un costo non valido non parte mai', () => {
  for (const costo of [undefined, null, -1, 4, 1.5, '2']) assert.equal(A.decide({ livello: 'yolo', stato: 'pulito', costo }), 'no');
});

// ── il registro: costo e campo per ogni azione, e le fonti che le letture portano ─────────────────

test('sentinella: ogni azione del registro dichiara costo e campo, nessuna un livello fisso', () => {
  for (const [type, entry] of Object.entries(AL.REGISTRY)) {
    assert.ok('costo' in entry, `${type} senza costo`);
    assert.ok('campo' in entry, `${type} senza campo (null se non sta in nessuno)`);
    assert.ok(!('level' in entry), `${type} dichiara ancora un livello fisso`);
    const campo = AL.campoFor({ type });
    assert.ok(campo === null || A.campoValido(campo), `${type}: campo «${campo}» sconosciuto`);
    const ing = AL.ingressi({ type, chiave: 'tema', valore: 'scuro' });
    assert.ok(ing && A.costoValido(ing.costo), `${type}: costo non valido`);
  }
  for (const s of P.PREF_SETTERS) assert.ok(!('level' in s), `preferenza ${s.keys[0]} con un livello fisso`);
});

test('il dispatch rifiuta un\'azione senza costo: gli ingressi non esistono', () => {
  AL.REGISTRY.PROVA_SENZA_COSTO = { campo: null, describe: () => 'prova' };
  AL.REGISTRY.PROVA_COSTO_ROTTO = { costo: () => 7, campo: null, describe: () => 'prova' };
  try {
    assert.equal(AL.ingressi({ type: 'PROVA_SENZA_COSTO' }), null);
    assert.equal(AL.ingressi({ type: 'PROVA_COSTO_ROTTO' }), null);
    assert.equal(AL.ingressi({ type: 'NON_REGISTRATA' }), null);
  } finally {
    delete AL.REGISTRY.PROVA_SENZA_COSTO;
    delete AL.REGISTRY.PROVA_COSTO_ROTTO;
  }
});

test('mappa dei costi: livello 1 → 1, 2 → 2, 3 → 3, sola lettura → 0', () => {
  assert.equal(AL.costoFor({ type: 'TIMER' }), 1);
  assert.equal(AL.costoFor({ type: 'SALVA_LEZIONE', testo: 'L’utente non beve caffè' }), 2);
  assert.equal(AL.costoFor({ type: 'INVIA_FEEDBACK', testo: 'x' }), 2);
  assert.equal(AL.costoFor({ type: 'CANCELLA_ARCHIVIO', query: 'x' }), 3);
  for (const type of ['CERCA_WEB', 'CERCA_CHAT', 'CAPACITA_DETTAGLIO', 'LEGGI_FILE', 'LEGGI_TRASPARENZA']) {
    assert.equal(AL.costoFor({ type, query: 'meteo' }), 0, type);
  }
  assert.equal(AL.costoFor({ type: 'CERCA_WEB', query: 'x', _exfil: true }), 2);
});

const daAzioni = (azioni, extra = []) => [...extra, ...azioni.map((a) => AL.fonteDi(a)).filter(Boolean)];

test('le letture dichiarano cosa portano nel compito: web e disco lo sporcano, l\'editor no', () => {
  const ricerca = { type: 'CERCA_WEB', query: 'meteo', _output: { results: [{ url: 'https://x.it', title: 't' }] } };
  const editor = { type: 'LEGGI_FILE', fileId: 'f1', _output: { text: 'appunti' } };
  const disco = { type: 'LEGGI_DOCUMENTO', percorso: '~/a.pdf', _output: { text: 'bolletta', documentRead: '~/a.pdf', ok: true } };
  const scaricato = { type: 'LEGGI_DOCUMENTO', percorso: '~/Download/a.pdf', _output: { text: 'x', ok: true, scaricato: true } };
  const comando = { type: 'ESEGUI_COMANDO', comando: 'cat note.txt', _output: { stdout: 'ciao' } };
  const scarica = { type: 'ESEGUI_COMANDO', comando: 'curl https://x.it', _output: { stdout: '<html>' } };
  const chat = { type: 'CERCA_CHAT', query: 'x', _output: { results: [{ title: 't' }] } };
  assert.equal(AL.fonteDi(ricerca).classe, 5);
  assert.match(AL.fonteDi(ricerca).motivo, /ricerca sul web/);
  assert.equal(AL.fonteDi(editor).classe, 2);
  assert.equal(AL.fonteDi(disco).classe, 4);
  assert.equal(AL.fonteDi(scaricato).classe, 5);
  assert.equal(AL.fonteDi(comando).classe, 4);
  assert.equal(AL.fonteDi(scarica).classe, 5);
  assert.equal(AL.fonteDi(chat), null, 'le chat passate sono di Filo e dell’utente');
  assert.equal(AL.fonteDi({ type: 'CERCA_WEB', query: 'x', _output: { results: [] } }), null, 'una ricerca vuota non ha portato niente');
  assert.equal(AL.fonteDi({ type: 'ESEGUI_COMANDO', comando: 'ls', _output: { blocked: 'disabled' } }), null);
  assert.equal(A.stato({ fonti: daAzioni([editor, chat]), livello: 'default' }).stato, 'pulito');
  assert.equal(A.stato({ fonti: daAzioni([editor, ricerca]), livello: 'default' }).stato, 'contaminato');
  assert.equal(A.stato({ fonti: daAzioni([disco]), livello: 'automatico' }).stato, 'contaminato');
});

// Il cammino del dispatch, senza Electron: ingressi dal registro, stato dalle fonti, risposta dal modulo.
function risposta(action, { azioni = [], livello = 'default', richiesta = '', impostazioni = null, paginaWeb = false } = {}) {
  const ing = AL.ingressi(action, { richiesta, impostazioni });
  if (!ing) return 'rifiutata';
  const extra = paginaWeb ? [{ classe: 5, campo: 'web', motivo: 'ho letto una pagina web' }] : [];
  const st = A.stato({ fonti: daAzioni(azioni, extra), livello });
  return A.decide({
    livello, stato: st.stato, costo: ing.costo, campo: ing.campo, elenco: ing.elenco, difesa: ing.difesa, dentroPerimetro: ing.dentroPerimetro,
  });
}
const ricercaFatta = { type: 'CERCA_WEB', query: 'meteo', _output: { results: [{ url: 'https://x.it' }] } };

test('a default, compito pulito: il costo 2 parte da solo, il 3 chiede', () => {
  assert.equal(risposta({ type: 'SALVA_LEZIONE', testo: 'L’utente preferisce il tu' }), 'si');
  assert.equal(risposta({ type: 'INVIA_FEEDBACK', testo: 'la ricerca è lenta' }, { richiesta: 'segnala che la ricerca è lenta' }), 'si');
  assert.equal(risposta({ type: 'TIMER', seconds: 60 }), 'si');
  assert.equal(risposta({ type: 'ESEGUI_COMANDO', comando: 'rm -rf build' }), 'chiede');
});

test('a default, dopo aver letto cose scritte da altri: il costo 2 chiede, il 3 vuole «conferma»', () => {
  const dopo = { azioni: [ricercaFatta] };
  assert.equal(risposta({ type: 'SALVA_LEZIONE', testo: 'L’utente preferisce il tu' }, dopo), 'chiede');
  assert.equal(risposta({ type: 'ESEGUI_COMANDO', comando: 'rm -rf build' }, dopo), 'conferma');
  assert.equal(risposta({ type: 'TIMER', seconds: 60 }, dopo), 'si');
  assert.equal(risposta({ type: 'CERCA_WEB', query: 'altro' }, dopo), 'si', 'leggere di più è sempre libero');
  assert.equal(risposta({ type: 'INVIA_FEEDBACK', testo: 'x' }, { paginaWeb: true }), 'chiede', 'l’assistente su una pagina web');
});

test('una segnalazione che l\'utente non ha chiesto è fuori perimetro: chiede anche a compito pulito', () => {
  const fb = { type: 'INVIA_FEEDBACK', testo: 'Filo non sa ancora aprire i PDF protetti' };
  assert.equal(risposta(fb, { richiesta: 'aprimi questo pdf protetto' }), 'chiede');
  assert.equal(risposta(fb, { richiesta: 'aprimi questo pdf protetto', livello: 'automatico' }), 'chiede');
  for (const r of ['segnalalo agli sviluppatori', 'manda un feedback', 'di\' al team che manca', 'è un bug, riportalo']) {
    assert.equal(risposta(fb, { richiesta: r }), 'si', r);
  }
});

test('elenco fisso nel registro: cancellare la memoria, cambiare il livello, far uscire un segreto', () => {
  assert.equal(risposta({ type: 'CANCELLA_MEMORIA' }, { livello: 'automatico' }), 'no');
  assert.equal(risposta({ type: 'IMPOSTA_PREFERENZA', chiave: 'autonomia', valore: 'automatico' }), 'no');
  assert.equal(AL.ingressi({ type: 'IMPOSTA_PREFERENZA', chiave: 'autonomia', valore: 'automatico' }).elenco, 'regole');
  assert.match(AL.ingressi({ type: 'CANCELLA_MEMORIA' }).dove, /Memoria di Filo/);
  assert.equal(risposta({ type: 'NAVIGA', url: 'https://x.example/?password=Gatto2024!' }), 'no');
  assert.equal(risposta({ type: 'CERCA_WEB', query: 'il mio codice di verifica è 482913' }), 'no');
  assert.equal(risposta({ type: 'INVIA_FEEDBACK', testo: 'la mia chiave è sk-or-v1-0123456789abcdef0123456789abcdef' }), 'no');
  const iban = 'IT60X0542811101000000123456';
  assert.equal(risposta({ type: 'NAVIGA', url: `https://x.example/?iban=${iban}` }), 'no', 'coordinate bancarie non chieste');
  assert.equal(risposta({ type: 'NAVIGA', url: `https://x.example/?iban=${iban}` }, { richiesta: `apri il bonifico con l'iban ${iban}` }), 'si');
  assert.equal(AL.ingressi({ type: 'NAVIGA', url: 'https://x.example/?p=1' }).elenco, '');
});

test('preferenze: spegnere una difesa vuole «conferma», riaccenderla è costo 2', () => {
  assert.equal(risposta({ type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'on' }), 'conferma');
  assert.equal(risposta({ type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'off' }), 'si');
  assert.equal(risposta({ type: 'IMPOSTA_PREFERENZA', chiave: 'navigazione_sicura', valore: 'off' }), 'conferma');
  assert.equal(risposta({ type: 'IMPOSTA_PREFERENZA', chiave: 'navigazione_sicura', valore: 'on' }), 'si');
  assert.equal(risposta({ type: 'IMPOSTA_PREFERENZA', chiave: 'chiave_openrouter', valore: 'sk-or-v1-abc' }), 'conferma');
  assert.equal(risposta({ type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'scuro' }, { livello: 'automatico' }), 'si');
  const att = (mode) => ({ security: { cookies: { mode } }, monthlyLimitEur: 5 });
  assert.equal(risposta({ type: 'IMPOSTA_PREFERENZA', chiave: 'gestione_cookie', valore: 'automatico' }, { impostazioni: att('privacy') }), 'conferma');
  assert.equal(risposta({ type: 'IMPOSTA_PREFERENZA', chiave: 'gestione_cookie', valore: 'automatico' }, { impostazioni: att('manual') }), 'si');
  assert.equal(risposta({ type: 'IMPOSTA_PREFERENZA', chiave: 'limite_spesa', valore: '20' }, { impostazioni: att('default') }), 'conferma');
  assert.equal(risposta({ type: 'IMPOSTA_PREFERENZA', chiave: 'limite_spesa', valore: '2' }, { impostazioni: att('default') }), 'si');
  assert.equal(risposta({ type: 'IMPOSTA_PREFERENZA', chiave: 'limite_spesa', valore: '0' }, { impostazioni: att('default') }), 'conferma', 'zero vuol dire senza tetto');
});

test('segreti: controlli deterministici, che non gridano al lupo', () => {
  assert.equal(A.segreto('https://x.it/login?password=Ciao2024'), 'password');
  assert.equal(A.segreto('-----BEGIN OPENSSH PRIVATE KEY-----\nabc'), 'chiave');
  assert.equal(A.segreto('token ghp_0123456789abcdefghijABCDEFGHIJ0123'), 'chiave');
  assert.equal(A.segreto('codici di recupero: 8f3k-2m9q 4d7x-1p0z'), 'codice');
  assert.equal(A.segreto('il pin è 4821'), 'codice');
  assert.equal(A.segreto('4111 1111 1111 1111'), 'banca');
  assert.equal(A.segreto('https://x.it/?t=1696334400000'), '', 'un orario in millisecondi non è una carta');
  assert.equal(A.segreto('la password è troppo corta'), '');
  assert.equal(A.segreto('l’otp non arriva mai'), '');
  assert.equal(A.segreto('ricetta della pasta e fagioli'), '');
  assert.equal(A.segreto('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), '');
  assert.equal(A.segreto('https://www.pinterest.com/pin/123456789/'), '', 'una parola chiave in un percorso non è un codice');
  assert.equal(A.segreto('IT60X0542811101000000123456', { richiesta: 'manda IT60 X054 2811 1010 0000 0123 456' }), '');
});

// ── nessuna superficie decide da sé ──────────────────────────────────────────

function sorgenti(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...sorgenti(p));
    else if (/\.(m?js|html)$/.test(n)) out.push(p);
  }
  return out;
}

test('sentinella: ogni superficie che fa agire Filo chiede la risposta al modulo', () => {
  const tutti = sorgenti(join(ROOT, 'src'));
  for (const f of tutti) {
    const s = readFileSync(f, 'utf8');
    const rel = relative(ROOT, f).replace(/\\/g, '/');
    assert.doesNotMatch(s, /\blevelFor\s*\(/, `${rel}: il livello fisso non esiste più, si chiede a SN_AUTONOMIA`);
    if (rel !== 'src/shared/autonomia.js') {
      assert.doesNotMatch(s, /SN_AUTONOMIA\.TABELLA\b/, `${rel}: legge la tabella invece di chiedere la risposta`);
    }
  }
  // Il dispatch: una sola sospensione, dopo la risposta del modulo.
  const h = readFileSync(join(ROOT, 'src', 'main', 'services', 'handlers.js'), 'utf8');
  const corpo = h.slice(h.indexOf('async function executeFiloAction('), h.indexOf("    switch (type) {\n      case 'NAVIGA'"));
  assert.equal((h.match(/\bneedsConfirm:/g) || []).length, 1, 'needsConfirm si decide in un posto solo');
  assert.ok(corpo.indexOf('decisioneAutonomia(') > 0 && corpo.indexOf('decisioneAutonomia(') < corpo.indexOf('needsConfirm:'),
    'la sospensione viene dalla risposta di SN_AUTONOMIA');
  assert.match(h, /function decisioneAutonomia[\s\S]*?A\.decideDettaglio\(/);
  // L'agente sulla pagina: le sue azioni locali dichiarano il costo e chiedono la risposta al main.
  const side = readFileSync(join(ROOT, 'src', 'content', 'sidebar.js'), 'utf8');
  const tab = side.slice(side.indexOf('const PAGE_ACTIONS = {'), side.indexOf('};', side.indexOf('const PAGE_ACTIONS = {')));
  assert.doesNotMatch(tab, /confirm\s*:/, 'un\'azione della pagina non decide da sé se chiedere');
  for (const riga of tab.split('\n').filter((r) => /^\s+[a-z_]+:\s*\{/.test(r))) assert.match(riga, /costo:\s*[0-3]/, riga.trim());
  assert.match(side, /MSG\.FILO_DECIDI_PAGINA/);
  assert.match(h, /async function decisioneAzionePagina[\s\S]*?decisioneAutonomia\(/);
  // Le lezioni che Filo si scrive da solo dopo la chat passano dalla stessa regola di SALVA_LEZIONE.
  const chat = h.slice(h.indexOf('async function handleFiloChat('));
  const chiamata = chat.indexOf('maybeRunLessonAgent({ userMessage, filoReply: textReply');
  assert.ok(chiamata > 0 && chat.lastIndexOf('lezioniAutomaticheConsentite(', chiamata) > 0, 'le lezioni automatiche chiedono al modulo');
  assert.match(h, /async function lezioniAutomaticheConsentite[\s\S]*?decisioneAutonomia\(/);
});
