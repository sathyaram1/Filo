// La chiave privata dei feedback cifrati (S1.3): dove la si trova sul computer dell'owner. Non esce mai dal main.
// La leggono il triage dei feedback (handlers/auth.js) e i segreti custoditi (#1507), che la tengono fuori da uscite e prompt.

const path = require('node:path');

// Si rilegge a ogni chiamata, così un cambio a runtime vale subito.
async function getPrivateKey() {
  // Prima l'ambiente: è la scelta esplicita di chi lancia Filo.
  if (process.env.FILO_FEEDBACK_PRIVKEY) return process.env.FILO_FEEDBACK_PRIVKEY.trim();

  // Poi tests/agent/.env (gitignorato) e infine il campo `feedbackPrivateKey` di storage.json.
  try {
    const fs = require('node:fs');
    const envFile = path.join(__dirname, '..', '..', '..', 'tests', 'agent', '.env');
    if (fs.existsSync(envFile)) {
      const lines = fs.readFileSync(envFile, 'utf8').split('\n');
      for (const line of lines) {
        const m = line.match(/^FILO_FEEDBACK_PRIVKEY\s*=\s*(.+)$/);
        if (m) return m[1].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch (_) {}

  try {
    if (globalThis.SN_STORAGE) {
      const v = await globalThis.SN_STORAGE.getRaw('feedbackPrivateKey', null);
      if (v && typeof v === 'string') return v.trim();
    }
  } catch (_) {}

  return null;
}

module.exports = { getPrivateKey };
