from __future__ import annotations

import base64
from html import escape
from pathlib import Path

import diagrams


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "docs" / "diagrams"
RESOURCE_ROOT = Path(diagrams.__file__).resolve().parents[1] / "resources"


def icon_data(path: str) -> str:
    data = (RESOURCE_ROOT / path).read_bytes()
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")


ICONS = {
    "users": "onprem/client/users.png",
    "github": "onprem/vcs/github.png",
    "actions": "onprem/ci/github-actions.png",
    "docker": "onprem/container/docker.png",
    "nginx": "onprem/network/nginx.png",
    "react": "programming/framework/react.png",
    "typescript": "programming/language/typescript.png",
    "node": "programming/language/nodejs.png",
    "python": "programming/language/python.png",
    "fastapi": "programming/framework/fastapi.png",
    "postgres": "onprem/database/postgresql.png",
    "internet": "onprem/network/internet.png",
    "route53": "aws/network/route-53.png",
    "alb": "aws/network/elb-application-load-balancer.png",
    "vpc": "aws/network/vpc.png",
    "ecs": "aws/compute/elastic-container-service.png",
    "fargate": "aws/compute/fargate.png",
    "ecr": "aws/compute/ec2-container-registry-registry.png",
    "ecr_image": "aws/compute/ec2-container-registry-image.png",
    "rds": "aws/database/rds-postgresql-instance.png",
    "s3": "aws/storage/simple-storage-service-s3.png",
    "secrets": "aws/security/secrets-manager.png",
    "cloudwatch": "aws/management/cloudwatch.png",
}


def svg_start(width: int, height: int, title: str) -> list[str]:
    return [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        "<defs>",
        '<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">',
        '<path d="M 0 0 L 10 5 L 0 10 z" fill="#263238"/>',
        "</marker>",
        '<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">',
        '<feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#90a4ae" flood-opacity="0.35"/>',
        "</filter>",
        "</defs>",
        '<rect width="100%" height="100%" fill="#fbfdff"/>',
        f'<text x="36" y="46" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="700" fill="#1f2937">{escape(title)}</text>',
    ]


def box(parts: list[str], x: int, y: int, w: int, h: int, label: str, stroke: str = "#f97316", dashed: bool = False) -> None:
    dash = ' stroke-dasharray="8 7"' if dashed else ""
    parts.append(
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="18" fill="#ffffff" stroke="{stroke}" stroke-width="2"{dash}/>'
    )
    parts.append(
        f'<text x="{x + 18}" y="{y + 30}" font-family="Inter, Arial, sans-serif" font-size="15" font-weight="700" fill="{stroke}">{escape(label)}</text>'
    )


def node(parts: list[str], x: int, y: int, label: str, icon: str, w: int = 118, h: int = 112, fill: str = "#ffffff") -> None:
    parts.append(
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{fill}" stroke="#cbd5e1" stroke-width="1.5" filter="url(#shadow)"/>'
    )
    parts.append(f'<image href="{icon_data(ICONS[icon])}" x="{x + w / 2 - 26}" y="{y + 16}" width="52" height="52"/>')
    for i, line in enumerate(label.split("\n")):
        parts.append(
            f'<text x="{x + w / 2}" y="{y + 86 + i * 16}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="13" fill="#263238">{escape(line)}</text>'
        )


def label(parts: list[str], x: int, y: int, text: str, size: int = 13, weight: str = "600", fill: str = "#374151") -> None:
    parts.append(
        f'<text x="{x}" y="{y}" font-family="Inter, Arial, sans-serif" font-size="{size}" font-weight="{weight}" fill="{fill}">{escape(text)}</text>'
    )


def line(parts: list[str], x1: int, y1: int, x2: int, y2: int, text: str | None = None) -> None:
    parts.append(
        f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#263238" stroke-width="2" marker-end="url(#arrow)"/>'
    )
    if text:
        label(parts, (x1 + x2) // 2 - 28, (y1 + y2) // 2 - 8, text, 12)


def aws_architecture() -> str:
    parts = svg_start(1480, 900, "JG Mentor AWS Architecture")
    box(parts, 40, 92, 1390, 760, "AWS ap-northeast-2", "#f97316")
    box(parts, 238, 148, 1090, 620, "VPC / ECS Service", "#94a3b8")
    box(parts, 302, 252, 606, 405, "ECS Fargate Task: jg-jaehwan-service", "#22c55e", True)
    box(parts, 28, 575, 194, 220, "CI/CD", "#64748b")

    node(parts, 62, 210, "Users", "users")
    node(parts, 62, 382, "Route 53", "route53")
    node(parts, 250, 382, "Application\nLoad Balancer", "alb")
    node(parts, 360, 330, "Frontend\nNginx + React", "nginx")
    node(parts, 560, 330, "Backend API\nNestJS", "node")
    node(parts, 760, 330, "AI Server\nFastAPI", "fastapi")
    node(parts, 1022, 236, "RDS\nPostgreSQL", "rds")
    node(parts, 1022, 398, "Secrets\nManager", "secrets")
    node(parts, 1022, 560, "CloudWatch\nLogs", "cloudwatch")
    node(parts, 1210, 236, "S3\nKnowledge Assets", "s3")

    node(parts, 60, 632, "GitHub", "github", 74, 86)
    node(parts, 162, 632, "Actions", "actions", 74, 86)
    node(parts, 264, 632, "Docker\nBuild", "docker", 88, 88)
    node(parts, 396, 632, "ECR\nRepositories", "ecr", 104, 88)

    node(parts, 602, 134, "Frontend\nImage", "ecr_image", 104, 86)
    node(parts, 734, 134, "Backend\nImage", "ecr_image", 104, 86)
    node(parts, 866, 134, "AI Server\nImage", "ecr_image", 104, 86)

    line(parts, 121, 322, 121, 382, "DNS")
    line(parts, 180, 438, 250, 438)
    line(parts, 368, 438, 360, 390)
    line(parts, 478, 386, 560, 386, "API")
    line(parts, 678, 386, 760, 386, "AI/RAG")
    line(parts, 678, 354, 1022, 292, "SQL")
    line(parts, 678, 430, 1022, 454, "secrets")
    line(parts, 678, 474, 1022, 616, "logs")
    line(parts, 878, 388, 1210, 292, "crawl/sync")
    line(parts, 60 + 74, 675, 162, 675, "push")
    line(parts, 236, 675, 264, 675)
    line(parts, 352, 675, 396, 675)
    line(parts, 500, 675, 500, 220, "push latest")
    line(parts, 654, 220, 418, 330)
    line(parts, 786, 220, 618, 330)
    line(parts, 918, 220, 818, 330)
    label(parts, 364, 610, "Images are built from jaehwan branch and deployed by GitHub Actions.", 13, "500")
    return "\n".join(parts + ["</svg>"])


def tech_stack() -> str:
    parts = svg_start(1280, 820, "JG Mentor Technology Stack")
    box(parts, 38, 90, 1186, 650, "Application Stack", "#f97316")
    box(parts, 78, 150, 278, 480, "Frontend", "#38bdf8")
    box(parts, 392, 150, 278, 480, "Backend", "#22c55e")
    box(parts, 706, 150, 278, 480, "AI / RAG Server", "#a855f7")
    box(parts, 1020, 150, 160, 480, "Platform", "#64748b")

    node(parts, 116, 210, "React", "react")
    node(parts, 218, 210, "TypeScript", "typescript")
    node(parts, 116, 370, "Vite", "typescript")
    node(parts, 218, 370, "Nginx", "nginx")

    node(parts, 430, 210, "NestJS\nNode.js", "node")
    node(parts, 532, 210, "TypeORM\nJWT", "node")
    node(parts, 430, 370, "PostgreSQL", "postgres")
    node(parts, 532, 370, "REST API", "internet")

    node(parts, 744, 210, "Python", "python")
    node(parts, 846, 210, "FastAPI", "fastapi")
    node(parts, 744, 370, "LangChain\nOpenAI", "python")
    node(parts, 846, 370, "Blog/GitHub\nCrawlers", "github")

    node(parts, 1040, 205, "Docker", "docker", 112, 96)
    node(parts, 1040, 330, "GitHub\nActions", "actions", 112, 96)
    node(parts, 1040, 455, "AWS ECS\nFargate", "fargate", 112, 96)

    line(parts, 356, 390, 392, 390, "API")
    line(parts, 670, 390, 706, 390, "AI")
    line(parts, 984, 278, 1040, 253)
    line(parts, 984, 430, 1040, 503)
    label(parts, 94, 680, "Client UI: board, comments, AI Q&A, knowledge resources", 13, "500")
    label(parts, 400, 680, "Auth, board/comment APIs, TypeORM entities, RDS access", 13, "500")
    label(parts, 704, 680, "RAG answer generation, blog sync, OpenAI embeddings", 13, "500")
    label(parts, 1018, 680, "CI/CD images to ECR, service on ECS Fargate", 13, "500")
    return "\n".join(parts + ["</svg>"])


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "jg-mentor-aws-architecture.svg").write_text(aws_architecture(), encoding="utf-8")
    (OUT_DIR / "jg-mentor-tech-stack.svg").write_text(tech_stack(), encoding="utf-8")
    print(OUT_DIR / "jg-mentor-aws-architecture.svg")
    print(OUT_DIR / "jg-mentor-tech-stack.svg")


if __name__ == "__main__":
    main()
