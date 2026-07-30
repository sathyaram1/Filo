// Riconosce i popup di autenticazione (OAuth / "Accedi con Google" e simili)
// così il blocco-popup NON li scambi per popup pubblicitari (#209).
//
// I flussi "Continua con Google/Apple/Microsoft…" aprono una finestra con
// window.open() verso il provider e poi comunicano l'esito al sito tramite
// window.opener (postMessage / redirect). Se il blocco-popup li nega, l'accesso
// fallisce con "errore durante l'accesso". Questi popup NON sono mai pubblicità:
// vanno sempre consentiti, e come VERA finestra popup (non nuova scheda), perché
// serve la relazione opener↔popup che una scheda separata perderebbe.

(function (global) {
  'use strict';

  // Host noti dei provider di identità: l'apertura di un popup verso questi è
  // quasi sempre un login OAuth. Match su host esatto o sottodominio.
  const AUTH_HOSTS = [
    'accounts.google.com',
    'accounts.youtube.com',
    'login.microsoftonline.com',
    'login.microsoft.com',
    'login.live.com',
    'login.yahoo.com',
    'appleid.apple.com',
    'github.com',
    'gitlab.com',
    'oauth.telegram.org',
    'discord.com',
    'www.facebook.com',
    'm.facebook.com',
    'facebook.com',
    'api.twitter.com',
    'twitter.com',
    'x.com',
    'www.linkedin.com',
    'linkedin.com',
    'auth.openai.com',
    'www.dropbox.com',
    'slack.com',
  ];

  // Host "prodotto" che sono ANCHE provider di identità: oltre al login hanno
  // una vasta navigazione pubblica (repository, feed, canali, profili…) su cui
  // l'utente può NON essere loggato. Per questi l'esenzione anti-fingerprint va
  // ristretta alle sole superfici di accesso (login/OAuth), così il resto del
  // sito resta protetto (#209). Gli altri host di AUTH_HOSTS sono invece host
  // dedicati all'autenticazione (accounts.google.com, login.microsoftonline.com,
  // appleid.apple.com, auth.openai.com…): lì l'intero host È la superficie di
  // accesso, quindi resta esente per intero.
  const IDENTITY_PRODUCT_HOSTS = new Set([
    'github.com',
    'gitlab.com',
    'discord.com',
    'www.facebook.com',
    'm.facebook.com',
    'facebook.com',
    'api.twitter.com',
    'twitter.com',
    'x.com',
    'www.linkedin.com',
    'linkedin.com',
    'www.dropbox.com',
    'slack.com',
  ]);

  // Sottostringhe di host che indicano un servizio di identità generico
  // (Auth0, Okta, Firebase, Amazon Cognito, …).
  const AUTH_HOST_SUFFIXES = [
    '.auth0.com',
    '.okta.com',
    '.onelogin.com',
    '.firebaseapp.com',
    '.amazoncognito.com',
    '.b2clogin.com',
  ];

  // Pattern di path tipici dell'OAuth / SSO. Catturano provider non elencati
  // sopra senza aprire le porte ai popup pubblicitari (che vanno su path random).
  const AUTH_PATH_RE = /(^|\/)(oauth2?|o\/oauth2|authorize|signin|sign[-_]?in|login|auth|sso|saml|openid)(\/|$|[?#])/i;

  function hostMatches(host) {
    if (!host) return false;
    host = host.toLowerCase();
    if (AUTH_HOSTS.includes(host)) return true;
    for (const suf of AUTH_HOST_SUFFIXES) {
      if (host.endsWith(suf)) return true;
    }
    return false;
  }

  // True se path/query dell'URL somigliano a un endpoint di autenticazione
  // (OAuth authorize, signin, login, SSO…). Firma condivisa da isAuthPopup e
  // dalla restrizione dell'esenzione anti-fingerprint sugli host prodotto.
  function looksLikeAuthPath(u) {
    if (AUTH_PATH_RE.test(u.pathname)) return true;
    // Alcuni provider mettono i parametri OAuth solo in query (response_type,
    // client_id, redirect_uri): è una firma forte di un endpoint di autorizzazione.
    const q = u.searchParams;
    if (q.has('client_id') && (q.has('redirect_uri') || q.has('response_type'))) {
      return true;
    }
    return false;
  }

  // True se l'URL del popup è verosimilmente un flusso di autenticazione.
  function isAuthPopup(url) {
    if (!url || typeof url !== 'string') return false;
    let u;
    try { u = new URL(url); } catch (_) { return false; }
    if (!/^https?:$/.test(u.protocol)) return false;
    if (hostMatches(u.host)) return true;
    // Path OAuth/SSO su qualunque host (es. provider self-hosted).
    return looksLikeAuthPath(u);
  }

  // True se l'host è un provider di identità NOTO (match esatto host o
  // sottodominio su AUTH_HOSTS/AUTH_HOST_SUFFIXES). A differenza di
  // isAuthPopup() non usa l'euristica su path/query (pensata per riconoscere
  // popup OAuth generici, contesto a basso rischio se sbaglia): qui serve un
  // criterio stretto perché un falso positivo esenta un sito qualunque dalla
  // protezione anti-fingerprint (basterebbe un path "/login" o dei parametri
  // client_id/redirect_uri per disattivarla deliberatamente).
  function isKnownIdentityHost(url) {
    if (!url || typeof url !== 'string') return false;
    let u;
    try { u = new URL(url); } catch (_) { return false; }
    if (!/^https?:$/.test(u.protocol)) return false;
    return hostMatches(u.host);
  }

  // True se l'URL è una SUPERFICIE DI ACCESSO di un provider di identità noto,
  // cioè ciò che va esentato dal rumore anti-fingerprint (#209). Regole:
  //   - host dedicato all'autenticazione (in AUTH_HOSTS ma NON in
  //     IDENTITY_PRODUCT_HOSTS, oppure suffisso Auth0/Okta/…): l'intero host è
  //     esente — lì non c'è navigazione generica, tutto è login/account.
  //   - host prodotto (github.com, x.com, discord.com, facebook.com…): esente
  //     SOLO se path/query somigliano a un accesso (login/OAuth). Il resto del
  //     sito torna protetto dal rumore.
  // Nota sicurezza: l'euristica su path/query qui è applicata SOLO a host già
  // nella lista fidata dei provider — un tracker arbitrario non può auto-esentarsi
  // scegliendo un path "/login" (resta escluso perché il suo host non è noto).
  function isIdentityAuthSurface(url) {
    if (!url || typeof url !== 'string') return false;
    let u;
    try { u = new URL(url); } catch (_) { return false; }
    if (!/^https?:$/.test(u.protocol)) return false;
    const host = (u.host || '').toLowerCase();
    if (!host) return false;
    // Host di infrastruttura auth (Auth0, Okta, Cognito, …): l'intero host è auth.
    for (const suf of AUTH_HOST_SUFFIXES) {
      if (host.endsWith(suf)) return true;
    }
    if (!AUTH_HOSTS.includes(host)) return false;
    // Host dedicato all'autenticazione → intero host esente.
    if (!IDENTITY_PRODUCT_HOSTS.has(host)) return true;
    // Host prodotto → esente solo sulla superficie di accesso.
    return looksLikeAuthPath(u);
  }

  global.SN_AUTH_POPUP = { isAuthPopup, isKnownIdentityHost, isIdentityAuthSurface };
})(typeof globalThis !== 'undefined' ? globalThis : self);
