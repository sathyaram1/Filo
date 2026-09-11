// Verifica #581, giro 2 — Filo vero, appena installato e senza login.
//
// Due domande che al giro 1 erano rimaste a metà.
//
// 1) La chiave del rilevamento siti pericolosi prima viveva SOLO nel documento
//    remoto, quindi si accendeva solo per chi aveva fatto login. Chiudendo quel
//    documento, la chiave viaggia dentro il pacchetto e vale per tutti. Il giro
//    1 aveva verificato che la chiave ARRIVA nelle impostazioni effettive; qui
//    si guarda il pezzo dopo, cioè che il rilevatore sia davvero ACCESO — che è
//    quello che la riga delle novità promette all'utente.
//
// 2) Da adesso quella chiave sta su OGNI installazione, anche su quelle che
//    prima non l'avevano mai vista. Vale quindi la pena contare l'altra strada
//    per cui una chiave condivisa finisce in mano a qualcuno: non più il
//    documento remoto, ma una PAGINA. Un sito aperto in una scheda chiede le
//    impostazioni a Filo: da quella risposta non deve uscire nessuna delle
//    chiavi condivise.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..', '..', '..');

const PACCHETTO = {
  tavily: 'tav-pacchetto-581-g2b',
  safeBrowsing: 'gsb-pacchetto-581-g2b',
};

function avvia(chiavi) {
  const userData = cartellaTemporanea('filo-verifica-581-g2-');
  const env = {
    ...process.env,
    FILO_USER_DATA: userData,
    FILO_DOWNLOAD_DIR: join(userData, 'downloads'),
    NODE_ENV: 'test',
  };
  // Un'installazione appena fatta non ha né profilo né chiavi scritte a mano:
  // tutto quello che ha è ciò che la costruzione le ha messo dentro.
  delete env.FILO_DEFAULT_OPENROUTER_KEY;
  delete env.FILO_DEFAULT_TAVILY_KEY;
  delete env.FILO_DEFAULT_SAFEBROWSING_KEY;
  Object.assign(env, chiavi);
  return {
    userData,
    lancio: electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env }),
  };
}

test.describe('con le chiavi del pacchetto', () => {
  let app; let userData;

  test.beforeAll(async () => {
    const a = avvia({
      FILO_DEFAULT_TAVILY_KEY: PACCHETTO.tavily,
      FILO_DEFAULT_SAFEBROWSING_KEY: PACCHETTO.safeBrowsing,
    });
    userData = a.userData;
    app = await a.lancio;
    await app.firstWindow();
  });

  test.afterAll(async () => {
    try { await app.close(); } catch (_) {}
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  });

  test('senza login il rilevamento siti pericolosi è acceso davvero', async () => {
    const stato = await app.evaluate(async () => {
      // Lo stesso cammino del boot: le impostazioni effettive entrano nel
      // rilevatore. Se la chiave non arrivasse, il primo stadio resterebbe
      // spento e nessuno se ne accorgerebbe.
      await globalThis.__filoHandlers.wireSafebrowse();
      return globalThis.SN_SAFEBROWSE.activeProviders();
    });
    expect(stato.gsb, 'il primo stadio (Google Safe Browsing) deve essere attivo su un\'installazione senza login').toBe(true);
  });

  test('un sito aperto in una scheda non riceve nessuna chiave condivisa', async () => {
    const risposta = await app.evaluate(async () => {
      const MSG = globalThis.SN_MSG.MSG;
      return globalThis.SN_HANDLE_MESSAGE(
        { type: MSG.GET_SETTINGS },
        { url: 'https://sito-qualunque.example/pagina' }
      );
    });
    const testo = JSON.stringify(risposta);
    expect(testo).not.toContain(PACCHETTO.tavily);
    expect(testo).not.toContain(PACCHETTO.safeBrowsing);
    expect(risposta.settings.apiKeys).toBeFalsy();
  });

  test('nemmeno una pagina interna si porta via la chiave del rilevamento', async () => {
    // Le pagine interne ricevono le chiavi dei modelli (le Opzioni le mostrano),
    // ma quella del rilevamento siti pericolosi non ha un campo per-utente e non
    // ha motivo di uscire dal processo principale.
    const risposta = await app.evaluate(async () => {
      const MSG = globalThis.SN_MSG.MSG;
      return globalThis.SN_HANDLE_MESSAGE(
        { type: MSG.GET_SETTINGS },
        { url: 'filo://options/options.html' }
      );
    });
    expect(JSON.stringify(risposta)).not.toContain(PACCHETTO.safeBrowsing);
  });
});

test.describe('senza nessuna chiave incastonata', () => {
  let app; let userData;

  test.beforeAll(async () => {
    const a = avvia({});
    userData = a.userData;
    app = await a.lancio;
    await app.firstWindow();
  });

  test.afterAll(async () => {
    try { await app.close(); } catch (_) {}
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  });

  test('Filo parte lo stesso, gli stadi che non costano chiavi restano accesi, e il documento chiuso non si chiede', async () => {
    const r = await app.evaluate(async () => {
      const vera = global.fetch;
      const chiesti = [];
      global.fetch = async (u) => {
        chiesti.push(String(u));
        return { ok: false, status: 403, async json() { return {}; }, async text() { return ''; } };
      };
      try { await globalThis.__filoDefaults.refresh(); } finally { global.fetch = vera; }
      await globalThis.__filoHandlers.wireSafebrowse();
      const eff = await globalThis.__filoHandlers.getEffectiveSettings();
      return {
        chiesti,
        stadi: globalThis.SN_SAFEBROWSE.activeProviders(),
        chiaveGsb: (eff.security && eff.security.safeBrowse && eff.security.safeBrowse.safeBrowsingKey) || '',
      };
    });

    expect(r.chiesti.some((u) => u.includes('config/secrets'))).toBe(false);
    expect(r.chiaveGsb).toBe('');
    // Senza chiave il primo stadio si spegne, ma il resto del rilevamento no:
    // l'analisi locale, la sandbox e i segnali di rete restano.
    expect(r.stadi.gsb).toBe(false);
    expect(r.stadi.sandbox).toBe(true);
  });
});
