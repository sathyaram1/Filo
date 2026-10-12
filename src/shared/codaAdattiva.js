// Lavori in parallelo con un tetto che si adatta: un «troppe richieste» lo dimezza e il lavoro si riprova dopo
// l'attesa chiesta, un guasto passeggero si riprova, uno definitivo ferma tutto. Non sa niente di modelli.
// Prove: tests/unit/codaAdattiva.test.mjs.

(function (global) {
  'use strict';

  // Un 429 dopo l'altro arriva a raffica da tutti i lavori in volo: il tetto si dimezza una volta per finestra.
  const FINESTRA_DIMEZZA_MS = 1000;
  const ATTESA_MAX_MS = 15000;

  function attesaPredefinita(tentativo, err) {
    const chiesta = Number(err && err.retryAfterMs);
    const base = Number.isFinite(chiesta) && chiesta >= 0 ? chiesta : 500 * 2 ** (tentativo - 1);
    return Math.min(ATTESA_MAX_MS, base + Math.floor(Math.random() * 250));
  }

  function dormi(ms, signal) {
    return new Promise((ok) => {
      if (signal && signal.aborted) { ok(); return; }
      const t = setTimeout(fine, ms);
      function fine() {
        clearTimeout(t);
        if (signal) signal.removeEventListener('abort', fine);
        ok();
      }
      if (signal) signal.addEventListener('abort', fine, { once: true });
    });
  }

  // `fai(lavoro, indice)` fa il lavoro; `classifica(err)` dice cosa fare di un errore:
  //   'lento'      troppe richieste: meno parallelismo, e il lavoro si riprova;
  //   'passeggero' rete o server giù un attimo: si riprova;
  //   'scarta'     il guasto è di questo lavoro: si salta, gli altri continuano;
  //   'fatale'     (o qualunque altra cosa) si ferma tutto.
  // Un lavoro che ha finito i tentativi si scarta. `suEsito(risultato, lavoro, indice)` arriva appena un lavoro
  // riesce. Torna { fatti, scartati: [{ indice, errore }], fermo: errore|null, interrotto }.
  async function esegui(lavori, fai, opts = {}) {
    const lista = Array.isArray(lavori) ? lavori : [];
    const massimo = Math.max(1, Math.floor(Number(opts.parallelo) || 4));
    const minimo = Math.max(1, Math.min(massimo, Math.floor(Number(opts.minimo) || 1)));
    const tentativi = Math.max(0, Math.floor(Number(opts.tentativi) >= 0 ? Number(opts.tentativi) : 4));
    const classifica = typeof opts.classifica === 'function' ? opts.classifica : () => 'fatale';
    const attesa = typeof opts.attesa === 'function' ? opts.attesa : attesaPredefinita;
    const suEsito = typeof opts.suEsito === 'function' ? opts.suEsito : null;
    const signal = opts.signal || null;

    const coda = lista.map((lavoro, indice) => ({ lavoro, indice, tentativo: 0 }));
    const scartati = [];
    let limite = massimo;
    let ultimoDimezzamento = -Infinity;
    let fatti = 0;
    let fermo = null;
    const interrotto = () => Boolean(signal && signal.aborted);

    function rallenta() {
      const ora = Date.now();
      if (ora - ultimoDimezzamento < FINESTRA_DIMEZZA_MS) return;
      ultimoDimezzamento = ora;
      limite = Math.max(minimo, Math.floor(limite / 2));
    }

    // Il tetto vale per i lavori NUOVI: chi sta riprovando il suo lo porta a termine, così nessun lavoro resta
    // orfano quando gli altri lavoratori sono già usciti.
    async function lavoratore(id) {
      while (!fermo && !interrotto() && id < limite) {
        const job = coda.shift();
        if (!job) return;
        for (;;) {
          let r;
          try {
            r = await fai(job.lavoro, job.indice);
          } catch (err) {
            if (interrotto()) return;
            const tipo = classifica(err);
            if ((tipo === 'lento' || tipo === 'passeggero') && job.tentativo < tentativi) {
              job.tentativo++;
              if (tipo === 'lento') rallenta();
              await dormi(attesa(job.tentativo, err), signal);
              if (interrotto() || fermo) return;
              continue;
            }
            if (tipo === 'lento' || tipo === 'passeggero' || tipo === 'scarta') {
              scartati.push({ indice: job.indice, errore: err });
              break;
            }
            if (!fermo) fermo = err || new Error('lavoro fallito');
            return;
          }
          fatti++;
          if (suEsito) {
            try { suEsito(r, job.lavoro, job.indice); } catch (_) {}
          }
          break;
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(massimo, coda.length) }, (_, id) => lavoratore(id)));
    return { fatti, scartati, fermo, interrotto: interrotto() };
  }

  global.SN_CODA_ADATTIVA = { esegui, attesaPredefinita, FINESTRA_DIMEZZA_MS, ATTESA_MAX_MS };
})(typeof globalThis !== 'undefined' ? globalThis : self);
