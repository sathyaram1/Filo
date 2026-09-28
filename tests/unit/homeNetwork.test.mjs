// La scheda annota da dove ha risposto il frame principale (#591): è così che un nome come tplinkwifi.net, intercettato
// dal router, diventa rete di casa per i lavori automatici. Regole in src/main/services/homeNetwork.js e urlNav.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HomeNet = require('../../src/main/services/homeNetwork.js');

function sessioneFinta() {
  const ascolti = [];
  return {
    ascolti,
    webRequest: { onResponseStarted: (filtro, fn) => ascolti.push({ filtro, fn }) },
  };
}

test('la risposta del frame principale dice se un nome è di casa; le altre risorse no', () => {
  const ses = sessioneFinta();
  assert.equal(HomeNet.attach(ses), true);
  assert.equal(HomeNet.attach(ses), false, 'un ascolto solo per sessione');
  assert.equal(ses.ascolti.length, 1);
  const risposta = ses.ascolti[0].fn;
  const Nav = globalThis.SN_URL_NAV;

  risposta({ resourceType: 'image', url: 'http://routerlogin.net/logo.png', ip: '192.168.1.1' });
  assert.equal(Nav.isHomeNetworkUrl('http://routerlogin.net/'), false, 'un\'immagine non parla per la pagina');

  risposta({ resourceType: 'mainFrame', url: 'http://routerlogin.net/start.htm', ip: '192.168.1.1' });
  assert.equal(Nav.isHomeNetworkUrl('http://routerlogin.net/'), true);

  risposta({ resourceType: 'mainFrame', url: 'https://esempio-pubblico.com/', ip: '93.184.216.34' });
  assert.equal(Nav.isHomeNetworkUrl('https://esempio-pubblico.com/'), false);
});
