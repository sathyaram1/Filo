# Tasti e clic veri sul display X (XTest), per le prove del giro 5 di #1509.3: la tastiera la decide il sistema.
#   tasti.py clic x y | combo Alt_L+h | scrivi parola | sequenza "combo:Alt_L+h" "scrivi:abc" ...
import ctypes, sys, time

X = ctypes.cdll.LoadLibrary('libX11.so.6')
T = ctypes.cdll.LoadLibrary('libXtst.so.6')
X.XOpenDisplay.restype = ctypes.c_void_p
X.XStringToKeysym.restype = ctypes.c_ulong
X.XStringToKeysym.argtypes = [ctypes.c_char_p]
X.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
d = ctypes.c_void_p(X.XOpenDisplay(None))


def kc(nome):
    return X.XKeysymToKeycode(d, X.XStringToKeysym(nome.encode()))


def combo(s):
    ks = [kc(n) for n in s.split('+')]
    for k in ks:
        T.XTestFakeKeyEvent(d, k, 1, 0)
    for k in reversed(ks):
        T.XTestFakeKeyEvent(d, k, 0, 0)
    X.XFlush(d)


def scrivi(p, pausa=0.03):
    for ch in p:
        k = kc(ch)
        T.XTestFakeKeyEvent(d, k, 1, 0); T.XTestFakeKeyEvent(d, k, 0, 0); X.XFlush(d); time.sleep(pausa)


def clic(x, y):
    T.XTestFakeMotionEvent(d, -1, int(x), int(y), 0); X.XFlush(d); time.sleep(0.1)
    T.XTestFakeButtonEvent(d, 1, 1, 0); X.XFlush(d); time.sleep(0.05)
    T.XTestFakeButtonEvent(d, 1, 0, 0); X.XFlush(d); time.sleep(0.1)


def passo(a):
    cosa, _, resto = a.partition(':')
    if cosa == 'combo': combo(resto)
    elif cosa == 'scrivi': scrivi(resto)
    elif cosa == 'attendi': time.sleep(float(resto))
    elif cosa == 'clic': clic(*resto.split(','))


if sys.argv[1] == 'sequenza':
    for a in sys.argv[2:]:
        passo(a)
else:
    passo(sys.argv[1] + ':' + ','.join(sys.argv[2:]) if sys.argv[1] == 'clic' else sys.argv[1] + ':' + sys.argv[2])
time.sleep(0.2)
X.XCloseDisplay(d)
