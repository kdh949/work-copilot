from __future__ import annotations

from math import atan2, cos, pi, sin
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


OUT = Path(__file__).with_name("tech-stack-architecture.png")
W, H = 2400, 1500

INK = "#24313f"
MUTED = "#60717f"
LINE = "#7f93a3"
PANEL = "#e8f6fd"
PANEL_STROKE = "#9fc5d6"
NODE = "#ffffff"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


TITLE = font(34, True)
LABEL = font(24, True)
TEXT = font(21)
SMALL = font(18)


def rounded(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], fill: str, outline: str, width: int = 3, radius: int = 24) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def centered(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, fnt: ImageFont.ImageFont, fill: str = INK, gap: int = 8) -> None:
    lines = text.split("\n")
    heights = [draw.textbbox((0, 0), line, font=fnt)[3] for line in lines]
    total = sum(heights) + gap * (len(lines) - 1)
    y = xy[1] - total // 2
    for line, h in zip(lines, heights):
        bbox = draw.textbbox((0, 0), line, font=fnt)
        draw.text((xy[0] - (bbox[2] - bbox[0]) // 2, y), line, font=fnt, fill=fill)
        y += h + gap


def arrow(draw: ImageDraw.ImageDraw, start: tuple[int, int], end: tuple[int, int], label: str | None = None) -> None:
    draw.line([start, end], fill=LINE, width=4)
    angle = atan2(end[1] - start[1], end[0] - start[0])
    size = 18
    p1 = (end[0] - size * cos(angle - pi / 7), end[1] - size * sin(angle - pi / 7))
    p2 = (end[0] - size * cos(angle + pi / 7), end[1] - size * sin(angle + pi / 7))
    draw.polygon([end, p1, p2], fill=LINE)
    if label:
        mx, my = (start[0] + end[0]) // 2, (start[1] + end[1]) // 2
        bbox = draw.textbbox((0, 0), label, font=SMALL)
        pad = 8
        draw.rounded_rectangle(
            (mx - (bbox[2] - bbox[0]) // 2 - pad, my - 28, mx + (bbox[2] - bbox[0]) // 2 + pad, my),
            radius=10,
            fill="#ffffff",
        )
        draw.text((mx - (bbox[2] - bbox[0]) // 2, my - 25), label, font=SMALL, fill=MUTED)


def icon_users(draw: ImageDraw.ImageDraw, x: int, y: int) -> None:
    for dx, dy, r in [(0, 0, 20), (-28, 16, 17), (28, 16, 17)]:
        draw.ellipse((x + dx - r, y + dy - r, x + dx + r, y + dy + r), outline=INK, width=5)
    draw.arc((x - 58, y + 28, x + 58, y + 112), 195, 345, fill=INK, width=5)
    draw.arc((x - 92, y + 45, x - 20, y + 105), 205, 335, fill=INK, width=4)
    draw.arc((x + 20, y + 45, x + 92, y + 105), 205, 335, fill=INK, width=4)


def icon_browser(draw: ImageDraw.ImageDraw, x: int, y: int) -> None:
    rounded(draw, (x - 58, y - 46, x + 58, y + 46), "#f8fbfd", INK, 5, 16)
    draw.line((x - 58, y - 20, x + 58, y - 20), fill=INK, width=5)
    for i in range(3):
        draw.ellipse((x - 40 + i * 18, y - 36, x - 30 + i * 18, y - 26), fill=INK)
    draw.rectangle((x - 34, y + 2, x + 34, y + 11), fill="#20b8c7")
    draw.rectangle((x - 34, y + 22, x + 18, y + 31), fill="#20b8c7")


def icon_server(draw: ImageDraw.ImageDraw, x: int, y: int) -> None:
    for i in range(3):
        yy = y - 48 + i * 38
        rounded(draw, (x - 62, yy, x + 62, yy + 26), "#f8fbfd", INK, 4, 8)
        draw.ellipse((x - 45, yy + 8, x - 35, yy + 18), fill="#22c55e")
        draw.line((x - 20, yy + 13, x + 42, yy + 13), fill=INK, width=4)


def icon_ai(draw: ImageDraw.ImageDraw, x: int, y: int) -> None:
    rounded(draw, (x - 58, y - 58, x + 58, y + 58), "#f8fbfd", INK, 5, 20)
    draw.line((x, y - 38, x, y + 38), fill="#8b5cf6", width=6)
    draw.line((x - 38, y, x + 38, y), fill="#8b5cf6", width=6)
    draw.arc((x - 42, y - 42, x + 42, y + 42), 25, 155, fill=INK, width=4)
    draw.arc((x - 42, y - 42, x + 42, y + 42), 205, 335, fill=INK, width=4)


def icon_db(draw: ImageDraw.ImageDraw, x: int, y: int) -> None:
    draw.ellipse((x - 62, y - 54, x + 62, y - 14), outline=INK, width=5)
    draw.rectangle((x - 62, y - 34, x + 62, y + 58), outline=INK, width=5)
    draw.ellipse((x - 62, y + 38, x + 62, y + 78), outline=INK, width=5)
    draw.rectangle((x - 57, y - 31, x + 57, y + 56), fill="#f8fbfd")
    draw.arc((x - 62, y - 8, x + 62, y + 32), 0, 180, fill="#2563eb", width=4)
    draw.arc((x - 62, y + 18, x + 62, y + 58), 0, 180, fill="#2563eb", width=4)


def icon_cloud(draw: ImageDraw.ImageDraw, x: int, y: int) -> None:
    draw.arc((x - 70, y - 12, x - 24, y + 42), 90, 270, fill=INK, width=5)
    draw.arc((x - 42, y - 52, x + 28, y + 20), 180, 350, fill=INK, width=5)
    draw.arc((x + 6, y - 28, x + 74, y + 42), 220, 95, fill=INK, width=5)
    draw.line((x - 48, y + 42, x + 52, y + 42), fill=INK, width=5)
    draw.line((x - 12, y - 2, x - 12, y + 24), fill="#f97316", width=5)
    draw.line((x + 16, y - 2, x + 16, y + 24), fill="#f97316", width=5)


def icon_container(draw: ImageDraw.ImageDraw, x: int, y: int) -> None:
    draw.polygon([(x, y - 62), (x + 58, y - 28), (x, y + 6), (x - 58, y - 28)], outline=INK, fill="#f8fbfd")
    draw.polygon([(x - 58, y - 28), (x, y + 6), (x, y + 72), (x - 58, y + 36)], outline=INK, fill="#e0f2fe")
    draw.polygon([(x + 58, y - 28), (x, y + 6), (x, y + 72), (x + 58, y + 36)], outline=INK, fill="#dcfce7")


def panel(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], title: str) -> None:
    rounded(draw, box, PANEL, PANEL_STROKE, 3, 26)
    draw.text((box[0] + 26, box[1] + 22), title, font=LABEL, fill=MUTED)


def node(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], title: str, body: str, icon_fn) -> None:
    rounded(draw, box, NODE, "#b9c9d4", 3, 24)
    cx = (box[0] + box[2]) // 2
    h = box[3] - box[1]
    icon_fn(draw, cx, box[1] + int(h * 0.30))
    centered(draw, (cx, box[1] + int(h * 0.60)), title, LABEL)
    centered(draw, (cx, box[1] + int(h * 0.78)), body, TEXT, MUTED, 7)


def main() -> None:
    image = Image.new("RGB", (W, H), "#fbfdff")
    draw = ImageDraw.Draw(image)

    draw.text((80, 58), "JG Mentor Technology Stack Architecture", font=TITLE, fill=INK)

    panel(draw, (345, 230, 780, 770), "Frontend")
    panel(draw, (900, 230, 1335, 770), "Backend API")
    panel(draw, (1455, 230, 1890, 770), "AI Server")
    panel(draw, (1455, 930, 1890, 1375), "Data Layer")
    panel(draw, (2000, 230, 2325, 770), "External APIs")
    panel(draw, (900, 930, 1335, 1375), "Runtime")

    icon_users(draw, 170, 545)
    centered(draw, (170, 690), "Browser Users", LABEL)

    node(draw, (405, 330, 720, 705), "Client App", "React 19\nVite + TypeScript\nRouter + Nginx", icon_browser)
    node(draw, (960, 330, 1275, 705), "NestJS API", "JWT auth/config\nUsers / Boards\nComments / AI proxy", icon_server)
    node(draw, (1515, 330, 1830, 705), "FastAPI RAG", "LangChain agent\nIndexers + guardrails\nEmbeddings / vision", icon_ai)
    node(draw, (1515, 1000, 1830, 1335), "PostgreSQL", "PostgreSQL 16 + pgvector\napp tables + vector chunks", icon_db)
    node(draw, (2035, 330, 2290, 705), "External APIs", "OpenAI\nGitHub\nNaver / Blog Search", icon_cloud)
    node(draw, (960, 1000, 1275, 1335), "Docker Compose", "frontend / backend / ai-server\npgvector database", icon_container)

    arrow(draw, (250, 560), (405, 560), "SPA")
    arrow(draw, (720, 560), (960, 560), "REST API")
    arrow(draw, (1275, 560), (1515, 560), "/ai/* proxy")
    arrow(draw, (1118, 705), (1515, 1035), "CRUD via TypeORM")
    arrow(draw, (1672, 705), (1672, 1000), "asyncpg + vector search")
    arrow(draw, (1830, 560), (2035, 560), "completion / discovery")
    arrow(draw, (1120, 1000), (585, 705), "container")
    arrow(draw, (1120, 1000), (1118, 705), "container")
    arrow(draw, (1275, 1165), (1515, 1165), "pgvector DB")

    draw.text((80, 1425), "Simplified icon view: core runtime, request flow, AI/RAG flow, and data ownership.", font=SMALL, fill=MUTED)

    image.save(OUT)
    print(OUT)


if __name__ == "__main__":
    main()
