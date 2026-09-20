// Verifica #551 — giro 1. «Il terminale storpia i nomi dei file con trattini
// lunghi e accenti, e Filo poi non li ritrova.»
//
// Il sintomo, con le parole di chi l'ha visto: l'utente chiede a Filo di
// leggere un file; Filo elenca la cartella col terminale e legge
// «SPECIFICHE SEO E METADATI - singolarita.txt» e «… Singolarit<sostituzione>.txt»;
// chiede di leggere il primo e si sente rispondere che a quel percorso non c'è
// nessun file. Il file c'è: ha il trattino LUNGO nel nome.
//
// Qui si prova la SECONDA cura chiesta dal feedback — il lettore di documenti
// tollera le sviste sul nome — e la si prova dal punto di vista dell'utente:
// il TESTO che stava cercando arriva, e insieme arriva il nome VERO del file,
// altrimenti il giro dopo si ricomincia da capo col nome che non esiste.
//
// Tutte le prove passano dal canale vero della chat (FILO_RUN_ACTION), non dal
// modulo: un'azione che il dispatch rifiuta non la vedresti mai da un unit.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const HOME = 'filo://dashboard/dashboard.html';

// I due file dell'episodio vero, con i segni che la tabella OEM non sa scrivere.
const VERO_A = 'SPECIFICHE SEO E METADATI — singolarita.txt';
const VERO_B = 'SPECIFICHE TIPOGRAFICHE — Singolarità.txt';
// Come li ha letti il modello dopo il passaggio dal terminale di Windows.
const STORPIATO_A = 'SPECIFICHE SEO E METADATI - singolarita.txt';
const STORPIATO_B = 'SPECIFICHE TIPOGRAFICHE - Singolarit�.txt';

const leggiDocumento = (page, percorso) =>
  page.evaluate((p) => new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.FILO_RUN_ACTION,
      action: { type: 'LEGGI_DOCUMENTO', percorso: p },
    }, (r) => resolve(r));
  }), percorso);

// Prepara la cartella dell'episodio. Il nome della CARTELLA ha a sua volta un
// accento: la storpiatura del terminale non si ferma all'ultimo pezzo.
function cartellaEpisodio() {
  const base = cartellaTemporanea('filo-551-');
  const dir = join(base, 'Documenti Società');
  mkdirSync(dir);
  writeFileSync(join(dir, VERO_A), 'meta description: 155 caratteri\n', 'utf8');
  writeFileSync(join(dir, VERO_B), 'corpo del testo: 16 punti\n', 'utf8');
  return { base, dir };
}

test('il file col trattino lungo si apre chiedendolo col trattino corto', async ({ openTab }) => {
  const { base, dir } = cartellaEpisodio();
  try {
    const page = await openTab(HOME);
    const r = await leggiDocumento(page, join(dir, STORPIATO_A));

    // Quello che l'utente voleva: il contenuto del suo file.
    expect(r?.executed, 'il file esiste: non ci si deve arrendere al nome storpiato').toBe(true);
    expect(r.output.text).toContain('155 caratteri');
    // E Filo deve sapere QUALE file ha in mano, altrimenti al giro dopo
    // ricomincia a usare un nome che non esiste.
    expect(r.output.name).toBe(VERO_A);
    expect(r.output.requested).toBe(join(dir, STORPIATO_A));
    // Non deve aver preso l'altro file della cartella.
    expect(r.output.text).not.toContain('16 punti');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('il file con la «à» persa si apre, e non viene scambiato col vicino', async ({ openTab }) => {
  const { base, dir } = cartellaEpisodio();
  try {
    const page = await openTab(HOME);
    const r = await leggiDocumento(page, join(dir, STORPIATO_B));

    expect(r?.executed).toBe(true);
    expect(r.output.text).toContain('16 punti');
    expect(r.output.name).toBe(VERO_B);
    expect(r.output.text).not.toContain('155 caratteri');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('anche il nome della CARTELLA può essere storpiato', async ({ openTab }) => {
  // La tabella OEM colpisce ogni pezzo del percorso, non solo l'ultimo: se la
  // tolleranza si fermasse al nome del file, metà dei casi resterebbe fuori.
  const { base, dir } = cartellaEpisodio();
  try {
    const page = await openTab(HOME);
    const r = await leggiDocumento(page, join(base, 'Documenti Societ�', STORPIATO_A));

    expect(r?.executed, 'la cartella storpiata deve essere ritrovata come il file').toBe(true);
    expect(r.output.text).toContain('155 caratteri');
    expect(r.output.name).toBe(VERO_A);
    void dir;
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('quando i candidati sono due Filo non tira a indovinare: li dice', async ({ openTab }) => {
  // Indovinare qui vuol dire aprire il file sbagliato dell'utente e rispondere
  // sui numeri di un altro documento: peggio di un rifiuto. Il rifiuto però
  // deve DIRE quali sono, altrimenti l'utente non ha modo di scegliere.
  const base = cartellaTemporanea('filo-551-amb-');
  try {
    writeFileSync(join(base, 'Relazione 2024–2025.txt'), 'primo\n', 'utf8');
    writeFileSync(join(base, 'Relazione 2024-2025.txt'), 'secondo\n', 'utf8');
    const page = await openTab(HOME);
    const r = await leggiDocumento(page, join(base, 'Relazione 2024—2025.txt'));

    expect(r.output.ok).toBe(false);
    expect(r.output.text).toBe('');
    expect(r.output.detail).toContain('Relazione 2024-2025.txt');
    expect(r.output.detail).toContain('Relazione 2024–2025.txt');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('un nome fatto quasi solo di caratteri persi non apre niente', async ({ openTab }) => {
  // Il carattere di sostituzione vale come jolly: se valesse anche quando sotto
  // non è rimasto un nome, in una cartella con un file solo Filo lo aprirebbe
  // sempre — e direbbe di aver letto il documento chiesto.
  const base = cartellaTemporanea('filo-551-jolly-');
  try {
    writeFileSync(join(base, 'Estratto conto dicembre.txt'), 'saldo: 1.234,56\n', 'utf8');
    const page = await openTab(HOME);
    for (const nome of ['��.txt', 'Es�', '�']) {
      const r = await leggiDocumento(page, join(base, nome));
      expect(r.output.ok, `«${nome}» non è un nome: non deve aprire niente`).toBe(false);
      expect(r.output.text).toBe('');
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('il nome VERO arriva fino al prompt: Filo lo sa e lo può dire all’utente', async ({ app, openTab }) => {
  // È la parte che il feedback chiede per esteso («nel risultato dice quale
  // file ha aperto davvero»). Se l'informazione si ferma dentro il modulo, il
  // modello continua a maneggiare il nome storpiato: il turno dopo lo riscrive
  // in un comando e si ritorna al punto di partenza.
  const { base, dir } = cartellaEpisodio();
  try {
    const page = await openTab(HOME);
    await app.evaluate(async () => {
      const C = globalThis.SN_CONST;
      await globalThis.SN_STORAGE.updateSettings({
        useDefaultModels: false,
        apiKeys: { openrouter: 'k-test' },
        models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
        modelRegistry: globalThis.SN_TEST_MODELS.registry,
      });
    });

    // L'esito VERO dell'azione, non uno inventato: è il giro completo.
    const r = await leggiDocumento(page, join(dir, STORPIATO_A));
    expect(r?.executed).toBe(true);

    const prompt = await app.evaluate(async (_electron, { out, percorso }) => {
      const cap = {};
      const orig = globalThis.SN_PROVIDERS.completeWithFallback;
      globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
        cap.messages = messages;
        return {
          text: JSON.stringify({ text: 'ok', actions: [] }),
          model: attempts[0].model, provider: attempts[0].provider, usage: {},
        };
      };
      try {
        await globalThis.SN_HANDLE_FILO_CHAT({
          userMessage: 'allora?',
          threadHistory: [
            { role: 'user', text: 'leggimi le specifiche SEO' },
            {
              role: 'filo', text: 'Leggo il documento.',
              actions: [{ type: 'LEGGI_DOCUMENTO', percorso, _output: out }],
            },
          ],
        });
      } finally {
        globalThis.SN_PROVIDERS.completeWithFallback = orig;
      }
      return (cap.messages || [])
        .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join('\n');
    }, { out: r.output, percorso: join(dir, STORPIATO_A) });

    // Il testo del documento è arrivato…
    expect(prompt).toContain('155 caratteri');
    // …e insieme il nome vero, quello che il modello deve usare da qui in poi.
    expect(prompt).toContain(VERO_A);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
