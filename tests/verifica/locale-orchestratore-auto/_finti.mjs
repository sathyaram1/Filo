// Dipendenze finte del motore dell'orchestratore per le prove del giro: nessun processo, nessuna istanza vera.
// `verdetti` è la sequenza di stati di verify-local che il motore legge dopo ogni istanza del verificatore.

export function finti({ stato, verdetti = [], finish = [], claude = [] }) {
  const s = JSON.parse(JSON.stringify(stato));
  let v = verdetti.length ? verdetti[0] : {};
  const comandi = [];
  const prompt = [];
  return {
    comandi,
    prompt,
    store: { leggi: () => JSON.parse(JSON.stringify(s)), salvaPratica: (p) => { s.pratiche[p.num] = JSON.parse(JSON.stringify(p)); } },
    esegui: async (cmd, args) => {
      const a = args.join(' ');
      comandi.push(`${cmd} ${a}`);
      if (/rev-list --count origin\/main\.\.HEAD/.test(a)) return { code: 0, out: '2', stdout: '2' };
      if (/rev-list --count/.test(a)) return { code: 0, out: '0', stdout: '0' };
      if (/diff --name-only/.test(a)) return { code: 0, out: 'scripts/x.mjs', stdout: 'scripts/x.mjs' };
      if (/finish-local/.test(a)) { const c = finish.length ? finish.shift() : 0; return { code: c, out: c ? 'bloccata dai controlli' : 'fuso', stdout: '' }; }
      if (/verify-local\.mjs start/.test(a)) { if (!v.entry) v = { ok: false, entry: { request: 'x' } }; return { code: 0, out: 'COMPITO', stdout: 'COMPITO' }; }
      return { code: 0, out: '', stdout: '' };
    },
    claude: async ({ ruolo, prompt: testo }) => {
      prompt.push({ ruolo, testo });
      comandi.push(`claude ${ruolo}`);
      const r = claude.length ? claude.shift() : { ok: true, testo: 'fatto', costo: 1 };
      if (ruolo === 'verificatore' && verdetti.length > 1) { verdetti.shift(); v = verdetti[0]; }
      return r;
    },
    verifica: () => v,
    pubblica: async () => ({ code: 0, out: '' }),
    carico: async () => ({ cpu: 0, liberaGB: 99 }),
    dormi: () => new Promise((ok) => setImmediate(ok)),
    log: () => {},
    ora: () => '2026-10-04T00:00:00Z',
    percorsi: { radice: '/r', wt: (x) => `/r/wt/${x}`, serverRadice: '', wtServer: () => '', note: '/cartella-note', regole: 'REGOLE' },
    fs: { esiste: () => true, collega: () => {}, scollega: () => {} },
    annota: async () => {},
    richiestaDi: async () => 'richiesta',
  };
}
