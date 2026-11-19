// Blocca il computer subito (#2377): la lettera B del doppio Ctrl e lo strumento BLOCCA_PC della chat passano di qui.
// Un ramo intero per Windows, Mac e Linux; nelle prove non blocca mai la macchina di chi le lancia (usaFinto).
// Prove: tests/unit/bloccaComputer.test.mjs.

const { execFile } = require('node:child_process');

const TEMPO_MS = 8000;

// I tentativi, in ordine: il primo che esce a zero ha bloccato. Mac: la chiamata del sistema (nessun permesso), poi la
// combinazione Ctrl+Cmd+Q (vuole Accessibilità), poi lo schermo spento (blocca se il Mac chiede la password subito).
// Linux: logind (GNOME, KDE e gli altri desktop moderni), poi gli strumenti dei desktop che non lo ascoltano.
function tentativi(piattaforma) {
  if (piattaforma === 'win32') {
    return [['rundll32.exe', ['user32.dll,LockWorkStation']]];
  }
  if (piattaforma === 'darwin') {
    const jxa = 'ObjC.import("Foundation");'
      + '$.NSBundle.bundleWithPath("/System/Library/PrivateFrameworks/login.framework").load;'
      + 'ObjC.bindFunction("SACLockScreenImmediate", ["int", []]);$.SACLockScreenImmediate();';
    return [
      ['osascript', ['-l', 'JavaScript', '-e', jxa]],
      ['osascript', ['-e', 'tell application "System Events" to keystroke "q" using {control down, command down}']],
      ['pmset', ['displaysleepnow']],
    ];
  }
  if (piattaforma === 'linux') {
    return [
      ['loginctl', ['lock-session']],
      ['xdg-screensaver', ['lock']],
      ['dm-tool', ['lock']],
      ['gnome-screensaver-command', ['-l']],
    ];
  }
  return [];
}

const esegui = (cmd, args) => new Promise((resolve) => {
  try {
    execFile(cmd, args, { timeout: TEMPO_MS, windowsHide: true }, (err) => resolve(!err));
  } catch (_) { resolve(false); }
});

let finto = null;

async function prova(piattaforma) {
  if (finto) return finto(piattaforma);
  if (process.env.NODE_ENV === 'test') return { ok: false, errore: 'prove' };
  const lista = tentativi(piattaforma);
  if (!lista.length) return { ok: false, errore: 'non-supportato' };
  for (const [cmd, args] of lista) {
    if (await esegui(cmd, args)) return { ok: true };
  }
  return { ok: false, errore: 'non-riuscito' };
}

// → { ok: true } | { ok: false, errore: 'non-supportato' | 'non-riuscito' | 'prove' }. Il blocco entra nel filo da qui,
// da qualunque strada arrivi (lettera o chat).
async function blocca({ piattaforma = process.platform } = {}) {
  const r = await prova(piattaforma);
  try { require('./accaduti').azioneDalPunto('BLOCCA_PC', {}, r.ok ? { eseguita: true } : { eseguita: false, errore: frase(r.errore) }); } catch (_) {}
  return r;
}

const FRASI = {
  'non-supportato': 'Su questo sistema Filo non sa bloccare il computer.',
  'non-riuscito': 'Il computer non si è bloccato: il sistema non ha accettato la richiesta.',
  prove: 'Nelle prove il computer non si blocca.',
};
const frase = (errore) => FRASI[errore] || FRASI['non-riuscito'];

module.exports = { blocca, tentativi, frase, _perProve: { usaFinto(fn) { finto = typeof fn === 'function' ? fn : null; } } };
