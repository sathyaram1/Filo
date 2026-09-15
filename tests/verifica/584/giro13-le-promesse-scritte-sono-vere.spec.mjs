// #584, tredicesimo giro — le promesse scritte, una per una, contro il codice.
//
// Questo lavoro promette l'anonimato in quattro punti, a quattro pubblici: la
// riga sotto «Ha funzionato?» (chi sta scegliendo), il manifesto delle capacita'
// (chi lo chiede a Filo in chat), le note di versione (chi aggiorna) e la pagina
// che spiega la sicurezza (chi va a leggere). Nove giri su dodici hanno trovato
// almeno una di quelle quattro frasi piu' generosa di quello che il codice fa, e
// una promessa di anonimato non mantenuta e' peggio del silenzio: chi la legge
// risponde di si' proprio perche' l'ha letta.
//
// Il ramo e' stato appena ribasato su main risolvendo dei conflitti, e tre di
// quei quattro testi stanno in file che il ribasamento ha toccato
// (patchNotes.js, capabilities.js, SECURITY.md). Una riga persa in un conflitto
// non la vede nessun diff e non la prende nessuna prova dei giri passati.
// Quindi qui si guardano due cose insieme: che le quattro frasi ci siano
// ancora, e che dicano il vero.

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const leggi = (p) => readFileSync(join(ROOT, p), 'utf8');

test('le quattro frasi che promettono l’anonimato ci sono ancora, dopo il ribasamento', async () => {
  // 1. La riga sotto «Ha funzionato?», l'unico punto in cui l'utente lo legge
  //    mentre sceglie.
  const sidebar = leggi('src/content/sidebar.js');
  expect(sidebar).toContain('Rispondendo condividi i passi di questo percorso');
  expect(sidebar).toContain('se resta qualcosa che dice chi sei, non lo pubblica');

  // 2. Il manifesto delle capacita': e' da li' che Filo risponde a chi in chat
  //    gli chiede cosa sa fare l'assistente di pagina.
  const cap = leggi('src/shared/capabilities.js');
  expect(cap).toContain('Alla fine ti chiede se ha funzionato');
  expect(cap).toContain('senza niente che dica chi sei');
  expect(cap).toContain('se chiudi il riquadro senza rispondere, Filo non condivide niente');

  // 3. Le note di versione.
  const note = leggi('src/shared/patchNotes.js');
  expect(note).toContain('con le altre installazioni non dice più chi');
  expect(note).toContain('può chiederli solo un sito per volta');
  expect(note).toContain('un indirizzo che non è un sito pubblico');

  // 4. La pagina che spiega la sicurezza.
  const sec = leggi('SECURITY.md');
  expect(sec).toContain('## 8. I percorsi condivisi dell\'Aiuto');
  expect(sec).toContain('non c\'è niente del mittente');
});

// Le promesse concrete di SECURITY.md §8, ognuna con l'indirizzo che la mette
// alla prova e il risultato che il testo dichiara. Se una riga qui diventa
// rossa, o e' cambiato il codice o e' cambiata la promessa: vanno insieme.
const PROMESSE = [
  // «Di /u/mario.rossi/ordini/847362 resta /u/[ID]/ordini/[NUMERO]»
  ['esempio.it', '/u/mario.rossi/ordini/847362', '/u/[ID]/ordini/[NUMERO]'],
  // «di /users/12345/mario-rossi resta /users/[ID]/[ID]»
  ['esempio.it', '/users/12345/mario-rossi', '/users/[ID]/[ID]'],
  // «la zona e' lunga due pezzi e si chiude al primo che non ha la forma di un
  // nome, cosi' /user/mariorossi/comments/abc tiene comments»
  ['esempio.it', '/user/mariorossi/comments/abc', '/user/[ID]/comments/abc'],
  // «di fatture-elettroniche resta fatture-[ID], di rossi-fatture resta [ID], e
  // note-spese resta per intero»
  ['banca.it', '/clienti/12345/fatture-elettroniche', '/clienti/[ID]/fatture-[ID]'],
  ['studio.it', '/clienti/12345/rossi-fatture', '/clienti/[ID]/[ID]'],
  ['banca.it', '/clienti/12345/note-spese', '/clienti/[ID]/note-spese'],
  // «Vale anche per il primo pezzo dopo la parola che annuncia la persona:
  // /utente/ordini e /utente/preferiti arrivavano scritti allo stesso modo»
  ['sito.it', '/utente/ordini', '/utente/ordini'],
  ['sito.it', '/utente/preferiti', '/utente/preferiti'],
  // «in testa all'indirizzo sui siti dove il primo pezzo e' sempre un profilo»
  ['github.com', '/mariorossi/progetto', '/[ID]/progetto'],
  // «…a meno che non sia una sezione pubblica riconoscibile, che li' sta per tutti»
  ['github.com', '/notifications', '/notifications'],
];

test('le promesse sull’indirizzo di partenza sono vere, in scrittura e in lettura', async ({ app }) => {
  const esiti = await app.evaluate(async ({ app: _a }, casi) => {
    const S = globalThis.SN_PATHS_SAFETY;
    return casi.map(([host, percorso]) => {
      const scritto = S._internal.redigiPercorso(percorso, host);
      // La stessa regola decide una seconda volta quando qualcuno RIUSA il
      // percorso: deve dare la stessa risposta, o quello che si legge non e'
      // quello che si e' pubblicato.
      const riletto = S._internal.sanitizeInitialUrl(scritto, host);
      return { host, percorso, scritto, riletto };
    });
  }, PROMESSE);
  for (let i = 0; i < PROMESSE.length; i += 1) {
    const [host, percorso, atteso] = PROMESSE[i];
    expect(esiti[i].scritto, `${host}${percorso} in scrittura`).toBe(atteso);
    expect(esiti[i].riletto, `${host}${percorso} in lettura`).toBe(atteso);
  }
});

test('«dai tre campi vengono cancellati email, IBAN, codici fiscali, numeri lunghi e i numeri scritti con spazi»', async ({ app }) => {
  const esiti = await app.evaluate(async ({ app: _a }, dati) => {
    const S = globalThis.SN_PATHS_SAFETY;
    return dati.map((d) => ({
      d,
      selettore: S._internal.redactSelector(d),
      intento: S._internal.sanitizeIntent(d),
    }));
  }, [
    'scrivi a mario.rossi@banca.it',
    'IT60X0542811101000000123456',
    'RSSMRA80A01H501U',
    'ordine 847362',
    '333 123 4567',
    '4111 1111 1111 1111',
    'Profilo di @mariorossi',
  ]);
  // Il testo di partenza non deve restare in nessuno dei due campi che escono.
  const segnaposti = /\[(EMAIL|IBAN|CODICE|NUMERO|ID)\]/;
  for (const e of esiti) {
    expect(e.selettore, `selettore per ${e.d}`).toMatch(segnaposti);
    expect(e.intento, `intento per ${e.d}`).toMatch(segnaposti);
  }
  expect(esiti[0].selettore).toBe('scrivi a [EMAIL]');
  expect(esiti[1].selettore).toBe('[IBAN]');
  expect(esiti[2].selettore).toBe('[CODICE]');
  expect(esiti[6].selettore).toBe('Profilo di [ID]');
});

test('«i siti che non sono di nessuno non si raccolgono affatto», e la lista è quella scritta', async ({ app }) => {
  const esiti = await app.evaluate(async ({ app: _a }, nomi) => {
    const S = globalThis.SN_PATHS_SAFETY;
    const P = globalThis.SN_PATHS;
    return nomi.map((n) => ({
      n,
      scrive: S.sitoCondivisibile(n),
      legge: !!P._internal.segmentoDominio(n),
    }));
  }, [
    // quelli che SECURITY.md elenca
    '192.168.1.1', 'localhost', 'options', 'nas-rossi.local', 'ufficio.lan',
    'server.intranet', 'app.localhost', 'progetto-rossi.test', 'x.invalid',
    'x.example', 'abc.onion', 'abc.alt', 'abc.i2p', 'localhost.',
    // e un sito vero, che deve passare
    'negoziofelice.it', 'esempio.it.',
  ]);
  for (const e of esiti.slice(0, 14)) {
    expect(e.scrive, `${e.n} non si raccoglie`).toBe(false);
    // «la lettura va con la scrittura»: una cartella che nessuno deve
    // indovinare e' la stessa per tutti.
    expect(e.legge, `${e.n} non si legge`).toBe(false);
  }
  for (const e of esiti.slice(14)) {
    expect(e.scrive, `${e.n} si raccoglie`).toBe(true);
    expect(e.legge, `${e.n} si legge`).toBe(true);
  }
});

test('«Filo non spedisce un percorso quando lo fai»: resta sul computer per ore, e la coda non ne manda due insieme', async ({ app }) => {
  const esito = await app.evaluate(async () => {
    const PC = globalThis.SN_PATHS_COLLECTOR;
    PC._reset();
    PC._setAuto(false);
    const ritardi = [];
    for (let i = 0; i < 50; i += 1) {
      PC._setSorteggio(() => i / 50);
      const r = await PC._internal.accoda({
        domain: 'esempio.it', initialUrl: '/x', intent: 'i',
        steps: [{ selector: 's', action: 'click' }], success: true,
      });
      const v = PC._peek().find((x) => x.id === r.id);
      ritardi.push(v.nonPrimaDi - v.accodatoIl);
    }
    PC._reset();
    return { min: Math.min(...ritardi), max: Math.max(...ritardi), n: ritardi.length };
  });
  expect(esito.n).toBe(50);
  // «a un'ora sorteggiata nelle ventiquattr'ore successive»: mai subito.
  expect(esito.min).toBeGreaterThanOrEqual(30 * 60 * 1000);
  expect(esito.max).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  // E sorteggiata davvero: due percorsi della stessa sessione non escono
  // insieme.
  expect(esito.max - esito.min).toBeGreaterThan(60 * 60 * 1000);
});
