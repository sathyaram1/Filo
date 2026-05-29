// Configurazione del login Google + Firebase Auth.
//
// COSA DEVI COMPILARE (vedi anche Filo/SECURITY.md §1):
//   1. Crea in Google Cloud Console un OAuth Client ID di tipo "Desktop app".
//   2. Incolla qui sotto clientId e clientSecret (per i client desktop Google
//      fornisce un "secret" che NON è realmente segreto — PKCE è la vera
//      protezione; va bene impacchettarlo nell'app).
//   3. In Firebase Console → Authentication → Sign-in method → Google →
//      "Aggiungi all'elenco indirizzi attendibili ID client da progetti
//      esterni", incolla lo stesso clientId: serve perché Firebase accetti i
//      token emessi da questo client desktop.
//
// I valori possono anche essere passati via variabili d'ambiente (utile per i
// build CI), che hanno la precedenza.

const FIREBASE_API_KEY = 'AIzaSyDN_fpshLW_K78QLV0MMiX1gd-OfO7x-CY'; // pubblica per design
const FIREBASE_PROJECT_ID = 'filo-8b9cb';

module.exports = {
  // OAuth client desktop. Per i client "installed"/desktop il secret NON è
  // confidenziale (è pensato per stare nell'app, PKCE è la vera protezione):
  // va bene committarlo, anche in un repo pubblico. Override via env per i build CI.
  googleClientId: process.env.FILO_GOOGLE_CLIENT_ID
    || '1022422699919-vluneltguf1sostcsbalq6us0iuctk81.apps.googleusercontent.com',
  googleClientSecret: process.env.FILO_GOOGLE_CLIENT_SECRET
    || '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',

  // Endpoint Google OAuth.
  authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  scopes: ['openid', 'email', 'profile'],

  // Firebase Auth (Identity Toolkit) — scambia il token Google con un Firebase
  // ID token, l'unico che popola request.auth nelle regole Firestore.
  firebaseApiKey: FIREBASE_API_KEY,
  firebaseProjectId: FIREBASE_PROJECT_ID,
  signInWithIdpEndpoint: 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp',
  secureTokenEndpoint: 'https://securetoken.googleapis.com/v1/token',

  isConfigured() {
    return Boolean(this.googleClientId);
  },
};
