// La versione del Cua Driver (github.com/trycua/cua, libs/cua-driver, MIT) che Filo scarica, con l'impronta di ogni pacchetto.
// Un file scaricato che non combacia con la sua impronta non si installa: versione e impronte si cambiano solo insieme,
// prendendole dal SHA256SUMS della release e riscaricando ogni pacchetto. Solo il driver: mai l'estensione cua-perception (AGPL).
'use strict';

const VERSIONE = '0.35.4';
const BASE = 'https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.35.4/';

// Il pacchetto per Mac è universale: lo stesso file vale per Intel e Apple Silicon.
const MAC = {
  file: 'cua-driver-rs-0.35.4-darwin-universal-binary.tar.gz',
  sha256: '496d8c689e880f2afa484dc322ba71b59d6ec9ada25ffef9d9f51a31ad74cbf5',
  byte: 51913462,
  formato: 'tar.gz',
  eseguibile: 'cua-driver',
};

const PACCHETTI = {
  'win32-x64': {
    file: 'cua-driver-rs-0.35.4-windows-x86_64.zip',
    sha256: '823ca4b340ca85301dd65f116cfb26282c40a66f1fc465a225ee103b6b74af5b',
    byte: 35207416,
    formato: 'zip',
    eseguibile: 'cua-driver-rs-0.35.4-windows-x86_64/cua-driver.exe',
  },
  'win32-arm64': {
    file: 'cua-driver-rs-0.35.4-windows-arm64.zip',
    sha256: 'fdbbbc27f814bb850c359268f977a61d0fbd89eb1d2776e3762d36f1a752dd02',
    byte: 33074306,
    formato: 'zip',
    eseguibile: 'cua-driver-rs-0.35.4-windows-arm64/cua-driver.exe',
  },
  'darwin-x64': MAC,
  'darwin-arm64': MAC,
  'linux-x64': {
    file: 'cua-driver-rs-0.35.4-linux-x86_64-binary.tar.gz',
    sha256: '0c79ce80d9a9522c3afc93c481d72f7370678d7fb610189358457a17686914fe',
    byte: 36507128,
    formato: 'tar.gz',
    eseguibile: 'cua-driver',
  },
  'linux-arm64': {
    file: 'cua-driver-rs-0.35.4-linux-arm64-binary.tar.gz',
    sha256: '6e405e4b539446e9aae57527336978dc1550fdf3f23f9a507e80deecfa94929f',
    byte: 36084282,
    formato: 'tar.gz',
    eseguibile: 'cua-driver',
  },
};

const NOMI_SISTEMA = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };

function nomeSistema(platform = process.platform, arch = process.arch) {
  return `${NOMI_SISTEMA[platform] || platform} ${arch}`;
}

/** Il pacchetto per questo computer, con l'indirizzo intero, o null se il driver non esiste per questo sistema. */
function pacchettoPer(platform = process.platform, arch = process.arch, elenco = { VERSIONE, BASE, PACCHETTI }) {
  const p = elenco.PACCHETTI[`${platform}-${arch}`];
  if (!p) return null;
  return { ...p, versione: elenco.VERSIONE, url: elenco.BASE + p.file };
}

module.exports = { VERSIONE, BASE, PACCHETTI, pacchettoPer, nomeSistema };
