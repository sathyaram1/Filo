// Su Linux quale portachiavi chiedere a Chromium (prima di `ready`) e quale consigliare
// a chi non ce l'ha. Non deve mai cambiare il portachiavi a chi è su KDE (KWallet): i dati già
// cifrati lì diventerebbero illeggibili. Sentinella: tests/unit/portachiavi.test.mjs.

// Su un desktop che Chromium non riconosce (sway, i3, Hyprland…) sceglie la
// cifratura di ripiego senza nemmeno cercare il portachiavi acceso (#708.1).
// Chiedere libsecret non cambia niente sui desktop GNOME-simili, dove è già la
// scelta di Chromium, e senza servizio dei segreti ricade dove sarebbe caduto.
function portachiaviDaChiedere({ platform, env = {}, haSwitch = false } = {}) {
  if (platform !== 'linux' || haSwitch) return null;
  const desktop = String(env.XDG_CURRENT_DESKTOP || '');
  const sessione = String(env.DESKTOP_SESSION || '');
  const suKde = desktop.split(':').some((d) => /kde/i.test(d.trim()))
    || /kde|plasma/i.test(sessione)
    || Boolean(env.KDE_FULL_SESSION)
    || Boolean(env.KDE_SESSION_VERSION);
  return suKde ? null : 'gnome-libsecret';
}

// Si consiglia solo il portachiavi che Filo userebbe davvero su quel desktop (#708.1):
// su KDE solo KWallet; con la cifratura di ripiego imposta da chi lancia, nessuno.
function consiglioPortachiavi({ platform, backend } = {}) {
  if (platform !== 'linux') return '';
  const b = String(backend || '');
  if (/^kwallet/.test(b)) return 'Per farlo ricordare serve KWallet acceso: attivalo o installalo e riapri Filo.';
  if (b === 'gnome_libsecret') return 'Per farlo ricordare serve un portachiavi acceso, come GNOME Keyring: installalo o avvialo e riapri Filo.';
  return '';
}

module.exports = { portachiaviDaChiedere, consiglioPortachiavi };
