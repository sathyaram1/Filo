// La chat della home con un modello finto a copione che ragiona, chiama strumenti e ascolta lo stop, più una ricerca
// sul web trattenuta: le prove del filo dell'attesa (#578) e dei secondi gesti (#1296). Nessuna rete.
import { expect } from '../fixtures/electron.mjs';

export async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

export async function configureModel(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

// Ogni passo: { pensa: [pezzi], ogni: ms, strumenti: [{id,name,arguments}], dopoStrumenti: ms, finoAlFermo, testo, sordo,
// prima: ms }. Rispetta lo stop (signal) salvo `sordo`; registra i messaggi ricevuti e gli stop. `finoAlFermo`: la
// chiamata degli strumenti resta a metà finché lo stop non la interrompe. `prima`: attesa prima di qualunque cosa.
export async function copione(app, passi) {
  await app.evaluate(async (_, passiJson) => {
    const passi = JSON.parse(passiJson);
    const P = globalThis.SN_PROVIDERS;
    if (!globalThis.__origStream) globalThis.__origStream = P.streamCompleteWithFallback;
    globalThis.__messaggi = [];
    globalThis.__interrotte = 0;
    let n = 0;
    P.streamCompleteWithFallback = async ({ attempts, messages, signal, onReasoning, onDelta, onToolCall }) => {
      globalThis.__messaggi.push(JSON.parse(JSON.stringify(messages)));
      const p = passi[Math.min(n, passi.length - 1)];
      n += 1;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const aspetta = (ms) => new Promise((ok, ko) => {
        const t = setTimeout(ok, ms);
        if (signal && !p.sordo) {
          if (signal.aborted) { clearTimeout(t); globalThis.__interrotte += 1; const e = new Error('aborted'); e.name = 'AbortError'; ko(e); return; }
          signal.addEventListener('abort', () => { clearTimeout(t); globalThis.__interrotte += 1; const e = new Error('aborted'); e.name = 'AbortError'; ko(e); }, { once: true });
        }
      });
      if (p.prima) await aspetta(p.prima);
      for (const pezzo of p.pensa || []) {
        try { onReasoning && onReasoning(pezzo); } catch (_) {}
        await aspetta(p.ogni || 120);
      }
      if (p.strumenti && p.strumenti.length) {
        for (const s of p.strumenti) { try { onToolCall && onToolCall({ id: s.id, name: s.name }); } catch (_) {} }
        await aspetta(p.finoAlFermo ? 2 ** 31 - 1 : (p.dopoStrumenti || 200));
        // Un comando secco chiude il turno (#1130): la frase va scritta insieme.
        if (p.testo) { try { onDelta && onDelta(p.testo); } catch (_) {} }
        return { ...base, text: p.testo || '', toolCalls: p.strumenti, finishReason: 'tool_calls' };
      }
      const testo = p.testo || 'Fatto.';
      try { onDelta && onDelta(testo); } catch (_) {}
      return { ...base, text: testo, toolCalls: [], finishReason: 'stop' };
    };
  }, JSON.stringify(passi));
}

export async function ripristina(app) {
  await app.evaluate(() => {
    if (globalThis.__origStream) globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.__origStream;
  });
}

// I messaggi di una chiamata al modello come testo solo, per cercarci dentro.
export const testoDellaChiamata = (messaggi) => (messaggi || [])
  .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');

// Una ricerca sul web lenta (una rete che tarda): conta le chiamate partite e finite. Senza durata resta in volo finché
// la prova non la lascia andare: un «ancora in volo» misurato a orologio diventa rosso su una macchina carica (#814.6).
export async function ricercaLenta(app, ms = null) {
  await app.evaluate((_, durata) => {
    globalThis.__ricerche = 0;
    globalThis.__ricercheFinite = 0;
    const trattenuta = durata == null ? new Promise((ok) => { globalThis.__lasciaRicerca = ok; }) : null;
    globalThis.SN_WEB_SEARCH = { search: async () => {
      globalThis.__ricerche += 1;
      await (trattenuta || new Promise((r) => setTimeout(r, durata)));
      globalThis.__ricercheFinite += 1;
      return { results: [{ title: 'Orari', url: 'https://example.com/orari', content: 'treni' }], provider: 'finto' };
    } };
  }, ms);
}
export async function lasciaLaRicerca(app) {
  await app.evaluate(() => globalThis.__lasciaRicerca());
}

// «In volo» si aspetta, non si presume: il titolo «Cerco sul web» compare quando il modello chiama lo strumento, prima
// che la sua risposta finisca; un fermo in quel momento ferma il modello e la ricerca non parte affatto.
export async function ricercaPartita(app) {
  await expect.poll(() => app.evaluate(() => globalThis.__ricerche), { timeout: 5_000 }).toBe(1);
}

// Il quadrato ignora i clic per una frazione di secondo da quando compare (#1296): chi ferma apposta aspetta che sia pronto.
export async function quadratoPronto(page) {
  await page.waitForFunction(() => {
    const b = document.getElementById('stopBtn');
    return !!b && !b.hidden && !b.disabled && Date.now() - Number(b.dataset.comparso || 0) >= 520;
  }, null, { timeout: 5_000, polling: 100 });
}
