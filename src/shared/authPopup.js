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

  // True se l'URL del popup è verosimilmente un flusso di autenticazione.
  function isAuthPopup(url) {
    if (!url || typeof url !== 'string') return false;
    let u;
    try { u = new URL(url); } catch (_) { return false; }
    if (!/^https?:$/.test(u.protocol)) return false;
    if (hostMatches(u.host)) return true;
    // Path OAuth/SSO su qualunque host (es. provider self-hosted).
    if (AUTH_PATH_RE.test(u.pathname)) return true;
    // Alcuni provider mettono i parametri OAuth solo in query (response_type,
    // client_id, redirect_uri): è una firma forte di un endpoint di autorizzazione.
    const q = u.searchParams;
    if (q.has('client_id') && (q.has('redirect_uri') || q.has('response_type'))) {
      return true;
    }
    return false;
  }

  global.SN_AUTH_POPUP = { isAuthPopup };
})(typeof globalThis !== 'undefined' ? globalThis : self);
