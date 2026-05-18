#!/usr/bin/env python3
"""Build the 'I [Cloudflare logo] NY' watermark PNG.

Produces a transparent PNG sized exactly to its content (plus padding),
with white text + the Cloudflare logo between the 'I' and 'NY'. Designed
to be drawn on the bottom-right of a postcard at small size (~25% of the
postcard width).
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "public" / "cloudflare-logo.png"
OUT = ROOT / "public" / "watermark.png"

# ---- Tunables ---------------------------------------------------------------
FONT_SIZE = 220
TARGET_LOGO_HEIGHT = 230
GAP = 36                # px between I, logo, NY
SHADOW_OFFSET = 6
SHADOW_BLUR_RADIUS = 8
PADDING = 40            # transparent padding around everything (room for shadow + safe area)
# -----------------------------------------------------------------------------

font_candidates = [
    "/System/Library/Fonts/Supplemental/Arial Black.ttf",
    "/System/Library/Fonts/Supplemental/Impact.ttf",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial.ttf",
]
font_path = next((p for p in font_candidates if Path(p).exists()), None)
if font_path is None:
    raise SystemExit("No suitable system font found")

font = ImageFont.truetype(font_path, FONT_SIZE)

# Use a throwaway draw to measure
_tmp = Image.new("RGBA", (10, 10))
_draw = ImageDraw.Draw(_tmp)


def measure(s, f):
    """Return (width, height, offset_x, offset_y) so we know how far to shift
    when drawing so the glyph sits at (0,0) in the bounding box.
    """
    bbox = _draw.textbbox((0, 0), s, font=f)
    # bbox = (x0, y0, x1, y1)
    return bbox[2] - bbox[0], bbox[3] - bbox[1], -bbox[0], -bbox[1]


i_w, i_h, i_ox, i_oy = measure("I", font)
ny_w, ny_h, ny_ox, ny_oy = measure("NY", font)

# Load logo
logo = Image.open(LOGO).convert("RGBA")
ratio = TARGET_LOGO_HEIGHT / logo.height
logo = logo.resize((int(logo.width * ratio), TARGET_LOGO_HEIGHT), Image.LANCZOS)

# Row layout: we align everything to a common centerline.
row_height = max(i_h, ny_h, logo.height)
content_width = i_w + GAP + logo.width + GAP + ny_w

W = content_width + PADDING * 2
H = row_height + PADDING * 2

img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

center_y = H // 2
cursor_x = PADDING

# Compute draw positions
def y_for(glyph_h, offset_y):
    """Top-Y so that glyph is vertically centered."""
    return center_y - glyph_h // 2 + offset_y


i_draw_pos = (cursor_x + i_ox, y_for(i_h, i_oy))
i_left = cursor_x
cursor_x += i_w + GAP

logo_pos = (cursor_x, center_y - logo.height // 2)
cursor_x += logo.width + GAP

ny_draw_pos = (cursor_x + ny_ox, y_for(ny_h, ny_oy))
ny_left = cursor_x

# --- Shadow layer (rendered separately, then blurred & composited) ---
shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.text(
    (i_draw_pos[0] + SHADOW_OFFSET, i_draw_pos[1] + SHADOW_OFFSET),
    "I",
    font=font,
    fill=(0, 0, 0, 200),
)
sd.text(
    (ny_draw_pos[0] + SHADOW_OFFSET, ny_draw_pos[1] + SHADOW_OFFSET),
    "NY",
    font=font,
    fill=(0, 0, 0, 200),
)
# Logo shadow: black silhouette
r, g, b, a = logo.split()
black = Image.new("L", logo.size, 0)
faded_alpha = a.point(lambda v: min(200, v))
shadow_logo = Image.merge("RGBA", (black, black, black, faded_alpha))
shadow.paste(
    shadow_logo,
    (logo_pos[0] + SHADOW_OFFSET, logo_pos[1] + SHADOW_OFFSET),
    shadow_logo,
)
shadow = shadow.filter(ImageFilter.GaussianBlur(radius=SHADOW_BLUR_RADIUS))

# --- Main layer ---
draw.text(i_draw_pos, "I", font=font, fill=(255, 255, 255, 255))
img.paste(logo, logo_pos, logo)
draw.text(ny_draw_pos, "NY", font=font, fill=(255, 255, 255, 255))

final = Image.alpha_composite(shadow, img)
final.save(OUT, "PNG", optimize=True)

print(
    f"Wrote {OUT}\n"
    f"  size on disk: {OUT.stat().st_size} bytes\n"
    f"  dimensions:   {final.size}\n"
    f"  layout:       I={i_w}x{i_h}  logo={logo.size[0]}x{logo.size[1]}  NY={ny_w}x{ny_h}\n"
    f"  font:         {font_path}"
)
