// Configurazione del login Google + Firebase Auth; come compilarla: SECURITY.md §1.
// Le variabili d'ambiente hanno la precedenza sui valori scritti qui (build CI).

const FIREBASE_API_KEY = 'AIzaSyDN_fpshLW_K78QLV0MMiX1gd-OfO7x-CY'; // pubblica per design
const FIREBASE_PROJECT_ID = 'filo-8b9cb';

module.exports = {
  // Client OAuth desktop: il secret non è confidenziale (PKCE è la vera protezione) e può
  // stare in un repo pubblico. Override via env per i build CI.
  googleClientId: process.env.FILO_GOOGLE_CLIENT_ID
    || '1022422699919-vluneltguf1sostcsbalq6us0iuctk81.apps.googleusercontent.com',
  googleClientSecret: process.env.FILO_GOOGLE_CLIENT_SECRET
    || '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',

  authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  scopes: ['openid', 'email', 'profile'],

  // Firebase Auth (Identity Toolkit) — scambia il token Google con un Firebase
  // ID token, l'unico che popola request.auth nelle regole Firestore.
  firebaseApiKey: FIREBASE_API_KEY,
  firebaseProjectId: FIREBASE_PROJECT_ID,
  signInWithIdpEndpoint: 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp',
  secureTokenEndpoint: 'https://securetoken.googleapis.com/v1/token',

  // Gate lato client per l'UX del triage: la garanzia forte sta nelle Firestore rules
  // (collezione `admins`), e le due liste vanno tenute allineate. Override via env (CSV).
  adminEmails: (process.env.FILO_ADMIN_EMAILS
    ? process.env.FILO_ADMIN_EMAILS.split(',')
    : ['sathyarampontillo@gmail.com'])
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  isConfigured() {
    return Boolean(this.googleClientId);
  },

  isAdminEmail(email) {
    return Boolean(email) && this.adminEmails.includes(String(email).toLowerCase());
  },
};
