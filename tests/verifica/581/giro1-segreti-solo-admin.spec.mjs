// Verifica #581, giro 1 — le chiavi condivise non si scaricano più con un
// account qualunque, e Filo appena installato funziona lo stesso.
//
// Il sintomo. Le chiavi che pagano le chiamate di tutti stavano in un documento
// che si leggeva con la sola condizione «account Google con email verificata».
// Iscriversi costa zero e la chiave web del progetto sta in un repo pubblico:
// chiunque, senza nemmeno installare Filo, se le portava via.
//
// COSA PROVA QUESTO FILE, e cosa no. Qui si prova il lato APP: un'installazione
// normale non chiede quel documento e funziona comunque. Il lato REGOLE — cioè
// la barriera vera, quella che risponde «permesso negato» a chi prova lo stesso
// da fuori Filo — non si può provare da dentro Electron: serve il motore delle
// regole Firestore. Al giro 1 è stato provato con l'emulatore ufficiale e le
// regole di questo ramo, verificando che un account Google verificato qualunque
// e un account anonimo ricevono «permesso negato», che l'amministratore legge
// ancora (le chiavi si possono ancora ruotare) e che con la regola di prima lo
// stesso account leggeva il documento per intero. Quella prova non entra qui
// perché ha bisogno dell'emulatore e di Java, che nella suite non ci sono: la
// sentinella che resta accesa sulle regole è negli unit test.
//
// Un limite dichiarato: il controllo lato app «sei un amministratore» si può
// esercitare solo con una sessione vera, e questo contenitore non ha un
// portachiavi di sistema, quindi una sessione non si può seminare. Le prove qui
// sotto coprono l'installazione slegata; per il caso «loggato ma non
// amministratore» la garanzia verificata è quella delle regole.

import { test, expect, _electron as electron } from '@playwright/test';
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..', '..', '..');

// Le chiavi che in produzione la costruzione incastona nell'eseguibile. Qui
// passano per l'ambiente, che è il ripiego dichiarato: stessa strada, stesso
// codice, senza dover impacchettare.
const FABBRICA = {
  openrouter: 'or-fabbrica-581-giro1',
  tavily: 'tav-fabbrica-581-giro1',
  safeBrowsing: 'gsb-fabbrica-581-giro1',
};

let app;
let userData;

test.beforeAll(async () => {
  userData = cartellaTemporanea('filo-verifica-581-g1-');
  app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: {
      ...process.env,
      FILO_USER_DATA: userData,
      FILO_DOWNLOAD_DIR: join(userData, 'downloads'),
      NODE_ENV: 'test',
      FILO_DEFAULT_OPENROUTER_KEY: FABBRICA.openrouter,
      FILO_DEFAULT_TAVILY_KEY: FABBRICA.tavily,
      FILO_DEFAULT_SAFEBROWSING_KEY: FABBRICA.safeBrowsing,
    },
  });
  await app.firstWindow();
});

test.afterAll(async () => {
  try { await app.close(); } catch (_) {}
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});

test('installazione appena fatta: le chiavi con cui parte una richiesta ci sono', async () => {
  // Se qui comparisse una stringa vuota, in chat il tester vedrebbe «configura
  // una chiave» — cioè proprio quello che chiudere la porta non doveva causare.
  const eff = await app.evaluate(async () => {
    const s = await globalThis.__filoHandlers.getEffectiveSettings();
    return {
      openrouter: (s.apiKeys && s.apiKeys.openrouter) || '',
      tavily: (s.apiKeys && s.apiKeys.tavily) || '',
      // La chiave del rilevamento siti pericolosi arriva dentro le impostazioni
      // di sicurezza, non accanto alle chiavi dei modelli: è lì che la cerca chi
      // fa il controllo.
      safeBrowsing: (s.security && s.security.safeBrowse && s.security.safeBrowse.safeBrowsingKey) || '',
    };
  });
  expect(eff.openrouter).toBe(FABBRICA.openrouter);
  expect(eff.tavily).toBe(FABBRICA.tavily);
  // La chiave del rilevamento siti pericolosi viveva SOLO nel documento remoto:
  // se non viaggiasse con la costruzione, chiudere la porta avrebbe spento in
  // silenzio il primo stadio per tutti.
  expect(eff.safeBrowsing).toBe(FABBRICA.safeBrowsing);
});

test('un rifiuto del server su ogni documento non lascia Filo senza chiavi', async () => {
  // Il caso in cui la barriera dice no a tutti (allowlist cambiata, documento
  // cancellato, rete ostile che risponde 403): le chiavi della costruzione sono
  // il pavimento sotto ogni caso, e nessun percorso deve azzerarle.
  const r = await app.evaluate(async () => {
    const Defaults = globalThis.__filoDefaults;
    const vera = global.fetch;
    const viste = [];
    global.fetch = async (u) => {
      viste.push(String(u));
      return {
        ok: false, status: 403,
        async json() { return { error: { status: 'PERMISSION_DENIED' } }; },
        async text() { return 'PERMISSION_DENIED'; },
      };
    };
    try { await Defaults.refresh(); } finally { global.fetch = vera; }
    const eff = await globalThis.__filoHandlers.getEffectiveSettings();
    return {
      viste,
      openrouter: (eff.apiKeys && eff.apiKeys.openrouter) || '',
      tavily: (eff.apiKeys && eff.apiKeys.tavily) || '',
      safeBrowsing: (eff.security && eff.security.safeBrowse && eff.security.safeBrowse.safeBrowsingKey) || '',
    };
  });

  expect(r.viste.some((u) => u.includes('config/secrets'))).toBe(false);
  expect(r.openrouter).toBe(FABBRICA.openrouter);
  expect(r.tavily).toBe(FABBRICA.tavily);
  expect(r.safeBrowsing).toBe(FABBRICA.safeBrowsing);
});

test('un aggiornamento ripetuto in fretta non apre il documento dei segreti', async () => {
  // Azioni rapide in sequenza: dieci aggiornamenti lanciati insieme. Una corsa
  // fra due giri non deve far sfuggire una richiesta al documento chiuso, né
  // lasciare le chiavi a metà.
  const r = await app.evaluate(async () => {
    const Defaults = globalThis.__filoDefaults;
    const vera = global.fetch;
    const viste = [];
    global.fetch = async (u) => {
      viste.push(String(u));
      return { ok: false, status: 404, async json() { return {}; }, async text() { return ''; } };
    };
    try {
      await Promise.all(Array.from({ length: 10 }, () => Defaults.refresh()));
    } finally { global.fetch = vera; }
    const eff = await globalThis.__filoHandlers.getEffectiveSettings();
    return { viste, openrouter: (eff.apiKeys && eff.apiKeys.openrouter) || '' };
  });

  expect(r.viste.some((u) => u.includes('config/secrets'))).toBe(false);
  expect(r.openrouter).toBe(FABBRICA.openrouter);
});

// ── Le regole, lette in proprio ──────────────────────────────────────────────
// Una lettura indipendente del file delle regole: se la sentinella degli unit
// test un giorno leggesse male il file, questa resterebbe a dirlo. Ritaglia il
// blocco di un documento contando le parentesi, invece di fidarsi di una riga.
function bloccoRegola(testo, percorso) {
  const apri = testo.indexOf(`match /${percorso} {`);
  if (apri < 0) return null;
  let i = testo.indexOf('{', apri);
  let livello = 0;
  for (let j = i; j < testo.length; j++) {
    if (testo[j] === '{') livello++;
    else if (testo[j] === '}') {
      livello--;
      if (livello === 0) return testo.slice(i + 1, j);
    }
  }
  return null;
}

function condizioneDiLettura(blocco) {
  const righe = blocco.split('\n')
    .map((r) => r.replace(/\/\/.*$/, '').trim())
    .filter((r) => /^allow\b/.test(r) && /\bread\b/.test(r));
  return righe.map((r) => (r.match(/:\s*if\s+(.*?);\s*$/) || [, ''])[1].trim());
}

test('le regole: il documento delle chiavi si legge solo da amministratore, come il suo gemello', async () => {
  const regole = readFileSync(resolve(APP_ROOT, 'firestore.rules'), 'utf8');

  const segreti = bloccoRegola(regole, 'config/secrets');
  const giudici = bloccoRegola(regole, 'config/judgeSecrets');
  expect(segreti, 'il blocco config/secrets deve esistere').toBeTruthy();
  expect(giudici, 'il blocco config/judgeSecrets deve esistere').toBeTruthy();

  // L'asimmetria fra due documenti che contengono la stessa cosa era la spia:
  // ora le due condizioni di lettura devono coincidere.
  expect(condizioneDiLettura(segreti)).toEqual(['isAdmin()']);
  expect(condizioneDiLettura(giudici)).toEqual(['isAdmin()']);

  // E la condizione di prima non deve poter tornare, nemmeno riscritta a mano.
  expect(/request\.auth\s*!=\s*null/.test(segreti)).toBe(false);
  expect(/email_verified/.test(segreti)).toBe(false);
});

test('le regole: nessun documento di configurazione si apre sulla sola condizione «sei entrato»', async () => {
  // Da quando l'identità dell'installazione è un account anonimo, «autenticato»
  // lo è chiunque abbia la chiave web pubblica: non serve nemmeno un account
  // Google. Una regola che chiede solo quello non è una barriera.
  const regole = readFileSync(resolve(APP_ROOT, 'firestore.rules'), 'utf8');
  const nomi = [...regole.matchAll(/match \/(config\/[A-Za-z0-9_]+) \{/g)].map((m) => m[1]);
  expect(nomi.length).toBeGreaterThan(3);

  const colpevoli = [];
  for (const nome of nomi) {
    for (const cond of condizioneDiLettura(bloccoRegola(regole, nome) || '')) {
      const soloEntrato = /request\.auth\s*!=\s*null/.test(cond)
        && !/isAdmin\(\)/.test(cond)
        && !/request\.auth\.uid\s*==/.test(cond);
      if (soloEntrato) colpevoli.push(`${nome}: ${cond}`);
    }
  }
  expect(colpevoli, 'documenti di configurazione leggibili da chiunque sia entrato').toEqual([]);
});
