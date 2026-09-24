"""Render designed App Store panels from real simulator screens and wardrobe images.
Uses Pillow only; does not regenerate or retouch the app UI or garments.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT = Path(__file__).resolve().parent
SIZE = (1242, 2688)
FONT = str(ROOT/'assets/Lato-Regular.ttf')
ARTWORK_BOTTOM = 2430
FOOTER_TOP = 2580

def place_artwork(canvas, image, xy):
    # Reserve 150 px of clear space before the footer, including rotated bounds.
    available_height = ARTWORK_BOTTOM - xy[1]
    if image.height > available_height:
        ratio = available_height / image.height
        image = image.resize((round(image.width * ratio), available_height), Image.Resampling.LANCZOS)
    assert xy[1] + image.height <= ARTWORK_BOTTOM
    canvas.alpha_composite(image, xy)

def text(canvas, xy, value, size, fill='#111111', spacing=8):
    ImageDraw.Draw(canvas).multiline_text(xy, value, font=ImageFont.truetype(FONT,size), fill=fill, spacing=spacing)

def garment(canvas, filename, xy, width, angle=0):
    image=Image.open(ROOT/'assets'/filename).convert('RGBA')
    image=image.resize((width,round(width*image.height/image.width)),Image.Resampling.LANCZOS)
    if angle: image=image.rotate(angle,resample=Image.Resampling.BICUBIC,expand=True)
    place_artwork(canvas,image,xy)

def phone(canvas, filename, xy, width, angle=0):
    screen=Image.open(ROOT/'screens'/filename).convert('RGBA')
    w=width-20; h=round(w*screen.height/screen.width)
    screen=screen.resize((w,h),Image.Resampling.LANCZOS)
    radius=round(width*.115)
    mask=Image.new('L',(w,h)); ImageDraw.Draw(mask).rounded_rectangle((0,0,w-1,h-1),radius=radius-10,fill=255)
    screen.putalpha(mask)
    device=Image.new('RGBA',(width,h+20))
    d=ImageDraw.Draw(device); d.rounded_rectangle((0,0,width-1,h+19),radius=radius,fill='#161616',outline='#444444',width=3)
    device.alpha_composite(screen,(10,10))
    if angle: device=device.rotate(angle,resample=Image.Resampling.BICUBIC,expand=True)
    place_artwork(canvas,device,xy)

def base(number,title,subtitle,dark=False):
    canvas=Image.new('RGBA',SIZE,'#080808' if dark else '#ffffff')
    fg='#eeeeee' if dark else '#111111'; secondary='#aaaaaa' if dark else '#686868'
    text(canvas,(102,102),'capsule',36,fg)
    text(canvas,(940,111),f'0{number} / '+{1:'capture',2:'details',3:'drafts'}[number],27,secondary)
    ImageDraw.Draw(canvas).line((102,182,1140,182),fill='#2c2c2c' if dark else '#e5e5e5',width=2)
    text(canvas,(102,285),title,104,fg,spacing=3)
    text(canvas,(106,555),subtitle,36,secondary)
    return canvas

def footer(canvas):
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype(FONT, 28)
    label = 'capsule.gtfol.dev'
    x = (canvas.width - draw.textlength(label, font=font)) / 2
    draw.text((x, FOOTER_TOP), label, font=font, fill='#777777')

out=ROOT/'exports'; out.mkdir(exist_ok=True)
files=[]
if (ROOT/'screens/sweater.png').exists():
    canvas=base(1,'photo to\nwardrobe.','add your clothes to capsule.')
    phone(canvas,'sweater.png',(293,720),790,angle=-3)
    garment(canvas,'denim.webp',(-90,1230),445,angle=9)
    footer(canvas)
    path=out/'01-photo-to-wardrobe.png';canvas.convert('RGB').save(path);files.append(path)
if (ROOT/'screens/jersey.png').exists():
    canvas=base(2,'every detail,\neditable.','name, brand, color, size, and price.',True)
    phone(canvas,'jersey.png',(226,720),790)
    footer(canvas)
    path=out/'02-editable-details.png';canvas.convert('RGB').save(path);files.append(path)
if (ROOT/'screens/drafts.png').exists():
    canvas=base(3,'save a draft.\nfinish later.','keep unfinished scans on your iPhone.')
    phone(canvas,'drafts.png',(235,720),790,angle=3)
    garment(canvas,'dunks.webp',(-75,2080),670,angle=12)
    footer(canvas)
    path=out/'03-drafts.png';canvas.convert('RGB').save(path);files.append(path)
# A compact contact sheet is for review; individual PNGs are upload sized.
if files:
    width=372; margin=24; height=round(2688*width/1242)
    sheet=Image.new('RGB',(len(files)*(width+margin)+margin,height+2*margin),'#e5e5e5')
    for i,path in enumerate(files):
        tile=Image.open(path).resize((width,height),Image.Resampling.LANCZOS)
        sheet.paste(tile,(margin+i*(width+margin),margin))
    sheet.save(out/'gallery-preview.png')
    # The browser preview uses the actual exports so its layout cannot drift.
    tiles = '\n'.join(
        f'<a class="tile" data-slide="{i}" href="exports/{path.name}"><img src="exports/{path.name}" alt="capsule App Store panel {i}"></a>'
        for i, path in enumerate(files, 1)
    )
    (ROOT/'index.html').write_text('''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>capsule — App Store gallery</title>
<style>
@font-face{font-family:Lato;src:url(assets/Lato-Regular.ttf)}
*{box-sizing:border-box}body{margin:0;padding:24px;background:#e5e5e5;color:#111;font:16px Lato,Arial,sans-serif}
header{margin-bottom:24px}.gallery{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap}
.tile{display:block;width:min(372px,100%)}img{display:block;width:100%;height:auto}
body.single{padding:0;background:white}.single header,.single .tile{display:none}
.single .tile.selected{display:block;width:1242px}
</style></head><body><header>capsule / app store · 1242 × 2688</header><main class="gallery">'''
        + tiles + '''</main><script>
const slide=new URLSearchParams(location.search).get('slide');
if(slide){document.body.classList.add('single');document.querySelector('[data-slide="'+CSS.escape(slide)+'"]')?.classList.add('selected')}
</script></body></html>''')
print('\n'.join(str(p) for p in files))
