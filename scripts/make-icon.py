"""Generate the Echo app icon (PNG + multi-size ICO)."""

from pathlib import Path

from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
build_dir = root / "build"
build_dir.mkdir(parents=True, exist_ok=True)

size = 1024
image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)

draw.rounded_rectangle((48, 48, 976, 976), radius=220, fill=(94, 234, 212, 255))

# Simple waveform mark, matching the app's brand.
bars = [
    (250, 420, 310, 604),
    (360, 330, 420, 694),
    (470, 250, 530, 774),
    (580, 330, 640, 694),
    (690, 420, 750, 604),
]
for x1, y1, x2, y2 in bars:
    draw.rounded_rectangle((x1, y1, x2, y2), radius=30, fill=(5, 44, 39, 255))

image.save(build_dir / "icon.png")
image.save(
    build_dir / "icon.ico",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print(f"wrote {build_dir / 'icon.png'} and {build_dir / 'icon.ico'}")
