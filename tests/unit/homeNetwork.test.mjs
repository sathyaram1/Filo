// La scheda annota da dove ha risposto il frame principale (#591): è così che un nome come tplinkwifi.net, intercettato
// dal router, diventa rete di casa per i lavori automatici. Dietro un proxy risponde il proxy, e l'indirizzo non conta.
// Regole in src/main/services/homeNetwork.js e urlNav.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HomeNet = require('../../src/main/services/homeNetwork.js');
const SB = require('../../src/main/services/safebrowse/index.js');
const Nav = globalThis.SN_URL_NAV;

function sessioneFinta(proxy) {
  const ascolti = [];
  const ses = {
    ascolti,
    webRequest: { onResponseStarted: (filtro, fn) => ascolti.push({ filtro, fn }) },
  };
  if (proxy !== undefined) ses.resolveProxy = async () => proxy;
  return ses;
}

async function risponde(ses, url, ip, resourceType = 'mainFrame') {
  ses.ascolti[0].fn({ resourceType, url, ip });
  await (Nav.homeNetworkPending(new URL(url).hostname) || Promise.resolve());
}

test('la risposta del frame principale dice se un nome è di casa; le altre risorse no', async () => {
  const ses = sessioneFinta('DIRECT');
  assert.equal(HomeNet.attach(ses), true);
  assert.equal(HomeNet.attach(ses), false, 'un ascolto solo per sessione');
  assert.equal(ses.ascolti.length, 1);

  await risponde(ses, 'http://routerlogin.net/logo.png', '192.168.1.1', 'image');
  assert.equal(Nav.isHomeNetworkUrl('http://routerlogin.net/'), false, 'un\'immagine non parla per la pagina');

  await risponde(ses, 'http://routerlogin.net/start.htm', '192.168.1.1');
  assert.equal(Nav.isHomeNetworkUrl('http://routerlogin.net/'), true);

  await risponde(ses, 'https://esempio-pubblico.com/', '93.184.216.34');
  assert.equal(Nav.isHomeNetworkUrl('https://esempio-pubblico.com/'), false);
});

test('dietro un proxy della rete locale un sito di internet resta di internet', async () => {
  const ses = sessioneFinta('PROXY 10.0.0.8:3128');
  HomeNet.attach(ses);
  await risponde(ses, 'https://accesso.esempio-proxy.com/login', '10.0.0.8');
  assert.equal(Nav.isHomeNetworkHost('accesso.esempio-proxy.com'), false, 'ha risposto il proxy, non il sito');

  const diretta = sessioneFinta('DIRECT');
  HomeNet.attach(diretta);
  await risponde(diretta, 'http://tplinkwifi.net/', '192.168.0.1');
  assert.equal(Nav.isHomeNetworkHost('tplinkwifi.net'), true);
  await risponde(ses, 'http://tplinkwifi.net/', '10.0.0.8');
  assert.equal(Nav.isHomeNetworkHost('tplinkwifi.net'), false, 'arrivato dal proxy, il nome torna alla sua forma');

  const socks = sessioneFinta('SOCKS5 192.168.1.20:1080');
  HomeNet.attach(socks);
  await risponde(socks, 'https://banca-esempio-proxy.com/', '192.168.1.20');
  assert.equal(Nav.isHomeNetworkHost('banca-esempio-proxy.com'), false);
});

test('i controlli sui siti pericolosi aspettano di sapere se la pagina è arrivata da un proxy', async () => {
  const usciti = [];
  SB.setProviders({
    gsb: async (u) => { usciti.push(u); return null; },
    rdap: async (r) => { usciti.push(r); return null; },
    ct: null, llm: null, sandbox: null,
  });
  const analizza = (url) => new Promise((ok) => { SB.analyze(url, { hasPassword: true }, ok); setTimeout(ok, 100); });

  const proxy = sessioneFinta('PROXY 10.0.0.9:8080');
  HomeNet.attach(proxy);
  proxy.ascolti[0].fn({ resourceType: 'mainFrame', url: 'http://accesso.ufficio-esempio.com/login', ip: '10.0.0.9' });
  await analizza('http://accesso.ufficio-esempio.com/login');
  assert.ok(usciti.length > 0, 'un sito di internet visto dietro il proxy riceve i suoi controlli');

  usciti.length = 0;
  const casa = sessioneFinta('DIRECT');
  HomeNet.attach(casa);
  casa.ascolti[0].fn({ resourceType: 'mainFrame', url: 'http://routerlogin.com/start.htm', ip: '192.168.1.1' });
  await analizza('http://routerlogin.com/start.htm');
  assert.deepEqual(usciti, [], 'il router raggiunto per nome, diretto, resta in casa anche se lo si guarda prima di saperlo');
});
