#!/usr/bin/env python3
"""Build the 'I [Cloudflare logo] NY' watermark PNG.

Produces a wide, transparent PNG with white text + the Cloudflare logo
between the 'I' and 'NY'. Designed to be drawn on the bottom-right of
a postcard at small size (~25% of the postcard width).
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "public" / "cloudflare-logo.png"
OUT = ROOT / "public" / "watermark.png"

# Final watermark canvas (transparent)
W, H = 900, 300  # 3:1 aspect ratio, plenty of resolution for downscaling

# Background: transparent
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Pick the heaviest system font available
font_candidates = [
    "/System/Library/Fonts/Supplemental/Arial Black.ttf",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial.ttf",
]
font_path = next((p for p in font_candidates if Path(p).exists()), None)
if font_path is None:
    raise SystemExit("No suitable system font found")

font_size = 220
font = ImageFont.truetype(font_path, font_size)

# Load and size the Cloudflare logo to fit between text
logo = Image.open(LOGO).convert("RGBA")
target_logo_h = 230
ratio = target_logo_h / logo.height
logo = logo.resize((int(logo.width * ratio), target_logo_h), Image.LANCZOS)

# Measure text
def text_size(s, f):
    bbox = draw.textbbox((0, 0), s, font=f)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]

i_w, i_h = text_size("I", font)
ny_w, ny_h = text_size("NY", font)

# Spacing
gap = 30  # gap between I, logo, NY
total_w = i_w + gap + logo.width + gap + ny_w
start_x = (W - total_w) // 2
center_y = H // 2

# Draw I
i_x = start_x
i_y = center_y - i_h // 2 - 20  # small optical adjustment for cap height
draw.text((i_x, i_y), "I", font=font, fill=(255, 255, 255, 255))

# Draw logo
logo_x = i_x + i_w + gap
logo_y = center_y - logo.height // 2
img.paste(logo, (logo_x, logo_y), logo)

# Draw NY
ny_x = logo_x + logo.width + gap
ny_y = i_y
draw.text((ny_x, ny_y), "NY", font=font, fill=(255, 255, 255, 255))

# Add a subtle dark stroke / shadow underneath everything for legibility on light bgs
# We'll render the same text/logo onto a black layer, blur it, then composite.
shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.text((i_x + 4, i_y + 4), "I", font=font, fill=(0, 0, 0, 180))
sd.text((ny_x + 4, ny_y + 4), "NY", font=font, fill=(0, 0, 0, 180))
shadow_logo = logo.copy()
# Replace RGB of the shadow logo with black, keep its alpha
r, g, b, a = shadow_logo.split()
black = Image.new("L", logo.size, 0)
shadow_logo = Image.merge("RGBA", (black, black, black, a.point(lambda v: min(180, v))))
shadow.paste(shadow_logo, (logo_x + 4, logo_y + 4), shadow_logo)

from PIL import ImageFilter

shadow = shadow.filter(ImageFilter.GaussianBlur(radius=6))

# Composite: shadow under main
final = Image.alpha_composite(shadow, img)
final.save(OUT, "PNG", optimize=True)
print(f"Wrote {OUT}  size={OUT.stat().st_size} bytes  dims={final.size}")
