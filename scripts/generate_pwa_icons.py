"""Generate crisp CinemaVault PWA icons (192x192, 512x512, maskable-512, apple-touch-icon)."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "icons"
OUT_DIR.mkdir(parents=True, exist_ok=True)

BG = (11, 11, 12, 255)
CARD = (20, 21, 25, 255)
BORDER = (52, 54, 62, 255)
ACCENT = (229, 9, 20, 255)
CREAM = (243, 241, 235, 255)


def draw_icon(size: int, maskable: bool = False) -> Image.Image:
    # Supersample 2x for smooth antialiasing
    scale = 2
    s = size * scale
    img = Image.new("RGBA", (s, s), BG)
    draw = ImageDraw.Draw(img)

    pad = int(s * (0.20 if maskable else 0.11))
    frame_box = [pad, pad, s - pad, s - pad]
    radius = int(s * (0.14 if maskable else 0.18))

    if not maskable:
        draw.rounded_rectangle(frame_box, radius=radius, fill=CARD, outline=BORDER, width=max(2, s // 64))

    cx, cy = s // 2, s // 2
    ring_r = int(s * (0.23 if maskable else 0.27))
    ring_w = max(4, s // 18)

    # Outer cinema aperture ring
    draw.ellipse([cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r], outline=CREAM, width=ring_w)

    # Red crimson lens core
    inner_r = int(ring_r * 0.44)
    draw.ellipse([cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r], fill=ACCENT)

    # Film sprocket accents at 4 cardinal points inside the outer bezel
    sprocket_r = max(3, s // 42)
    sprocket_dist = int(ring_r * 0.72)
    for dx, dy in ((0, -sprocket_dist), (0, sprocket_dist), (-sprocket_dist, 0), (sprocket_dist, 0)):
        draw.ellipse(
            [cx + dx - sprocket_r, cy + dy - sprocket_r, cx + dx + sprocket_r, cy + dy + sprocket_r],
            fill=CREAM,
        )

    return img.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    targets = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-512.png", 512, True),
        ("apple-touch-icon.png", 180, False),
    ]
    for filename, size, maskable in targets:
        out_path = OUT_DIR / filename
        draw_icon(size, maskable=maskable).save(out_path, format="PNG", optimize=True)
        print(f"Generated {out_path} ({size}x{size}, maskable={maskable})")


if __name__ == "__main__":
    main()
