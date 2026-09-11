// Verifica #584, giro 1 — il cammino di lettura dei percorsi condivisi.
//
// Il feedback chiede due cose insieme: che la collezione intera non si scarichi
// più, e che l'assistente di pagina continui a trovare i "percorsi già
// riusciti" su un sito dove ce ne sono. Qui si guarda il cammino del CLIENT:
// cosa esce davvero sul filo quando Filo chiede i percorsi, e cosa rientra.
//
// Non apre Filo di proposito: è logica pura (un client REST), e una spec che
// accende Electron per non guardarci niente costa minuti per nulla — la regola
// del repo (CLAUDE.md § Verifica) dice di provarla col controllo veloce.
// L'altra metà — le REGOLE, provate col motore vero — sta nel file accanto,
// `giro1-regole-motore-vero.mjs`.
//
// COSA HA TROVATO QUESTO GIRO. L'ultimo caso qui sotto è il rilievo: il
// documento che torna al lettore porta `createTime`, la marca che mette
// Firestore da sé, al microsecondo. È la chiave di join che l'arrotondamento
// all'ora di `createdAt` voleva togliere, e non si può sopprimere finché la
// lettura è diretta.
//
// COM'È STATO CHIUSO, nella correzione dello stesso giro. Quella marca esce
// comunque, quindi si è fatto in modo che non dica più niente: un percorso non
// parte più quando lo fai, entra in una coda sul disco e ne esce a un'ora
// sorteggiata nelle ventiquattro ore dopo, uno alla volta. L'ultimo caso resta
// com'era, perché continua a descrivere il vero: la marca arriva al lettore. A
// cambiare è cosa significa. La guardia sempre accesa sul rimedio sta dove la
// suite la rilancerà per sempre, in `tests/unit/pathsRitardo.test.mjs`.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..', '..', '..');

// Il modulo della lettura, dentro una scatola sua, con la rete finta.
// Prima c'è constants.js, che è il modulo base: da lì paths.js prende la
// funzione che appiattisce un pezzo di testo scritto da uno sconosciuto prima
// di metterlo in un prompt. Sta li' dal quarto giro, perché la stessa serve
// anche dalla parte della scrittura e una definizione sola vale per tutte e
// due; caricare paths.js da solo, da qui in poi, è caricarlo senza le sue basi.
function caricaPaths() {
  const g = {};
  for (const modulo of ['constants.js', 'paths.js']) {
    const src = readFileSync(resolve(APP_ROOT, 'src', 'shared', modulo), 'utf8');
    new Function('globalThis', 'self', 'fetch', `${src}`).call(
      g, g, g, (...a) => g.__fetch(...a),
    );
  }
  return g;
}

function rispostaQuery(documenti) {
  return {
    ok: true,
    json: async () => documenti.map((d) => ({ document: d })),
    text: async () => '',
  };
}

test('chiedere i percorsi vuol dire nominare un dominio: sul filo non passa nessuna richiesta della collezione intera', async () => {
  const g = caricaPaths();
  const chiamate = [];
  g.__fetch = async (url, opts) => {
    chiamate.push({ url, body: JSON.parse(opts.body) });
    return rispostaQuery([]);
  };

  await g.SN_PATHS.listByDomain('esempio.it', { pageSize: 50 });

  expect(chiamate).toHaveLength(1);
  const { url, body } = chiamate[0];
  // il dominio è un pezzo dell'indirizzo, non un filtro nel corpo
  expect(url).toContain('/documents/paths/esempio.it:runQuery');
  expect(JSON.stringify(body)).not.toContain('domain');
  // niente query di gruppo: `allDescendants` rimetterebbe in piedi il download
  // di tutti i domini insieme
  for (const from of body.structuredQuery.from) {
    expect(from.allDescendants).toBeFalsy();
  }
  expect(body.structuredQuery.limit).toBe(50);
});

test('un dominio che non è un nome di host non diventa una richiesta a caso: non si legge niente', async () => {
  const g = caricaPaths();
  let chiamato = false;
  g.__fetch = async () => { chiamato = true; return rispostaQuery([]); };

  for (const cattivo of ['', '   ', 'a/b', 'esempio.it/../altro', '__proto__', '.', '..',
    'e sempio.it', 'esempio.it?x=1', 'https://esempio.it', '<script>', 'x'.repeat(400)]) {
    expect(await g.SN_PATHS.listByDomain(cattivo), `"${String(cattivo).slice(0, 40)}"`).toEqual([]);
  }
  expect(chiamato, 'nessuna di queste doveva toccare la rete').toBe(false);
});

test('il tetto della lettura si rispetta da soli invece di farsi rifiutare la richiesta', async () => {
  const g = caricaPaths();
  const limiti = [];
  g.__fetch = async (_url, opts) => {
    limiti.push(JSON.parse(opts.body).structuredQuery.limit);
    return rispostaQuery([]);
  };
  await g.SN_PATHS.listByDomain('esempio.it', { pageSize: 100000 });
  await g.SN_PATHS.listByDomain('esempio.it', { pageSize: 0 });
  await g.SN_PATHS.listByDomain('esempio.it', { pageSize: -5 });
  await g.SN_PATHS.listByDomain('esempio.it', { pageSize: 'tanti' });
  expect(limiti.every((l) => l >= 1 && l <= 200), `limiti usciti: ${limiti}`).toBe(true);
});

test('i percorsi già riusciti arrivano ancora nel prompt dell’assistente di pagina', async () => {
  const g = caricaPaths();
  g.__fetch = async () => rispostaQuery([
    {
      name: 'projects/p/databases/(default)/documents/paths/esempio.it/entries/uno',
      createTime: '2026-09-11T10:03:41.512873Z',
      fields: {
        initialUrl: { stringValue: '/ordini' },
        intent: { stringValue: 'vedere gli ordini fatti' },
        steps: { arrayValue: { values: [
          { mapValue: { fields: { selector: { stringValue: 'a#account' }, action: { stringValue: 'click' }, retracted: { booleanValue: false } } } },
          { mapValue: { fields: { selector: { stringValue: 'a[href="/orders"]' }, action: { stringValue: 'click' }, retracted: { booleanValue: false } } } },
        ] } },
        success: { booleanValue: true },
        createdAt: { timestampValue: '2026-09-11T10:00:00Z' },
      },
    },
    {
      name: 'projects/p/databases/(default)/documents/paths/esempio.it/entries/due',
      createTime: '2026-09-11T10:05:02.004411Z',
      fields: {
        initialUrl: { stringValue: '/carrello' },
        intent: { stringValue: 'svuotare il carrello' },
        steps: { arrayValue: { values: [] } },
        success: { booleanValue: false },
        createdAt: { timestampValue: '2026-09-11T10:00:00Z' },
      },
    },
  ]);

  const letti = await g.SN_PATHS.listByDomain('esempio.it', { pageSize: 50, onlySuccess: true });
  expect(letti).toHaveLength(1);

  const prompt = g.SN_PATHS.formatForPrompt(letti);
  expect(prompt).toContain('vedere gli ordini fatti');
  expect(prompt).toContain('a#account');
  expect(prompt).toContain('a[href="/orders"]');
  // i 👎 non vanno agli altri agenti
  expect(prompt).not.toContain('svuotare il carrello');
});

test('il documento spedito non porta nessun identificativo del mittente, e nemmeno può portarlo', async () => {
  const g = caricaPaths();
  let corpo = null;
  g.__fetch = async (_url, opts) => {
    corpo = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ name: 'a/b/c/xyz' }), text: async () => '' };
  };

  await g.SN_PATHS.submit({
    domain: 'esempio.it', initialUrl: '/ordini', intent: 'vedere gli ordini',
    steps: [{ selector: 'a#x', action: 'click', retracted: false }], success: true,
    // anche se un chiamante distratto provasse a rimetterli dentro:
    clientId: 'c-123', userAgent: 'Mozilla/5.0',
  });

  expect(Object.keys(corpo.fields).sort()).toEqual(
    ['createdAt', 'initialUrl', 'intent', 'steps', 'success'],
  );
  const testo = JSON.stringify(corpo);
  expect(testo).not.toContain('c-123');
  expect(testo).not.toContain('Mozilla');
  // l'ora scritta dal client è arrotondata all'ora piena
  expect(corpo.fields.createdAt.timestampValue).toMatch(/T\d\d:00:00\.000Z$/);
});

// ── IL RILIEVO DI QUESTO GIRO ───────────────────────────────────────────────
// `createdAt` è arrotondato all'ora perché due percorsi salvati su domini
// diversi a pochi secondi di distanza sono quasi certamente della stessa
// persona. Ma nella stessa risposta Firestore rimanda `createTime`, che il
// client non scrive e non può togliere, al microsecondo — e il lettore lo
// riceve (lo si vede: finisce in `_createTime`). La chiave di join è ancora
// lì. Oggi questo test FOTOGRAFA il difetto; quando la lettura passerà da una
// strada che non rimanda quella marca, va girato in una guardia che pretende
// il contrario.
test('RILIEVO: al lettore anonimo arriva comunque l’ora esatta al microsecondo, e ricuce i domini', async () => {
  const g = caricaPaths();
  const perDominio = {
    'banca-esempio.it': [
      { intent: 'controllare il saldo', createTime: '2026-09-11T10:03:41.512873Z' },
      { intent: 'pagare un bollettino', createTime: '2026-09-11T14:51:09.883210Z' },
    ],
    'clinica-esempio.it': [
      { intent: 'prenotare una visita', createTime: '2026-09-11T10:03:42.479015Z' },
    ],
  };
  g.__fetch = async (url) => {
    const dom = url.match(/documents\/paths\/([^:]+):runQuery/)[1];
    return rispostaQuery((perDominio[dom] || []).map((p, i) => ({
      name: `projects/p/databases/(default)/documents/paths/${dom}/entries/e${i}`,
      createTime: p.createTime,
      fields: {
        initialUrl: { stringValue: '/x' }, intent: { stringValue: p.intent },
        steps: { arrayValue: { values: [] } }, success: { booleanValue: true },
        // arrotondata all'ora, come la scrive il client
        createdAt: { timestampValue: '2026-09-11T10:00:00Z' },
      },
    })));
  };

  const banca = await g.SN_PATHS.listByDomain('banca-esempio.it');
  const clinica = await g.SN_PATHS.listByDomain('clinica-esempio.it');

  // l'ora dichiarata nel documento è, come promesso, arrotondata: da sola non
  // distinguerebbe nulla
  for (const p of [...banca, ...clinica]) {
    expect(p.createdAt).toBe('2026-09-11T10:00:00Z');
  }

  // ma l'altra marca arriva intera, e basta a ricucire
  for (const p of [...banca, ...clinica]) {
    expect(p._createTime, 'la marca di Firestore arriva al lettore').toMatch(/\.\d{6}Z$/);
  }
  const ms = (p) => new Date(p._createTime).getTime();
  const distanze = [];
  for (const b of banca) for (const c of clinica) distanze.push([b.intent, c.intent, Math.abs(ms(b) - ms(c))]);
  distanze.sort((a, b) => a[2] - b[2]);

  // meno di un secondo fra due domini diversi: stessa persona, stessa sessione
  expect(distanze[0][2]).toBeLessThan(1000);
  expect(distanze[0][0]).toBe('controllare il saldo');
  expect(distanze[0][1]).toBe('prenotare una visita');
  // e l'altro percorso, di ore dopo, si distingue: non è rumore, è un join
  expect(distanze[1][2]).toBeGreaterThan(60 * 60 * 1000);
});
