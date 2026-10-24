// I database del sito (IndexedDB) che «Resta connesso» porta da un jar all'altro (#759): la codifica gira nella
// pagina vecchia come sorgente (tabs/tabRestaConnesso.js), la semina nel preload della pagina nuova prima dei suoi
// script. Solo valori clonabili e trascrivibili: il resto fa restare indietro il database intero.

// Si dimensiona su un'app web grossa (decine di MB); oltre, il database resta e l'utente lo sa.
const DB_TETTO = 64 * 1024 * 1024;

const DB_CODIFICA = `
  const codifica = (v) => {
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : { $: 'n', v: String(v) };
    if (v === undefined) return { $: 'u' };
    if (typeof v === 'bigint') return { $: 'b', v: String(v) };
    if (Array.isArray(v)) return { $: 'a', v: v.map(codifica) };
    if (v instanceof Date) return { $: 'd', v: v.getTime() };
    if (v instanceof RegExp) return { $: 'r', v: v.source, f: v.flags };
    const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
    if (v instanceof ArrayBuffer) return { $: 'ab', v: b64(new Uint8Array(v)) };
    if (ArrayBuffer.isView(v)) return { $: 'tv', t: v.constructor.name, v: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    if (v instanceof Map) return { $: 'm', v: Array.from(v, ([k, x]) => [codifica(k), codifica(x)]) };
    if (v instanceof Set) return { $: 's', v: Array.from(v, codifica) };
    const proto = Object.getPrototypeOf(v);
    if (typeof v === 'object' && (proto === Object.prototype || proto === null)) {
      const o = {};
      for (const k of Object.keys(v)) o[k] = codifica(v[k]);
      return { $: 'o', v: o };
    }
    throw new Error('non copiabile');
  };`;

function decodifica(v) {
  if (v === null || typeof v !== 'object') return v;
  const da64 = (s) => { const b = atob(s); const u8 = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i); return u8; };
  switch (v.$) {
    case 'n': return Number(v.v);
    case 'u': return undefined;
    case 'b': return BigInt(v.v);
    case 'a': return v.v.map(decodifica);
    case 'd': return new Date(v.v);
    case 'r': return new RegExp(v.v, v.f);
    case 'ab': return da64(v.v).buffer;
    case 'tv': {
      const u8 = da64(v.v);
      const C = v.t === 'DataView' ? DataView : globalThis[v.t];
      if (typeof C !== 'function') return u8;
      return v.t === 'DataView' ? new DataView(u8.buffer) : new C(u8.buffer, 0, u8.byteLength / (C.BYTES_PER_ELEMENT || 1));
    }
    case 'm': return new Map(v.v.map(([k, x]) => [decodifica(k), decodifica(x)]));
    case 's': return new Set(v.v.map(decodifica));
    case 'o': { const o = {}; for (const k of Object.keys(v.v)) o[k] = decodifica(v.v[k]); return o; }
    default: return undefined;
  }
}

function riempi(st, righe, conChiave) {
  for (const [k, v] of righe) {
    try { if (conChiave) st.put(decodifica(v), decodifica(k)); else st.put(decodifica(v)); } catch (_) {}
  }
}

// La richiesta d'apertura parte prima degli script della pagina: le loro aperture dello stesso database aspettano
// in coda che la nostra (creazione e righe nella stessa transazione) sia finita.
function semina(idb, voci) {
  if (!idb || !Array.isArray(voci)) return;
  for (const testo of voci) {
    let d = null;
    try { d = JSON.parse(String(testo)); } catch (_) { continue; }
    if (!d || typeof d.n !== 'string' || !Array.isArray(d.s)) continue;
    let creato = false;
    let r = null;
    try { r = idb.open(d.n, d.v > 0 ? d.v : undefined); } catch (_) { continue; }
    r.onupgradeneeded = () => {
      creato = true;
      const db = r.result;
      for (const n of d.s) {
        try {
          const st = db.objectStoreNames.contains(n.n) ? r.transaction.objectStore(n.n)
            : db.createObjectStore(n.n, { keyPath: n.k == null ? undefined : n.k, autoIncrement: !!n.a });
          for (const ix of n.i || []) {
            try { if (!st.indexNames.contains(ix.n)) st.createIndex(ix.n, ix.k, { unique: !!ix.u, multiEntry: !!ix.m }); } catch (_) {}
          }
          riempi(st, n.r || [], n.k == null);
        } catch (_) {}
      }
    };
    // Il database c'era già alla stessa versione (un jar che il sito aveva usato prima): le righe portate vincono.
    r.onsuccess = () => {
      const db = r.result;
      if (!creato) {
        const nomi = d.s.map((n) => n.n).filter((n) => db.objectStoreNames.contains(n));
        if (nomi.length) {
          try {
            const tx = db.transaction(nomi, 'readwrite');
            for (const n of d.s) {
              if (!nomi.includes(n.n)) continue;
              const st = tx.objectStore(n.n);
              st.clear();
              riempi(st, n.r || [], n.k == null);
            }
            tx.oncomplete = tx.onabort = () => { try { db.close(); } catch (_) {} };
            return;
          } catch (_) {}
        }
      }
      try { db.close(); } catch (_) {}
    };
    r.onerror = () => {};
  }
}

module.exports = { DB_CODIFICA, DB_TETTO, semina, decodifica };
