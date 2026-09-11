// Verifica #584, giro 3 — il nome scritto a lettere.
//
// La pulizia per forme (email, chiocciole, codici, numeri lunghi) e la regola
// dei segmenti tolgono dall'indirizzo di partenza tutto ciò che «ha la forma»
// di un identificativo, e mettono un segnaposto dopo un marcatore di persona
// (/u/, /user/, /profilo/). Qui si guarda cosa resta quando il nome utente è
// semplicemente il PRIMO segmento dell'indirizzo — la forma di quasi tutti i
// siti dove un profilo ha un indirizzo — o quando è scritto dentro l'etichetta
// di un pulsante.
//
// Non apre Filo: è la stessa logica pura del giro 2, guardata sul documento che
// parte davvero verso la raccolta pubblica.

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
const { RITARDO_MAX_MS } = Collector._internal;

function montaRete() {
  const scritture = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    scritture.push({ url: String(url), body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => ({ name: 'a/b/c/xyz' }), text: async () => '{}' };
  };
  return { scritture, smonta: () => { globalThis.fetch = orig; } };
}

async function raccogliESpedisci(url, passi) {
  const rete = montaRete();
  try {
    await Collector.collectAndSave({
      session: {
        rawUrl: url,
        rawSteps: passi || [{ selector: '#x', action: 'click' }],
        rawUserMessages: ['aprimi la pagina'],
        success: true,
      },
      invokeAI: async ({ action }) => {
        if (action === ACTIONS.HELP_INTENT_GUESS) return { text: 'aprire una pagina' };
        return { text: '{"ok":true}' };
      },
    });
    await Collector.flush({ now: Date.now() + RITARDO_MAX_MS + 1000 });
    return rete.scritture[0] ? rete.scritture[0].body.fields : null;
  } finally { rete.smonta(); }
}

test.beforeEach(() => { Collector._reset(); Collector._setAuto(false); });
test.afterEach(() => { Collector._reset(); });

// Le quattro forme più comuni di indirizzo con dentro un nome utente. In
// nessuna il nome è preceduto da un marcatore di persona, e in nessuna ha la
// forma di un codice: è una parola.
const CASI = [
  ['https://github.com/mariorossi/progetto', 'mariorossi'],
  ['https://x.com/mariorossi', 'mariorossi'],
  ['https://www.linkedin.com/in/mario-rossi', 'mario-rossi'],
  ['https://sito.it/clienti/MarioRossi/fatture', 'MarioRossi'],
];

for (const [url, nome] of CASI) {
  test(`l’indirizzo pubblicato non porta il nome utente: ${url}`, async () => {
    const campi = await raccogliESpedisci(url);
    expect(campi).not.toBeNull();
    expect(campi.initialUrl.stringValue.toLowerCase()).not.toContain(nome.toLowerCase());
  });
}

test('il nome di una persona dentro l’etichetta di un pulsante non arriva nella raccolta pubblica', async () => {
  const campi = await raccogliESpedisci('https://sito.it/area', [
    { selector: '[aria-label="Profilo di Mario Rossi"]', action: 'click' },
  ]);
  expect(campi).not.toBeNull();
  expect(JSON.stringify(campi.steps)).not.toContain('Mario Rossi');
});
