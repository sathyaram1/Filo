// Il livello di privacy (#1589) nelle prove, come lo scrive Sicurezza. Di serie è «Tutto in anticipo»: una prova che
// guarda cosa NON parte da solo da una pagina delicata lo dice a «Chiedi sulle delicate» (#2466).
export const livelloPrivacy = (app, livello, altro = {}) => app.evaluate(
  ({}, p) => globalThis.SN_STORAGE.updateSettings({ security: { privacy: p } }),
  { livello, ...altro },
);
