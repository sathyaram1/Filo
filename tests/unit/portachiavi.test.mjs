// Sentinella del portachiavi chiesto su Linux (#708.1): sui desktop che Chromium
// non riconosce si chiede libsecret; su KDE, su Windows/Mac e con una scelta
// esplicita di chi lancia Filo non si tocca niente.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { portachiaviDaChiedere, consiglioPortachiavi } = require('../../src/main/portachiavi.js');

test('gestori di finestre e nessun desktop dichiarato: si chiede libsecret', () => {
  for (const d of ['sway', 'i3', 'Hyprland', 'niri', '']) {
    assert.equal(portachiaviDaChiedere({ platform: 'linux', env: { XDG_CURRENT_DESKTOP: d } }), 'gnome-libsecret', d);
  }
  assert.equal(portachiaviDaChiedere({ platform: 'linux', env: {} }), 'gnome-libsecret');
});

test('desktop GNOME-simili: libsecret, che è già la scelta di Chromium', () => {
  for (const d of ['GNOME', 'ubuntu:GNOME', 'X-Cinnamon', 'XFCE', 'Pantheon', 'LXQt']) {
    assert.equal(portachiaviDaChiedere({ platform: 'linux', env: { XDG_CURRENT_DESKTOP: d } }), 'gnome-libsecret', d);
  }
});

test('KDE in qualunque forma: il portachiavi resta quello di Chromium (KWallet)', () => {
  const casi = [
    { XDG_CURRENT_DESKTOP: 'KDE' },
    { XDG_CURRENT_DESKTOP: 'kde' },
    { XDG_CURRENT_DESKTOP: 'sway:KDE' },
    { DESKTOP_SESSION: 'plasma' },
    { DESKTOP_SESSION: 'plasmawayland' },
    { DESKTOP_SESSION: 'kde-plasma' },
    { KDE_FULL_SESSION: 'true' },
    { KDE_SESSION_VERSION: '6' },
  ];
  for (const env of casi) assert.equal(portachiaviDaChiedere({ platform: 'linux', env }), null, JSON.stringify(env));
});

test('scelta esplicita di chi lancia Filo, Windows e Mac: niente', () => {
  assert.equal(portachiaviDaChiedere({ platform: 'linux', env: { XDG_CURRENT_DESKTOP: 'sway' }, haSwitch: true }), null);
  assert.equal(portachiaviDaChiedere({ platform: 'win32', env: {} }), null);
  assert.equal(portachiaviDaChiedere({ platform: 'darwin', env: {} }), null);
});

// Il consiglio nomina solo il portachiavi che Filo userebbe su quel desktop: su KDE
// GNOME Keyring non serve, altrove KWallet non basta (#708.1 giro 2).
test('il consiglio segue il portachiavi scelto: KWallet su KDE, GNOME Keyring altrove', () => {
  for (const backend of ['kwallet', 'kwallet5', 'kwallet6']) {
    const c = consiglioPortachiavi({ platform: 'linux', backend });
    assert.match(c, /KWallet/, backend);
    assert.doesNotMatch(c, /GNOME Keyring/, backend);
  }
  const c = consiglioPortachiavi({ platform: 'linux', backend: 'gnome_libsecret' });
  assert.match(c, /GNOME Keyring/);
  assert.doesNotMatch(c, /KWallet/);
});

test('nessun consiglio dove nessun portachiavi servirebbe: ripiego imposto, Windows, Mac', () => {
  for (const backend of ['basic_text', 'unknown', '', undefined]) {
    assert.equal(consiglioPortachiavi({ platform: 'linux', backend }), '', String(backend));
  }
  assert.equal(consiglioPortachiavi({ platform: 'win32', backend: 'gnome_libsecret' }), '');
  assert.equal(consiglioPortachiavi({ platform: 'darwin', backend: 'kwallet5' }), '');
});

// Gli spec non lo possono provare: Playwright lancia Electron con un portachiavi
// già scelto. Quindi si guarda che l'avvio lo chieda davvero, e prima di `ready`.
test('l\'avvio di Filo chiede il portachiavi prima di ready', () => {
  const main = readFileSync(new URL('../../src/main/main.js', import.meta.url), 'utf8');
  const chiesto = main.indexOf("appendSwitch('password-store'");
  assert.ok(chiesto > 0, 'main.js non chiede il portachiavi');
  assert.ok(main.includes('portachiaviDaChiedere('), 'main.js non usa la regola di portachiavi.js');
  assert.ok(main.includes("hasSwitch('password-store')"), 'una scelta esplicita di chi lancia Filo va rispettata');
  assert.ok(chiesto < main.indexOf('app.whenReady()'), 'dopo ready la scelta non conta più');
});
