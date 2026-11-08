// Chi può togliere una priorità 3 (#2000, #2291): abbassarla o archiviarla lo fa solo l'owner, qualunque automazione scriva.
// Logica pura, fonte unica: il server la incorpora al deploy (filo-security tools/bake-shared.js) su ogni strada che scrive
// priorità o archivia; scripts/manutentore.mjs la chiede prima di chiamarlo. Prove: tests/unit/prioritaTre.test.mjs.

(function (global) {
  'use strict';

  const no = (errore, motivo) => ({ ok: false, errore, motivo });

  /** 0..3; null se manca o non si legge (un cifrato, un testo storto): una priorità ignota può essere una 3. */
  function leggi(v) {
    if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v <= 3 ? v : null;
    return /^\s*[0-3]\s*$/.test(String(v ?? '')) ? Number(String(v).trim()) : null;
  }

  /**
   * La scrittura `attuale` → `nuova`. Senza `owner`, una 3 non scende, e nemmeno una priorità ignota: chi scrive alla
   * cieca sotto la 3 può star togliendo una 3. Alzare a 3 resta sempre aperto.
   * @returns {{ ok: true, valore: number } | { ok: false, errore: 'valore'|'tre'|'ignota', motivo: string }}
   */
  function scrittura(attuale, nuova, opts) {
    const owner = !!(opts && opts.owner);
    const v = leggi(nuova);
    if (v === null) return no('valore', 'la priorità è 0, 1, 2 o 3');
    if (owner || v === 3) return { ok: true, valore: v };
    const a = leggi(attuale);
    if (a === 3) return no('tre', 'una priorità 3 non si abbassa: la toglie solo l\'owner');
    if (a === null) return no('ignota', 'non so la priorità di adesso, e potrebbe essere una 3: la toglie solo l\'owner');
    return { ok: true, valore: v };
  }

  /**
   * L'archiviazione di un feedback a priorità `attuale`: senza `owner`, né una 3 né una priorità ignota. `continuaA` è la
   * priorità del feedback dove il lavoro continua (il figlio di un'unione, l'originale di un doppione): a 3 la 3 non si
   * toglie, si sposta.
   */
  function archiviazione(attuale, opts) {
    if (opts && opts.owner) return { ok: true };
    if (opts && leggi(opts.continuaA) === 3) return { ok: true };
    const a = leggi(attuale);
    if (a === 3) return no('tre', 'un feedback a priorità 3 non si archivia: lo toglie solo l\'owner');
    if (a === null) return no('ignota', 'non so la priorità di adesso, e potrebbe essere una 3: un feedback a priorità 3 lo toglie solo l\'owner');
    return { ok: true };
  }

  global.SN_PRIORITA_TRE = Object.freeze({ leggi, scrittura, archiviazione });
})(typeof globalThis !== 'undefined' ? globalThis : this);
