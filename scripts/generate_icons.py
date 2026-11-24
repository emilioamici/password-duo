"""Genera le icone della PWA da assets/icon-source.jpg (1024x1024, angoli bianchi fuori dal riquadro arrotondato).
Uso: python3 scripts/generate_icons.py   (richiede Pillow)"""
from PIL import Image, ImageDraw

SRC = 'assets/icon-source.jpg'
MINT = (198, 225, 216)   # colore di sfondo dell'icona
RADIUS, INSET = 224, 4   # raggio degli angoli dell'icona e margine per eliminare l'alone bianco

src = Image.open(SRC).convert('RGB')
W = src.width
S = 4  # supersampling per una maschera pulita

mask = Image.new('L', (W * S, W * S), 0)
ImageDraw.Draw(mask).rounded_rectangle((INSET * S, INSET * S, (W - INSET) * S - 1, (W - INSET) * S - 1), RADIUS * S, fill=255)
mask = mask.resize((W, W), Image.LANCZOS)

# 1) con angoli trasparenti (icone "any", favicon)
rounded = src.copy(); rounded.putalpha(mask)
# 2) a pieno riquadro: gli angoli bianchi diventano del colore dello sfondo (iOS arrotonda da sé; base per le maschere Android)
full = Image.composite(src, Image.new('RGB', src.size, MINT), mask)

def save(img, size, path):
    img.resize((size, size), Image.LANCZOS).save(path, optimize=True); print('ok', path)

save(rounded, 192, 'public/pwa-192.png')
save(rounded, 512, 'public/pwa-512.png')
save(rounded, 64, 'public/favicon.png')
save(full, 180, 'public/apple-touch-icon.png')

# maskable: l'illustrazione resta nella zona sicura (80%) su fondo pieno
canvas = Image.new('RGB', (512, 512), MINT)
inner = full.resize((410, 410), Image.LANCZOS)
canvas.paste(inner, (51, 51)); canvas.save('public/pwa-maskable-512.png', optimize=True); print('ok public/pwa-maskable-512.png')
# icona nella pagina iniziale
save(rounded, 256, 'public/app-icon.png')
