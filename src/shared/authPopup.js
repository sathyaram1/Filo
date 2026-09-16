// Riconosce i popup di autenticazione (OAuth, «Accedi con Google»…) così il blocco-popup non li scambi per pubblicità (#209).
// Aprono una finestra verso il provider e ne comunicano l'esito via window.opener: negarli fa fallire l'accesso. Vanno sempre consentiti, e come VERA finestra popup — una scheda separata perderebbe la relazione opener↔popup.

(function (global) {
  'use strict';

  // Host noti dei provider di identità: un popup verso questi è quasi sempre un login OAuth. Match su host esatto o sottodominio.
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

  // Host «prodotto» che sono ANCHE provider di identità: hanno una navigazione pubblica vasta su cui l'utente può non essere loggato, quindi l'esenzione anti-fingerprint si restringe alle superfici di accesso e il resto del sito resta protetto (#209).
  // Gli altri host di AUTH_HOSTS sono dedicati all'autenticazione (accounts.google.com, appleid.apple.com…): lì l'intero host È la superficie di accesso.
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

  // Sottostringhe di host dei servizi di identità generici (Auth0, Okta, Firebase, Cognito…).
  const AUTH_HOST_SUFFIXES = [
    '.auth0.com',
    '.okta.com',
    '.onelogin.com',
    '.firebaseapp.com',
    '.amazoncognito.com',
    '.b2clogin.com',
  ];

  // Path tipici di OAuth/SSO: catturano i provider non elencati sopra senza aprire le porte ai popup pubblicitari, che vanno su path casuali.
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

  // Firma condivisa da isAuthPopup e dalla restrizione dell'esenzione anti-fingerprint sugli host prodotto.
  function looksLikeAuthPath(u) {
    if (AUTH_PATH_RE.test(u.pathname)) return true;
    // Alcuni provider mettono i parametri OAuth solo in query (response_type, client_id, redirect_uri): firma forte di un endpoint di autorizzazione.
    const q = u.searchParams;
    if (q.has('client_id') && (q.has('redirect_uri') || q.has('response_type'))) {
      return true;
    }
    return false;
  }

  function isAuthPopup(url) {
    if (!url || typeof url !== 'string') return false;
    let u;
    try { u = new URL(url); } catch (_) { return false; }
    if (!/^https?:$/.test(u.protocol)) return false;
    if (hostMatches(u.host)) return true;
    // Path OAuth/SSO su qualunque host (es. provider self-hosted).
    return looksLikeAuthPath(u);
  }

  // Criterio STRETTO, senza l'euristica su path/query di isAuthPopup: qui un falso positivo esenta un sito qualunque dalla protezione anti-fingerprint, e basterebbe un path «/login» per disattivarla apposta.
  function isKnownIdentityHost(url) {
    if (!url || typeof url !== 'string') return false;
    let u;
    try { u = new URL(url); } catch (_) { return false; }
    if (!/^https?:$/.test(u.protocol)) return false;
    return hostMatches(u.host);
  }

  // La SUPERFICIE DI ACCESSO esente dal rumore anti-fingerprint (#209): host dedicato all'autenticazione (o suffisso Auth0/Okta/…) → esente per intero; host prodotto → esente solo dove path/query somigliano a un accesso.
  // L'euristica vale SOLO per host già fidati, così un tracker qualunque non si auto-esenta scegliendo un path «/login».
  function isIdentityAuthSurface(url) {
    if (!url || typeof url !== 'string') return false;
    let u;
    try { u = new URL(url); } catch (_) { return false; }
    if (!/^https?:$/.test(u.protocol)) return false;
    const host = (u.host || '').toLowerCase();
    if (!host) return false;
    for (const suf of AUTH_HOST_SUFFIXES) {
      if (host.endsWith(suf)) return true;
    }
    if (!AUTH_HOSTS.includes(host)) return false;
    if (!IDENTITY_PRODUCT_HOSTS.has(host)) return true;
    return looksLikeAuthPath(u);
  }

  global.SN_AUTH_POPUP = { isAuthPopup, isKnownIdentityHost, isIdentityAuthSurface };
})(typeof globalThis !== 'undefined' ? globalThis : self);
