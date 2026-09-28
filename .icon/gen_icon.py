# -*- coding: utf-8 -*-
"""
生成「JSON 工具箱」应用图标：
  - assets/app.ico        多尺寸 Windows 图标（256/128/64/48/32/16）
  - web/favicon.png       网页 favicon（64x64）
  - assets/icon_preview.png  预览图（256，供人工复核）
设计：靛蓝渐变圆角方块 + 白色大括号 { }（与应用 UI 主色一致，离线纯代码绘制）
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 项目根
ASSETS = os.path.join(ROOT, "assets")
os.makedirs(ASSETS, exist_ok=True)

S = 2048  # 超采样画布，缩小后边缘更平滑

# 1) 画布与渐变底
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
grad = Image.new("RGBA", (S, S))
gd = ImageDraw.Draw(grad)
top, bot = (112, 108, 248), (67, 56, 202)  # #706CF8 -> #4338CA（靛蓝，呼应 UI 主色 #4F46E5）
for y in range(S):
    t = y / (S - 1)
    c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,)
    gd.line([(0, y), (S, y)], fill=c)

RADIUS = int(S * 0.225)
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=RADIUS, fill=255)
img.paste(grad, (0, 0), mask)

# 2) 顶部一线微光（贴着上边缘的窄高光带，扁平现代，不抢主体）
sheen = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(sheen).rounded_rectangle(
    [0, 0, S - 1, int(S * 0.30)],
    radius=RADIUS,
    fill=(255, 255, 255, 26),
)
sheen = sheen.filter(ImageFilter.GaussianBlur(S * 0.02))
img = Image.alpha_composite(img, Image.composite(sheen, Image.new("RGBA", (S, S), (0, 0, 0, 0)), mask))

d = ImageDraw.Draw(img)

# 3) 白色大括号 { }，左右对称排布，整体宽度约占 60%
target_w = S * 0.60
size = int(S * 0.62)
font_path = r"C:\Windows\Fonts\consolab.ttf"
if not os.path.exists(font_path):
    font_path = r"C:\Windows\Fonts\arialbd.ttf"
gap_ratio = 0.055  # 两个括号之间的间距（占画布）

while size > 40:
    f = ImageFont.truetype(font_path, size)
    lb = d.textbbox((0, 0), "{", font=f)
    rb = d.textbbox((0, 0), "}", font=f)
    lw, rw = lb[2] - lb[0], rb[2] - rb[0]
    gap = S * gap_ratio
    if lw + gap + rw <= target_w:
        break
    size = int(size * 0.95)

lb = d.textbbox((0, 0), "{", font=f)
rb = d.textbbox((0, 0), "}", font=f)
lh, rh = lb[3] - lb[1], rb[3] - rb[1]
gap = S * gap_ratio
total_w = lw + gap + rw
x0 = (S - total_w) / 2
# 垂直居中（以两个括号的视觉高度中点为准）
y_mid = S / 2
ly = y_mid - lh / 2 - lb[1]
ry = y_mid - rh / 2 - rb[1]
d.text((x0 - lb[0], ly), "{", font=f, fill=(255, 255, 255, 255))
d.text((x0 + lw + gap - rb[0], ry), "}", font=f, fill=(255, 255, 255, 255))

# 4) 内描边高光线（细，克制）
d.rounded_rectangle(
    [int(S * 0.008), int(S * 0.008), S - 1 - int(S * 0.008), S - 1 - int(S * 0.008)],
    radius=RADIUS - int(S * 0.008),
    outline=(255, 255, 255, 52),
    width=max(2, int(S * 0.005)),
)

# 5) 缩放输出
sizes = [512, 256, 128, 64, 48, 32, 16]
imgs = {n: img.resize((n, n), Image.LANCZOS) for n in sizes}
imgs[512].save(os.path.join(ASSETS, "app.ico"),
               sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
imgs[64].save(os.path.join(ROOT, "web", "favicon.png"))
imgs[256].save(os.path.join(ASSETS, "icon_preview.png"))

print("OK  ->", os.path.join(ASSETS, "app.ico"))
print("OK  ->", os.path.join(ROOT, "web", "favicon.png"))
print("font:", font_path, "size:", size)
