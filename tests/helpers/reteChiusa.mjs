// La rete delle prove con siti finti (#1492.1, regola nata in #1456): i siti finti li serve la prova, il mini server
// locale (127.0.0.1) prosegue, tutto il resto riceve errore e non esce, perché un nome finto può esistere davvero.
// L'unica uscita verso la rete è `resto` qui sotto; sentinella: tests/unit/reteChiusa.test.mjs.

// Mette nel main `globalThis.__reteChiusa`: `resto(req)` è dove un gestore http/https di una prova manda quello che
// non serve lui, e `richieste` conta ogni indirizzo passato da lì o da serviSiti. Ogni chiamata riparte da zero.
export async function chiudiLaRete(app) {
  await app.evaluate(({ net }) => {
    const richieste = [];
    globalThis.__reteChiusa = {
      richieste,
      resto(req) {
        richieste.push(req.url);
        let host = '';
        try { host = new URL(req.url).hostname; } catch (_) {}
        if (host === '127.0.0.1') return net.fetch(req, { bypassCustomProtocolHandlers: true });
        return Response.error();
      },
    };
  });
}

// `pagine`: { 'host/percorso': html } o { host: html } per ogni percorso; al posto dell'html { corpo, tipo, stato }.
export async function serviSiti(app, pagine = {}, { schemi = ['http', 'https'] } = {}) {
  await chiudiLaRete(app);
  await app.evaluate(({ session }, { pg, schemi: sc }) => {
    const rete = globalThis.__reteChiusa;
    const risposta = (req) => {
      const u = new URL(req.url);
      const p = pg[u.hostname + u.pathname] || pg[u.hostname];
      if (!p) return rete.resto(req);
      rete.richieste.push(req.url);
      const { corpo, tipo = 'text/html; charset=utf-8', stato = 200 } = typeof p === 'string' ? { corpo: p } : p;
      return new Response(corpo, { status: stato, headers: { 'content-type': tipo } });
    };
    for (const s of sc) {
      try { session.defaultSession.protocol.unhandle(s); } catch (_) {}
      session.defaultSession.protocol.handle(s, risposta);
    }
  }, { pg: pagine, schemi });
}

// Le richieste contate verso `host` (e i suoi sottodomini), o verso i nomi che soddisfano un'espressione.
export const richiesteVerso = (app, host) => app.evaluate((_, { h, re }) => globalThis.__reteChiusa.richieste.filter((u) => {
  try { const n = new URL(u).hostname; return re ? new RegExp(re).test(n) : n === h || n.endsWith('.' + h); } catch (_) { return false; }
}), host instanceof RegExp ? { re: host.source } : { h: host });
