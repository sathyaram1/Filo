// Unit test per src/shared/autonomia.js — LA REGOLA di «Filo può fare X?»
// (#530): la tabella intera, cella per cella, le quattro regole che le stanno
// sopra, le manopole dei campi, e le sentinelle che impediscono a una
// superficie di decidere per conto suo o alla tabella di diventare incoerente.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'autonomia.js'));
const A = globalThis.SN_AUTONOMIA;

// La tabella come sta scritta nella regola, ricopiata a mano: se il modulo la
// cambia senza che nessuno se ne accorga, qui diventa rosso.
const ATTESA = {
  conservativo: {
    pulito: ['si', 'si', 'chiede', 'chiede'],
    contaminato: ['si', 'chiede', 'chiede', 'no'],
  },
  default: {
    pulito: ['si', 'si', 'si', 'chiede'],
    contaminato: ['si', 'si', 'chiede', 'conferma'],
  },
  automatico: {
    pulito: ['si', 'si', 'si', 'si+G'],
    contaminato: ['si', 'si', 'si+G', 'chiede'],
  },
  yolo: {
    pulito: ['si', 'si', 'si', 'si+G'],
    contaminato: ['si', 'si+G', 'si+G', 'si+G'],
  },
};

test('il modulo si registra su globalThis con la sua API', () => {
  assert.ok(A);
  assert.equal(typeof A.decide, 'function');
  assert.equal(typeof A.valuta, 'function');
  assert.ok(Array.isArray(A.LIVELLI));
  assert.ok(A.TABELLA && A.ELENCO_FISSO && A.CLASSI && A.COSTI && A.CAMPI && A.MANOPOLE);
});

test('la TABELLA è quella della regola, cella per cella', () => {
  assert.deepEqual(A.TABELLA, ATTESA);
});

test('tutte e 32 le celle: decide() risponde quello che dice la tabella', () => {
  // 4 livelli × 2 stati × 4 costi. «si+G» (parte da sola dopo il guardiano di
  // uscita) vale CHIEDE finché il guardiano non esiste.
  let celle = 0;
  for (const livello of Object.keys(ATTESA)) {
    for (const stato of ['pulito', 'contaminato']) {
      for (let costo = 0; costo <= 3; costo += 1) {
        const attesa = A.risolviGuardiano(ATTESA[livello][stato][costo]);
        assert.equal(
          A.decide({ livello, stato, costo }),
          attesa,
          `${livello}/${stato}/costo ${costo} → atteso ${attesa}`,
        );
        celle += 1;
      }
    }
  }
  assert.equal(celle, 32, 'la tabella deve avere 32 celle');
});

test('SENTINELLA: nessuna cella vuota, e ogni valore è una risposta vera', () => {
  const ammessi = [...A.RISPOSTE, A.SI_G];
  for (const [livello, righe] of Object.entries(A.TABELLA)) {
    assert.ok(A.livello(livello), `livello sconosciuto nella tabella: ${livello}`);
    for (const stato of A.STATI) {
      const riga = righe[stato];
      assert.ok(Array.isArray(riga), `${livello}/${stato}: riga mancante`);
      assert.equal(riga.length, 4, `${livello}/${stato}: servono 4 costi`);
      riga.forEach((v, costo) => {
        assert.ok(v, `${livello}/${stato}/costo ${costo}: cella vuota`);
        assert.ok(ammessi.includes(v), `${livello}/${stato}/costo ${costo}: risposta sconosciuta ${v}`);
      });
    }
  }
  // Ogni livello dichiarato ha la sua riga: un livello senza tabella sarebbe
  // una scelta che non si sa cosa faccia.
  for (const l of A.LIVELLI) assert.ok(A.TABELLA[l.id], `il livello ${l.id} non ha una riga nella tabella`);
});

test('SENTINELLA: contaminato non è MAI più permissivo di pulito', () => {
  for (const [livello, righe] of Object.entries(A.TABELLA)) {
    for (let costo = 0; costo <= 3; costo += 1) {
      const pulito = righe.pulito[costo];
      const sporco = righe.contaminato[costo];
      assert.equal(
        A.piuStretta(pulito, sporco), sporco,
        `${livello}/costo ${costo}: contaminato (${sporco}) è più permissivo di pulito (${pulito})`,
      );
    }
  }
});

test('SENTINELLA: dentro una riga, un costo più alto non chiede mai meno', () => {
  for (const [livello, righe] of Object.entries(A.TABELLA)) {
    for (const stato of A.STATI) {
      for (let costo = 1; costo <= 3; costo += 1) {
        const prima = righe[stato][costo - 1];
        const dopo = righe[stato][costo];
        assert.equal(
          A.piuStretta(prima, dopo), dopo,
          `${livello}/${stato}: il costo ${costo} (${dopo}) chiede meno del costo ${costo - 1} (${prima})`,
        );
      }
    }
  }
});

test('lo stato del compito è la classe MENO fidata letta, contro la soglia del livello', () => {
  // Soglie: conservativo classe 1; default 1-2; automatico e yolo 1-3.
  assert.equal(A.statoPerFonti(['chat', 'memoria'], 'conservativo'), 'pulito');
  assert.equal(A.statoPerFonti(['editor'], 'conservativo'), 'contaminato');
  assert.equal(A.statoPerFonti(['editor'], 'default'), 'pulito');
  assert.equal(A.statoPerFonti(['documento'], 'default'), 'contaminato');
  assert.equal(A.statoPerFonti(['documento'], 'automatico'), 'contaminato', 'classe 4: sopra la soglia anche ad automatico');
  assert.equal(A.statoPerFonti(['ricerca'], 'automatico'), 'contaminato');
  assert.equal(A.statoPerFonti([], 'default'), 'pulito', 'un compito che non ha letto niente è pulito');
  // Basta UNA fonte sporca fra dieci pulite.
  assert.equal(A.statoPerFonti(['chat', 'memoria', 'editor', 'web'], 'default'), 'contaminato');
  // Una fonte che il modulo non conosce vale 5: non sappiamo chi l'ha scritta.
  assert.equal(A.statoPerFonti(['boh'], 'automatico'), 'contaminato');
});

test('il caso che ha fatto nascere la regola: leggo una pagina, poi salvo una lezione', () => {
  const costoLezione = 2;
  // Compito pulito, livello normale: Filo la fissa e basta, come ieri.
  assert.equal(A.decide({ livello: 'default', fonti: ['chat'], costo: costoLezione }), 'si');
  // Dopo una ricerca sul web: chiede, e dice perché.
  const dopo = A.valuta({ livello: 'default', fonti: ['chat', 'ricerca'], costo: costoLezione });
  assert.equal(dopo.risposta, 'chiede');
  assert.equal(dopo.stato, 'contaminato');
  assert.match(dopo.motivo, /ho letto/i);
  assert.match(dopo.motivo, /ricerca sul web/i);
  // E una pagina web lo dice con le sue parole.
  assert.match(A.valuta({ livello: 'default', fonti: ['web'], costo: 3 }).motivo, /pagina web/i);
  // Costo 3 con compito contaminato: la parola digitata.
  assert.equal(A.decide({ livello: 'default', fonti: ['web'], costo: 3 }), 'conferma');
});

test('leggere è sempre libero: costo 0 non chiede mai niente', () => {
  for (const livello of ['conservativo', 'default', 'automatico', 'yolo']) {
    for (const stato of ['pulito', 'contaminato']) {
      assert.equal(A.decide({ livello, stato, costo: 0 }), 'si', `${livello}/${stato}`);
    }
  }
  // Nemmeno fuori perimetro: il perimetro riguarda le uscite.
  assert.equal(A.decide({ livello: 'conservativo', stato: 'contaminato', costo: 0, dentroPerimetro: false }), 'si');
});

test('(a) fuori perimetro: da chat chiede a conservativo e default, cella contaminata ad automatico e yolo', () => {
  assert.equal(A.decide({ livello: 'conservativo', stato: 'pulito', costo: 1, dentroPerimetro: false }), 'chiede');
  assert.equal(A.decide({ livello: 'default', stato: 'pulito', costo: 1, dentroPerimetro: false }), 'chiede');
  // Ad automatico e yolo vale la cella contaminata CON il guardiano: oggi che
  // il guardiano non c'è, è una richiesta di conferma.
  assert.equal(A.decide({ livello: 'automatico', stato: 'pulito', costo: 1, dentroPerimetro: false }), 'chiede');
  assert.equal(A.decide({ livello: 'yolo', stato: 'pulito', costo: 1, dentroPerimetro: false }), 'chiede');
  assert.equal(A.valuta({ livello: 'automatico', stato: 'pulito', costo: 1, dentroPerimetro: false }).guardiano, true);
  // Non può ALLENTARE: una cella che già diceva «no» resta «no».
  assert.equal(A.decide({ livello: 'conservativo', stato: 'contaminato', costo: 3, dentroPerimetro: false }), 'no');
  // Da un'automazione, fuori perimetro si propone.
  assert.equal(A.decide({ livello: 'default', stato: 'pulito', costo: 1, dentroPerimetro: false, origine: 'automazione' }), 'propone');
});

test('(b) origine automazione: quello che si chiede diventa una proposta', () => {
  // chiede → propone (un clic approva)
  assert.equal(A.decide({ livello: 'conservativo', stato: 'pulito', costo: 2, origine: 'automazione' }), 'propone');
  // conferma → propone, ma con la parola digitata addosso
  const p = A.valuta({ livello: 'default', stato: 'contaminato', costo: 3, origine: 'automazione' });
  assert.equal(p.risposta, 'propone');
  assert.equal(p.parola, true);
  // «sì» resta sì, «no» resta no: una proposta non è un permesso.
  assert.equal(A.decide({ livello: 'default', stato: 'pulito', costo: 1, origine: 'automazione' }), 'si');
  assert.equal(A.decide({ livello: 'conservativo', stato: 'contaminato', costo: 3, origine: 'automazione' }), 'no');
  // Origine sconosciuta → chat (il caso prudente: si chiede, non si propone).
  assert.equal(A.decide({ livello: 'conservativo', stato: 'pulito', costo: 2, origine: 'boh' }), 'chiede');
});

test('(c) elenco fisso: no a OGNI livello, anche col compito pulito e a costo basso', () => {
  for (const voce of A.ELENCO_FISSO) {
    assert.ok(voce.id && voce.label && voce.desc, 'ogni voce dell\'elenco fisso si spiega');
    for (const livello of ['conservativo', 'default', 'automatico', 'yolo']) {
      assert.equal(
        A.decide({ livello, stato: 'pulito', costo: 1, vietato: voce.id }), 'no',
        `${livello}: ${voce.id} deve essere no`,
      );
    }
  }
  // Le cinque voci della regola, per id.
  assert.deepEqual(A.ELENCO_FISSO.map((v) => v.id).sort(), [
    'cancellazione-definitiva', 'credenziali', 'molti-destinatari',
    'regole-di-autonomia', 'segreto-in-uscita',
  ]);
  // Il motivo che arriva all'utente non è «no e basta».
  assert.ok(A.valuta({ livello: 'default', stato: 'pulito', costo: 3, vietato: 'cancellazione-definitiva' }).motivo.length > 10);
  // Una voce inventata non blocca niente (e non diventa un «no» muto).
  assert.equal(A.decide({ livello: 'default', stato: 'pulito', costo: 1, vietato: 'boh' }), 'si');
});

test('(d) abbassare una difesa vuole la parola digitata, a ogni livello', () => {
  for (const livello of ['conservativo', 'default', 'automatico', 'yolo']) {
    assert.equal(A.decide({ livello, stato: 'pulito', costo: 1, allentaDifesa: true }), 'conferma', livello);
  }
  // Ma non risuscita un «no»: l'elenco fisso viene prima.
  assert.equal(A.decide({
    livello: 'default', stato: 'pulito', costo: 1, allentaDifesa: true, vietato: 'regole-di-autonomia',
  }), 'no');
  // Da un'automazione diventa una proposta con la parola.
  const p = A.valuta({ livello: 'default', stato: 'pulito', costo: 1, allentaDifesa: true, origine: 'automazione' });
  assert.equal(p.risposta, 'propone');
  assert.equal(p.parola, true);
});

test('i campi non hanno un livello proprio: due manopole, e solo restringono', () => {
  const manopole = { terminale: { gravita: true }, web: { fiducia: true } };
  // «Quanto è grave sbagliare qui» alza di uno il costo delle azioni del campo.
  assert.equal(A.costoConManopole(1, 'terminale', manopole), 2);
  assert.equal(A.costoConManopole(3, 'terminale', manopole), 3, 'il costo non sfonda il tetto');
  assert.equal(A.costoConManopole(1, 'posta', manopole), 1, 'la manopola vale solo per il suo campo');
  // Senza manopole niente cambia.
  assert.equal(A.costoConManopole(1, 'terminale', null), 1);
  // «Quanto mi fido di ciò che leggo da qui» abbassa di una classe le fonti.
  assert.equal(A.classeConManopole(2, 'web', manopole), 3);
  assert.equal(A.classeConManopole(5, 'web', manopole), 5, 'la classe non sfonda il fondo');
  assert.equal(A.classeConManopole(2, 'terminale', manopole), 2);
  // La manopola della fiducia vale sul campo della FONTE, non su quello in cui
  // si sta per agire: una ricerca sul web resta roba del web anche mentre Filo
  // scrive un file.
  assert.equal(A.campoFonte('ricerca'), 'web');
  assert.equal(A.campoFonte('documento'), 'file');
  assert.equal(A.campoFonte('chat'), null);
  // Con la fiducia del web abbassata, una ricerca scende di una classe: a
  // livello automatico (soglia 3) una fonte già a 5 resta contaminata, mentre
  // una fonte dell'editor portata giù di uno passa da 2 a 3, che è ancora
  // dentro la soglia.
  assert.equal(A.statoPerFonti(['editor'], 'default', { manopole: { file: { fiducia: true } } }), 'contaminato');
  assert.equal(A.statoPerFonti(['editor'], 'default'), 'pulito');
  // E si vede nella decisione: a livello normale un'azione di costo 1 nel
  // terminale, col compito pulito, diventa costo 2, che resta un sì; a
  // conservativo invece passa da sì a chiede.
  assert.equal(A.decide({ livello: 'conservativo', stato: 'pulito', costo: 1, campo: 'terminale', manopole }), 'chiede');
  assert.equal(A.decide({ livello: 'conservativo', stato: 'pulito', costo: 1, campo: 'terminale' }), 'si');
  // Un campo inventato non restringe niente (e non crasha).
  assert.equal(A.decide({ livello: 'default', stato: 'pulito', costo: 2, campo: 'astronave', manopole }), 'si');
});

test('l\'utente può spostare una fonte di classe, e lo spostamento si vede', () => {
  // Le pagine web portate a classe 3: a livello automatico il compito resta
  // pulito. (Alzare una fonte è allentare una difesa: la parola digitata la
  // chiede la regola (d) a chi scrive lo spostamento.)
  assert.equal(A.classeFonte('web'), 5);
  assert.equal(A.classeFonte('web', { web: 3 }), 3);
  assert.equal(A.statoPerFonti(['web'], 'automatico', { fontiSpostate: { web: 3 } }), 'pulito');
  assert.equal(A.statoPerFonti(['web'], 'automatico'), 'contaminato');
  // Uno spostamento fuori scala (0, 9, «tanto») viene ignorato.
  for (const v of [0, 9, 'tanto', null]) assert.equal(A.classeFonte('web', { web: v }), 5, `spostamento ${v}`);
});

test('ogni fonte dichiara classe e frase; ogni classe e ogni costo hanno un\'etichetta', () => {
  for (const [id, f] of Object.entries(A.FONTI)) {
    assert.ok(f.classe >= A.CLASSE_MIN && f.classe <= A.CLASSE_MAX, `${id}: classe fuori scala`);
    assert.ok(f.frase && f.frase.length > 3, `${id}: senza la frase il popup non sa dire perché chiede`);
    assert.ok(!/^[A-Z]/.test(f.frase), `${id}: la frase va in mezzo a un'altra ("ho letto …")`);
  }
  assert.equal(A.CLASSI.length, 5);
  assert.equal(A.COSTI.length, 4);
  for (const c of A.CLASSI) assert.ok(c.label && c.esempi);
  for (const c of A.COSTI) assert.ok(c.label && c.esempi);
});

test('il livello: yolo esiste ma non si sceglie; un valore sconosciuto ricade sul default', () => {
  assert.equal(A.LIVELLO_DEFAULT, 'default');
  assert.ok(A.livello('yolo'));
  assert.equal(A.livello('yolo').selezionabile, false);
  assert.equal(A.livelloValido('yolo'), 'default', 'dalle impostazioni yolo non è scegliibile');
  assert.equal(A.livelloValido('boh'), 'default');
  assert.equal(A.livelloValido(''), 'default');
  assert.equal(A.livelloValido(null), 'default');
  assert.equal(A.livelloValido('AUTOMATICO'), 'automatico', 'il nome non è sensibile alle maiuscole');
  assert.deepEqual(A.livelliSelezionabili().map((l) => l.id), ['conservativo', 'default', 'automatico']);
  for (const l of A.livelliSelezionabili()) assert.ok(l.label && l.frase, `${l.id}: senza frase il selettore non si capisce`);
  // L'ordine è dal più prudente al più permissivo: serve a sapere se un cambio
  // ALZA il livello (e quindi vuole la parola digitata).
  assert.equal(A.alzaLivello('conservativo', 'default'), true);
  assert.equal(A.alzaLivello('automatico', 'default'), false);
  assert.equal(A.alzaLivello('default', 'default'), false);
  assert.equal(A.FRASI_SELETTORE.length, 3);
});

test('un\'azione senza costo non si valuta: no, col motivo', () => {
  for (const costo of [undefined, null, -1, 4, 'due', NaN]) {
    const r = A.valuta({ livello: 'yolo', stato: 'pulito', costo });
    assert.equal(r.risposta, 'no', `costo ${costo}`);
    assert.equal(r.regola, 'costo-mancante');
    assert.ok(r.motivo.length > 10);
  }
});

test('input storti: la regola non esplode e non allenta', () => {
  assert.equal(A.decide({}), 'no', 'senza niente non si fa niente');
  assert.equal(A.decide({ livello: 'default', costo: 2 }), 'si', 'senza stato si parte da pulito');
  assert.equal(A.decide({ livello: 'default', stato: 'boh', costo: 3 }), 'chiede', 'uno stato sconosciuto vale pulito');
  assert.equal(A.decide({ livello: 'default', fonti: 'web', costo: 3 }), 'chiede', 'fonti non-elenco: si ignora');
  assert.equal(A.decide({ livello: 'default', fonti: [], costo: 2 }), 'si');
  assert.equal(A.decide({ livello: 'default', fonti: [null, undefined, 'web'], costo: 2 }), 'chiede');
});

// ── SENTINELLA: nessuna superficie decide per conto suo ─────────────────────
// La regola sta in un posto solo. Chi sospende un'azione in attesa di conferma
// (`needsConfirm`) deve averla chiesta al modulo; e il costo di un'azione lo
// può leggere solo chi poi passa di lì. Senza questa sentinella, la seconda
// superficie che nasce (la posta, un'automazione) si riscrive la sua regola e
// le due divergono in silenzio.
function fileJs(dir, out = []) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    const st = statSync(p);
    if (st.isDirectory()) fileJs(p, out);
    else if (/\.(js|mjs)$/.test(nome)) out.push(p);
  }
  return out;
}

test('SENTINELLA: chi sospende un\'azione in attesa di conferma passa dalla regola', () => {
  const tutti = fileJs(join(ROOT, 'src'));
  const produttori = [];
  for (const f of tutti) {
    const src = readFileSync(f, 'utf8');
    // `needsConfirm:` in scrittura = qui si decide di sospendere un'azione.
    if (/needsConfirm\s*:/.test(src)) produttori.push(f);
  }
  assert.ok(produttori.length >= 1, 'nessuno sospende più niente: la sentinella guarda nel posto sbagliato');
  for (const f of produttori) {
    const src = readFileSync(f, 'utf8');
    assert.match(
      src, /SN_AUTONOMIA/,
      `${relative(ROOT, f)} decide di chiedere conferma senza passare da src/shared/autonomia.js`,
    );
  }
});

test('SENTINELLA: il costo di un\'azione lo legge solo chi poi chiama la regola', () => {
  const ammessi = new Set(['src/shared/actionLevels.js', 'src/main/services/handlers.js']);
  for (const f of fileJs(join(ROOT, 'src'))) {
    const src = readFileSync(f, 'utf8');
    if (!/\bcostoFor\s*\(/.test(src)) continue;
    const rel = relative(ROOT, f).split('\\').join('/');
    assert.ok(
      ammessi.has(rel),
      `${rel} legge il costo di un'azione: o chiama SN_AUTONOMIA.decide, o non deve leggerlo`,
    );
    if (rel !== 'src/shared/actionLevels.js') assert.match(src, /SN_AUTONOMIA/, `${rel} legge il costo ma non chiama la regola`);
  }
});

test('SENTINELLA: la regola non legge lo storage, il DOM o la rete (è pura)', () => {
  const src = readFileSync(join(ROOT, 'src', 'shared', 'autonomia.js'), 'utf8');
  for (const proibito of ['document.', 'window.', 'localStorage', 'fetch(', 'require(', 'SN_STORAGE']) {
    assert.ok(!src.includes(proibito), `autonomia.js non deve usare ${proibito}`);
  }
});

test('SENTINELLA: il modulo è nell\'ordine del loader', () => {
  const loader = readFileSync(join(ROOT, 'src', 'main', 'services', 'loader.js'), 'utf8');
  const iAut = loader.indexOf("'autonomia.js'");
  const iAz = loader.indexOf("'actionLevels.js'");
  assert.ok(iAut > 0, 'autonomia.js non è caricato dal loader: su globalThis non ci arriva mai');
  assert.ok(iAut < iAz, 'autonomia.js va caricato PRIMA del registro delle azioni');
});
