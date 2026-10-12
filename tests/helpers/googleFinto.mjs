// Google finto per l'accesso che si apre in una scheda (#1123): le pagine d'accesso puntano al server della prova,
// su un nome che non è il loopback (sito-pubblico.test), e il browser di sistema registra cosa gli si chiede.
// La pagina finta ha «Continua» (torna al loopback col codice) e «Annulla»; con `rifiuta` fa come Google quando
// non accetta l'accesso dentro Filo.

const PAGINA = (rifiuta) => `<!doctype html><meta charset="utf-8"><title>Accedi - Google finto</title>
<body style="font-family:system-ui;padding:2rem">
<button id="continua">Continua</button> <button id="annulla">Annulla</button>
<script>
  const p = new URLSearchParams(location.search);
  const vai = (q) => { location.href = p.get('redirect_uri') + '/?' + q + '&state=' + encodeURIComponent(p.get('state')); };
  document.getElementById('continua').onclick = () => vai('code=codice-prova');
  document.getElementById('annulla').onclick = () => vai('error=access_denied');
  ${rifiuta ? "setTimeout(() => { location.href = '/v3/signin/rejected?rrk=46'; }, 50);" : ''}
</script></body>`;

export async function googleFinto(app, testServer, { rifiuta = false } = {}) {
  const pagina = testServer.html(PAGINA(rifiuta), { pubblico: true });
  await app.evaluate(({ shell }, endpoint) => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]config\.js$/.test(x));
    M._cache[k].exports.authEndpoint = endpoint;
    M._cache[k].exports.webLoginEndpoint = endpoint;
    globalThis.__aperture = [];
    shell.openExternal = async (u) => { globalThis.__aperture.push(String(u)); };
  }, pagina);
  return pagina;
}

// Le risposte di Google (scambio del codice) e di Firebase, finte nel main.
export async function risposteFinte(app, email) {
  await app.evaluate((_e, email) => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const jwt = `${b64({ alg: 'none' })}.${b64({ user_id: 'uid-prova', sub: 'uid-prova', email })}.x`;
    const vero = globalThis.__fetchVero || globalThis.fetch;
    globalThis.__fetchVero = vero;
    const risposta = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    globalThis.fetch = async (input, init) => {
      const u = String(input && input.url ? input.url : input);
      if (u.startsWith('https://oauth2.googleapis.com/token')) return risposta({ id_token: jwt, access_token: 'a' });
      if (u.includes('accounts:signInWithIdp')) {
        return risposta({ idToken: jwt, refreshToken: 'rt-prova', email, displayName: 'Chi Accede', photoUrl: '', expiresIn: '3600' });
      }
      return vero(input, init);
    };
  }, email);
}

// Le schede aperte su `prefisso`, viste dal main: { id, url, attiva }.
export async function schedeSu(app, prefisso) {
  return app.evaluate(({ BrowserWindow }, p) => {
    const out = [];
    const su = (u) => String(u || '') === p || String(u || '').startsWith(p + '?');
    for (const w of BrowserWindow.getAllWindows()) {
      const t = w._filoTabs;
      if (!t) continue;
      for (const s of t.tabs) {
        let url = '';
        try { url = s.view.webContents.getURL() || s.url || ''; } catch (_) { url = s.url || ''; }
        if (su(url) || su(s.url)) out.push({ id: s.id, url: su(url) ? url : s.url, attiva: t.activeId === s.id });
      }
    }
    return out;
  }, prefisso);
}

// L'indirizzo d'accesso aperto in una scheda, appena c'è.
export async function indirizzoDellAccesso(app, prefisso, { tetto = 10_000 } = {}) {
  const scade = Date.now() + tetto;
  while (Date.now() < scade) {
    const [s] = await schedeSu(app, prefisso);
    if (s) return s.url;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

// Il ritorno dal consenso, come lo farebbe Google: il loopback riceve codice e state.
export async function rispondiAlLoopback(url, query = 'code=codice-prova') {
  const p = new URL(url).searchParams;
  const ritorno = `${p.get('redirect_uri')}/?${query}&state=${encodeURIComponent(p.get('state'))}`;
  return fetch(ritorno).then((r) => r.status);
}
