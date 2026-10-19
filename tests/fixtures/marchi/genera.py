# Rigenera le immagini di prova dei marchi invisibili (#889): python tests/fixtures/marchi/genera.py
# Serve: pip install invisible-watermark opencv-python-headless PyWavelets numpy Pillow scikit-image
# Le foto sono di scikit-image: astronaut e rocket (NASA e SpaceX, pubblico dominio),
# coffee e chelsea (CC0). Ogni marchio passa dal cammino vero del suo generatore: centro di U, ordine dei
# canali e arrotondamento sono quelli che decidono se il lettore lo trova.

import os
import numpy as np
import cv2
import skimage.data as sd
from PIL import Image
from imwatermark import WatermarkEncoder

QUI = os.path.dirname(os.path.abspath(__file__))
SDXL = [int(b) for b in bin(0b101100111110110010010000011110111011000110011110)[2:]]
FLUX = [int(b) for b in bin(0b001010101111111010000111100111001111010100101110)[2:]]


def codificatore(tipo, contenuto):
    e = WatermarkEncoder()
    e.set_watermark(tipo, contenuto)
    return e


# diffusers, pipelines/stable_diffusion_xl/watermark.py: uscita del modello in virgola mobile, RGB girato in BGR.
def sdxl(rgb):
    x = rgb.astype(np.float32)
    out = codificatore('bits', SDXL).encode(np.ascontiguousarray(x[:, :, ::-1]), 'dwtDct')[:, :, ::-1]
    out = np.clip(2 * (out / 255 - 0.5), -1, 1)
    return np.round(np.clip(out / 2 + 0.5, 0, 1) * 255).astype(np.uint8)


# black-forest-labs/flux, src/flux/util.py: stessa strada, poi .byte() tronca e il salvataggio è JPEG 95, 4:4:4.
def flux(rgb):
    img = 255 * (0.5 * (rgb.astype(np.float32) / 127.5 - 1) + 0.5)
    out = codificatore('bits', FLUX).encode(np.ascontiguousarray(img[:, :, ::-1]), 'dwtDct')[:, :, ::-1]
    out = np.clip(out / 255, 0, 1) * 2 - 1
    return (127.5 * (out + 1.0)).astype(np.uint8)


# CompVis/stable-diffusion, scripts/txt2img.py: l'immagine già a 8 bit, convertita in BGR con OpenCV.
def sd1(rgb):
    bgr = cv2.cvtColor(np.ascontiguousarray(rgb), cv2.COLOR_RGB2BGR)
    out = codificatore('bytes', 'StableDiffusionV1'.encode('utf-8')).encode(bgr, 'dwtDct')
    return np.ascontiguousarray(out[:, :, ::-1])


def salva(rgb, nome, **opzioni):
    Image.fromarray(rgb).save(os.path.join(QUI, nome), **opzioni)


base = sd.coffee()[60:316, 40:360]
salva(base, 'senza-marchio.png')
salva(sdxl(base), 'marchio-sdxl.png')
salva(sd1(base), 'marchio-sd1.png')
salva(flux(base), 'marchio-flux.jpg', quality=95, subsampling=0)

for nome, rgb in [('astronauta', sd.astronaut()), ('gatto', sd.chelsea()), ('caffe', sd.coffee()),
                  ('razzo', sd.rocket())]:
    salva(rgb, f'foto-{nome}.jpg', quality=88)
