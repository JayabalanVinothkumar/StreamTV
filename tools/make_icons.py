"""Original VJ Hotstar icon + Android TV banner (no third-party logos).

Design: deep indigo -> violet -> magenta diagonal gradient with a soft glow,
a white rounded play button carrying a small 4-point star sparkle, and a
bold "VJ" monogram. The banner adds the "VJ Hotstar" wordmark.
Everything is drawn at 4x and downscaled for smooth edges.
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

POPPINS = "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf"
POPPINS_SEMI = "/usr/share/fonts/truetype/google-fonts/Poppins-SemiBold.ttf"
if not os.path.exists(POPPINS_SEMI):
    POPPINS_SEMI = POPPINS

C1 = (20, 16, 64)      # deep indigo
C2 = (88, 38, 196)     # violet
C3 = (226, 43, 145)    # magenta
GOLD = (255, 205, 86)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(w, h):
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x / w * 0.55 + y / h * 0.45)
            col = lerp(C1, C2, t / 0.6) if t < 0.6 else lerp(C2, C3, (t - 0.6) / 0.4)
            px[x, y] = col
    return img


def glow(img, cx, cy, r, color, alpha):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (alpha,))
    layer = layer.filter(ImageFilter.GaussianBlur(r * 0.6))
    return Image.alpha_composite(img.convert("RGBA"), layer)


def sparkle(d, cx, cy, r, fill):
    """4-point star."""
    pts = []
    for i in range(8):
        ang = math.pi / 4 * i - math.pi / 2
        rr = r if i % 2 == 0 else r * 0.28
        pts.append((cx + rr * math.cos(ang), cy + rr * math.sin(ang)))
    d.polygon(pts, fill=fill)


def play_badge(img, cx, cy, size):
    """White rounded square with a violet play triangle and a gold sparkle."""
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    # shadow
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle(
        [cx - size / 2, cy - size / 2 + size * 0.06, cx + size / 2, cy + size / 2 + size * 0.06],
        radius=size * 0.28, fill=(0, 0, 0, 110))
    sh = sh.filter(ImageFilter.GaussianBlur(size * 0.07))
    img = Image.alpha_composite(img, sh)
    d.rounded_rectangle([cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2],
                        radius=size * 0.28, fill=(255, 255, 255, 255))
    t = size * 0.26
    d.polygon([(cx - t * 0.75, cy - t), (cx - t * 0.75, cy + t), (cx + t * 1.05, cy)], fill=C2 + (255,))
    sparkle(d, cx + size * 0.30, cy - size * 0.30, size * 0.17, GOLD + (255,))
    return Image.alpha_composite(img, layer)


def text_center(d, xy, text, font, fill):
    l, t, r, b = d.textbbox((0, 0), text, font=font)
    d.text((xy[0] - (r - l) / 2 - l, xy[1] - (b - t) / 2 - t), text, font=font, fill=fill)


def make_icon(px):
    S = px * 4
    img = gradient(S, S).convert("RGBA")
    img = glow(img, S * 0.28, S * 0.22, S * 0.35, (140, 120, 255), 120)
    img = glow(img, S * 0.85, S * 0.9, S * 0.4, (255, 80, 170), 110)
    img = play_badge(img, S * 0.5, S * 0.42, S * 0.46)
    d = ImageDraw.Draw(img)
    text_center(d, (S * 0.5, S * 0.80), "VJ", ImageFont.truetype(POPPINS, int(S * 0.20)), (255, 255, 255, 255))
    sparkle(d, S * 0.18, S * 0.80, S * 0.035, (255, 255, 255, 200))
    sparkle(d, S * 0.83, S * 0.76, S * 0.025, (255, 255, 255, 170))
    # rounded corners like a launcher tile
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.22, fill=255)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out.resize((px, px), Image.LANCZOS)


def make_banner(w, h):
    W, H = w * 4, h * 4
    img = gradient(W, H).convert("RGBA")
    img = glow(img, W * 0.15, H * 0.2, H * 0.6, (140, 120, 255), 120)
    img = glow(img, W * 0.92, H * 1.0, H * 0.7, (255, 80, 170), 120)
    img = play_badge(img, W * 0.19, H * 0.5, H * 0.44)
    d = ImageDraw.Draw(img)
    x0, right = W * 0.35, W * 0.94
    # largest wordmark that fits
    size = int(H * 0.22)
    while True:
        f_big = ImageFont.truetype(POPPINS, size)
        l, t, r, b = d.textbbox((0, 0), "VJ Hotstar", font=f_big)
        if x0 + (r - l) <= right or size < 20:
            break
        size -= 4
    f_small = ImageFont.truetype(POPPINS_SEMI, int(size * 0.36))
    d.text((x0, H * 0.27), "VJ Hotstar", font=f_big, fill=(255, 255, 255, 255))
    d.text((x0 + W * 0.004, H * 0.27 + (b - t) + H * 0.12), "Movies  ·  Shows  ·  Live",
           font=f_small, fill=(255, 255, 255, 190))
    sparkle(d, W * 0.94, H * 0.14, H * 0.05, GOLD + (255,))
    sparkle(d, W * 0.89, H * 0.84, H * 0.025, (255, 255, 255, 190))
    return img.resize((w, h), Image.LANCZOS).convert("RGB")


if __name__ == "__main__":
    import sys
    res = sys.argv[1]
    sizes = {"mipmap-mdpi": 48, "mipmap-hdpi": 72, "mipmap-xhdpi": 96,
             "mipmap-xxhdpi": 144, "mipmap-xxxhdpi": 192}
    for folder, px in sizes.items():
        os.makedirs(os.path.join(res, folder), exist_ok=True)
        make_icon(px).save(os.path.join(res, folder, "ic_launcher.png"))
    os.makedirs(os.path.join(res, "drawable-xhdpi"), exist_ok=True)
    make_banner(640, 360).save(os.path.join(res, "drawable-xhdpi", "banner.png"))
    # previews
    make_icon(512).save("/home/claude/art/icon_preview.png")
    make_banner(640, 360).save("/home/claude/art/banner_preview.png")
    print("done")
