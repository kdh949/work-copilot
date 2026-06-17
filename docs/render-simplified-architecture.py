from PIL import Image, ImageDraw, ImageFont


OUT = "docs/jg-mentor-simplified-architecture.png"
W, H = 1800, 1100
BG = "#f8fafc"
INK = "#111827"
MUTED = "#64748b"
BLUE = "#2563eb"
GREEN = "#059669"
AMBER = "#d97706"
VIOLET = "#7c3aed"
ROSE = "#e11d48"
SLATE = "#334155"
LINE = "#cbd5e1"


def font(size: int, bold: bool = False):
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


title_font = font(54, True)
label_font = font(31, True)
small_font = font(23)
tiny_font = font(19)


img = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(img)


def rounded_box(xy, fill, outline=None, width=3, radius=26):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def center_text(text, cx, y, fnt, fill=INK, line_gap=6):
    lines = text.split("\n")
    current_y = y
    for line in lines:
        box = draw.textbbox((0, 0), line, font=fnt)
        draw.text((cx - (box[2] - box[0]) / 2, current_y), line, font=fnt, fill=fill)
        current_y += box[3] - box[1] + line_gap


def arrow(start, end, color=SLATE, width=7):
    draw.line([start, end], fill=color, width=width)
    sx, sy = start
    ex, ey = end
    if abs(ex - sx) >= abs(ey - sy):
        direction = 1 if ex > sx else -1
        pts = [(ex, ey), (ex - direction * 28, ey - 16), (ex - direction * 28, ey + 16)]
    else:
        direction = 1 if ey > sy else -1
        pts = [(ex, ey), (ex - 16, ey - direction * 28), (ex + 16, ey - direction * 28)]
    draw.polygon(pts, fill=color)


def icon_node(cx, cy, color, title, subtitle, symbol):
    r = 105
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill="white", outline=color, width=9)
    center_text(symbol, cx, cy - 50, font(66, True), color)
    center_text(title, cx, cy + 120, label_font, INK)
    if subtitle:
        center_text(subtitle, cx, cy + 163, small_font, MUTED)


draw.text((95, 70), "JG Mentor Architecture", font=title_font, fill=INK)
draw.text(
    (98, 142),
    "Simplified service flow: frontend, NestJS API, FastAPI AI/RAG, PostgreSQL + pgvector, external AI/data sources",
    font=small_font,
    fill=MUTED,
)

rounded_box((70, 245, 1730, 895), "#ffffff", LINE, 4, 34)

positions = {
    "user": (185, 480),
    "front": (445, 480),
    "api": (720, 480),
    "db": (995, 480),
    "ai": (720, 775),
    "vector": (995, 775),
    "openai": (1280, 620),
    "sources": (1535, 620),
}

arrow((290, 480), (340, 480), BLUE)
arrow((550, 480), (615, 480), BLUE)
arrow((825, 480), (890, 480), GREEN)
arrow((720, 585), (720, 670), VIOLET)
arrow((825, 775), (890, 775), VIOLET)
arrow((995, 670), (995, 585), GREEN)
arrow((825, 725), (1175, 640), AMBER)
arrow((825, 825), (1430, 645), ROSE)

draw.text((318, 430), "use", font=tiny_font, fill=MUTED)
draw.text((575, 430), "REST", font=tiny_font, fill=MUTED)
draw.text((840, 430), "CRUD", font=tiny_font, fill=MUTED)
draw.text((735, 620), "/ai", font=tiny_font, fill=MUTED)
draw.text((840, 727), "RAG", font=tiny_font, fill=MUTED)
draw.text((1085, 565), "LLM / embedding", font=tiny_font, fill=MUTED)
draw.text((1190, 805), "index", font=tiny_font, fill=MUTED)

icon_node(*positions["user"], BLUE, "User", "learner", "U")
icon_node(*positions["front"], BLUE, "Frontend", "React + Vite", "UI")
icon_node(*positions["api"], GREEN, "Backend", "NestJS API", "API")
icon_node(*positions["db"], GREEN, "Postgres", "app tables", "DB")
icon_node(*positions["ai"], VIOLET, "AI Server", "FastAPI", "AI")
icon_node(*positions["vector"], VIOLET, "pgvector", "RAG chunks", "V")
icon_node(*positions["openai"], AMBER, "OpenAI", "LLM + embeddings", "LLM")
icon_node(*positions["sources"], ROSE, "Sources", "blog, GitHub, exhibition", "WEB")

rounded_box((110, 945, 1690, 1030), "#f1f5f9", None, 0, 22)
draw.text((145, 970), "Key flow:", font=small_font, fill=INK)
draw.text(
    (255, 970),
    "Users write boards/comments -> NestJS saves to Postgres -> FastAPI indexes content -> AI answers with RAG + OpenAI.",
    font=small_font,
    fill=SLATE,
)

img.save(OUT)
print(OUT)
