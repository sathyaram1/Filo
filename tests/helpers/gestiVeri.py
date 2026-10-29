# Mouse e tastiera veri sul display X (XTest): i trascinamenti fra viste li decide il sistema, e solo un gesto suo li
# prova. Lo usa tests/helpers/gestiVeri.mjs; fuori da Linux con X non serve.
#   gestiVeri.py trascina x1 y1 x2 y2     premi, scorri a piccoli passi, rilascia
#   gestiVeri.py scrivi parola            lettere minuscole, una per tasto
import ctypes, sys, time

X = ctypes.cdll.LoadLibrary('libX11.so.6')
T = ctypes.cdll.LoadLibrary('libXtst.so.6')
X.XOpenDisplay.restype = ctypes.c_void_p
X.XStringToKeysym.restype = ctypes.c_ulong
X.XStringToKeysym.argtypes = [ctypes.c_char_p]
X.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
d = X.XOpenDisplay(None)
if not d:
    sys.exit('nessun display X')
d = ctypes.c_void_p(d)


def muovi(x, y):
    T.XTestFakeMotionEvent(d, -1, int(x), int(y), 0)
    X.XFlush(d)


def tasto(giu):
    T.XTestFakeButtonEvent(d, 1, 1 if giu else 0, 0)
    X.XFlush(d)


cosa = sys.argv[1]
if cosa == 'trascina':
    x1, y1, x2, y2 = map(int, sys.argv[2:6])
    passi = 25
    muovi(x1, y1); time.sleep(0.2)
    tasto(True); time.sleep(0.15)
    for i in range(1, passi + 1):
        muovi(x1 + (x2 - x1) * i / passi, y1 + (y2 - y1) * i / passi); time.sleep(0.04)
    time.sleep(0.3)
    muovi(x2 + 1, y2); time.sleep(0.2)
    tasto(False); time.sleep(0.3)
elif cosa == 'scrivi':
    for ch in sys.argv[2]:
        kc = X.XKeysymToKeycode(d, X.XStringToKeysym(ch.encode()))
        T.XTestFakeKeyEvent(d, kc, 1, 0); T.XTestFakeKeyEvent(d, kc, 0, 0); X.XFlush(d); time.sleep(0.03)
    time.sleep(0.2)
else:
    sys.exit('uso: gestiVeri.py trascina x1 y1 x2 y2 | scrivi parola')
X.XCloseDisplay(d)
