// Verifica #584, giro 2 — la coda che stacca l'orologio, e cosa resta dentro
// il documento che finisce nella raccolta pubblica.
//
// Il giro 1 aveva trovato che, tolto il codice del mittente, a ricucire i
// percorsi della stessa persona restava l'ora esatta che Firestore scrive da
// sé su ogni documento. La correzione non spedisce più il percorso quando lo
// fai: lo mette in coda e lo manda ore dopo, uno alla volta. Qui si prova a
// romperla, e si guarda cosa il documento continua a portarsi dietro.
//
// Non apre Filo di proposito: è logica pura (una coda e un client REST). Le
// REGOLE, provate col motore vero, stanno nei due file `*-motore-vero.mjs`
// accanto.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');

require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'paths.js'));
require(join(ROOT, 'src', 'main', 'services', 'pathsCollector.js'));

const { ACTIONS } = globalThis.SN_CONST;
const Collector = globalThis.SN_PATHS_COLLECTOR;
const { RITARDO_MIN_MS, RITARDO_MAX_MS } = Collector._internal;

function invokeAIFinto(intento) {
  return async ({ action }) => {
    if (action === ACTIONS.HELP_INTENT_GUESS) return { text: intento };
    if (action === ACTIONS.HELP_INTENT_JUDGE) return { text: '{"ok":true}' };
    return { text: '' };
  };
}

function montaRete() {
  const scritture = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    scritture.push({ url: String(url), body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => ({ name: 'a/b/c/xyz' }), text: async () => '{}' };
  };
  return { scritture, smonta: () => { globalThis.fetch = orig; } };
}

async function raccogli(url, intento, passi) {
  const r = await Collector.collectAndSave({
    session: {
      rawUrl: url,
      rawSteps: passi || [{ selector: '#x', action: 'click' }],
      rawUserMessages: [intento],
      success: true,
    },
    invokeAI: invokeAIFinto(intento),
  });
  return r;
}

test.beforeEach(() => { Collector._reset(); Collector._setAuto(false); });
test.afterEach(() => { Collector._reset(); });

// ─────────────────────────────────────────────────────────────────────────────
// La coda regge? (il rilievo del giro 1)

test('su cento sessioni vere, i due percorsi della stessa sessione non escono mai vicini', async () => {
  const rete = montaRete();
  try {
    const distanze = [];
    for (let i = 0; i < 100; i += 1) {
      Collector._reset();
      Collector._setAuto(false);
      await raccogli(`https://banca${i}.it/conto`, 'controllare il saldo');
      await raccogli(`https://clinica${i}.it/prenota`, 'prenotare una visita');
      const [a, b] = Collector._peek();
      distanze.push(Math.abs(a.nonPrimaDi - b.nonPrimaDi));
    }
    const vicini = distanze.filter((d) => d < 5 * 60 * 1000).length;
    const ordinate = [...distanze].sort((x, y) => x - y);
    const mediana = ordinate[Math.floor(ordinate.length / 2)];

    // il sorteggio è quello vero: qui si chiede che la finestra sia davvero
    // larga, non che ogni singola coppia caschi bene
    expect(vicini, 'due percorsi della stessa sessione a meno di cinque minuti').toBeLessThan(10);
    expect(mediana, 'la distanza tipica fra due percorsi della stessa sessione').toBeGreaterThan(2 * 60 * 60 * 1000);
    expect(Math.max(...distanze)).toBeLessThanOrEqual(RITARDO_MAX_MS - RITARDO_MIN_MS);
  } finally { rete.smonta(); }
});

test('dieci percorsi maturi insieme escono uno per giro, non in un lampo', async () => {
  const rete = montaRete();
  try {
    for (let i = 0; i < 10; i += 1) await raccogli(`https://sito${i}.it/x`, 'una cosa');
    expect(Collector.inCoda()).toBe(10);
    const dopoUnMese = Date.now() + 29 * 24 * 60 * 60 * 1000;
    for (let giro = 1; giro <= 10; giro += 1) {
      await Collector.flush({ now: dopoUnMese });
      expect(rete.scritture.length, `al giro ${giro}`).toBe(giro);
    }
    expect(Collector.inCoda()).toBe(0);
  } finally { rete.smonta(); }
});

test('niente parte nell’istante della sessione, nemmeno con dieci sessioni di fila', async () => {
  const rete = montaRete();
  try {
    for (let i = 0; i < 10; i += 1) await raccogli(`https://sito${i}.it/x`, 'una cosa');
    expect(rete.scritture.length, 'una sola scrittura immediata rimetterebbe l’orologio al suo posto').toBe(0);
  } finally { rete.smonta(); }
});

test('un percorso maturo esce col giorno del giorno in cui ESCE, senza ora', async () => {
  const rete = montaRete();
  try {
    await raccogli('https://esempio.it/x', 'una cosa');
    await Collector.flush({ now: Date.parse('2026-09-12T13:47:03.221Z') + RITARDO_MAX_MS });
    expect(rete.scritture.length).toBe(1);
    const t = rete.scritture[0].body.fields.createdAt.timestampValue;
    expect(t).toMatch(/T00:00:00\.000Z$/);
  } finally { rete.smonta(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Cosa resta dentro il documento

// Era il rilievo di livello tre di questo giro: la pagina di partenza usciva
// intera, nome utente e numero di conto compresi, mentre la stessa email e lo
// stesso numero dentro l'elemento cliccato venivano sostituiti. Corretto nello
// stesso giro; adesso questo test è la guardia.
test('la pagina di partenza esce ripulita come i nomi degli elementi, non intera', async () => {
  const rete = montaRete();
  try {
    // stessa informazione in due posti: dentro il selettore e dentro l'URL
    await raccogli(
      'https://forum-esempio.it/u/mario.rossi/ordini/847362',
      'ritrovare un ordine',
      [{ selector: '[aria-label="Ordini di mario.rossi@posta.it 847362"]', action: 'click' }],
    );
    await Collector.flush({ now: Date.now() + RITARDO_MAX_MS + 1000 });
    expect(rete.scritture.length).toBe(1);
    const campi = rete.scritture[0].body.fields;

    const selettore = campi.steps.arrayValue.values[0].mapValue.fields.selector.stringValue;
    expect(selettore).toContain('[EMAIL]');
    expect(selettore).toContain('[NUMERO]');
    expect(selettore).not.toContain('847362');

    expect(campi.initialUrl.stringValue).toBe('/u/[ID]/ordini/[ID]');
    const grezzo = JSON.stringify(rete.scritture[0].body);
    expect(grezzo).not.toContain('mario.rossi');
    expect(grezzo).not.toContain('847362');
  } finally { rete.smonta(); }
});

test('RILIEVO: nei selettori la redazione conosce solo email e numeri lunghi, un nome passa', async () => {
  const rete = montaRete();
  try {
    await raccogli(
      'https://esempio.it/area',
      'aprire il profilo',
      [{ selector: '[aria-label="Profilo di Mario Rossi"]', action: 'click' },
        { selector: 'button[title="Esci, Mario"]', action: 'click' }],
    );
    await Collector.flush({ now: Date.now() + RITARDO_MAX_MS + 1000 });
    const passi = rete.scritture[0].body.fields.steps.arrayValue.values
      .map((v) => v.mapValue.fields.selector.stringValue);
    expect(passi[0]).toContain('Mario Rossi');
    expect(passi[1]).toContain('Mario');
  } finally { rete.smonta(); }
});

test('il documento che parte non porta nessun identificativo del mittente', async () => {
  const rete = montaRete();
  try {
    await raccogli('https://esempio.it/x', 'una cosa');
    await Collector.flush({ now: Date.now() + RITARDO_MAX_MS + 1000 });
    const campi = rete.scritture[0].body.fields;
    expect(Object.keys(campi).sort()).toEqual(['createdAt', 'initialUrl', 'intent', 'steps', 'success']);
  } finally { rete.smonta(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// La funzione chiesta dal feedback continua a funzionare

test('l’assistente di pagina ritrova i percorsi riusciti di un sito, e li chiede filtrati al server', async () => {
  const orig = globalThis.fetch;
  const richieste = [];
  globalThis.fetch = async (url, opts) => {
    richieste.push({ url: String(url), body: JSON.parse(opts.body) });
    return {
      ok: true,
      json: async () => [{
        document: {
          name: 'projects/p/databases/(default)/documents/paths/esempio.it/entries/e1',
          createTime: '2026-09-12T04:11:02.998877Z',
          fields: {
            initialUrl: { stringValue: '/ordini' },
            intent: { stringValue: 'vedere gli ordini' },
            steps: { arrayValue: { values: [{ mapValue: { fields: {
              selector: { stringValue: 'a#ordini' }, action: { stringValue: 'click' },
            } } }] } },
            success: { booleanValue: true },
            createdAt: { timestampValue: '2026-09-12T00:00:00.000Z' },
          },
        },
      }],
      text: async () => '',
    };
  };
  try {
    const percorsi = await globalThis.SN_PATHS.listByDomain('esempio.it', { pageSize: 50 });
    expect(percorsi.length).toBe(1);
    const q = richieste[0].body.structuredQuery;
    expect(richieste[0].url).toContain('/paths/esempio.it:runQuery');
    expect(q.where.fieldFilter.field.fieldPath).toBe('success');
    expect(q.limit).toBe(50);
    const prompt = globalThis.SN_PATHS.formatForPrompt(percorsi);
    expect(prompt).toContain('vedere gli ordini');
    expect(prompt).toContain('a#ordini');
  } finally { globalThis.fetch = orig; }
});
