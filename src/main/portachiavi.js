// Su Linux quale portachiavi chiedere a Chromium, da decidere prima di `ready`.
// Non deve mai cambiare il portachiavi a chi è su KDE (KWallet): i dati già
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

module.exports = { portachiaviDaChiedere };
