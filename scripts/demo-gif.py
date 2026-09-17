"""Create a UI-state animation from demo captures. Requires Pillow."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent / 'docs' / 'media'
frames = []
for name in ['01-suggestion', '02-next-suggestion', '03-corrected']:
    with Image.open(root / f'{name}.png') as source:
        frame = source.convert('RGB')
        frame.thumbnail((960, 675))
        frames.append(frame.copy())
frames[0].save(root / 'corrections.gif', save_all=True, append_images=frames[1:],
               duration=[2400, 2400, 2400], loop=0, optimize=True)
print(root / 'corrections.gif')
