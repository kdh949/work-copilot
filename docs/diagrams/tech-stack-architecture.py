from diagrams import Cluster, Diagram, Edge
from diagrams.onprem.client import Users
from diagrams.onprem.container import Docker
from diagrams.onprem.database import PostgreSQL
from diagrams.onprem.network import Internet
from diagrams.programming.framework import FastAPI, React
from diagrams.programming.language import Nodejs
from diagrams.saas.cdn import Cloudflare


graph_attr = {
    "splines": "ortho",
    "nodesep": "1.10",
    "ranksep": "1.20",
    "fontsize": "28",
    "dpi": "180",
    "pad": "0.45",
}

node_attr = {
    "fontsize": "18",
    "fontname": "Arial",
}

edge_attr = {
    "fontsize": "16",
    "fontname": "Arial",
}

with Diagram(
    "JG Mentor Technology Stack Architecture",
    filename="docs/diagrams/tech-stack-architecture",
    outformat="png",
    show=False,
    direction="LR",
    graph_attr=graph_attr,
    node_attr=node_attr,
    edge_attr=edge_attr,
):
    users = Users("Browser Users")

    with Cluster("Frontend"):
        frontend = React("React 19\nVite + TypeScript\nRouter + Nginx")

    with Cluster("Backend API"):
        backend = Nodejs("NestJS 11 API\nJWT auth/config\nUsers / Boards / Comments")

    with Cluster("AI Server"):
        ai_server = FastAPI("FastAPI AI Server\nRAG + LangChain\nIndexers / Guardrails")

    with Cluster("Data Layer"):
        postgres = PostgreSQL("PostgreSQL 16 + pgvector\napp tables + vector chunks")

    with Cluster("External APIs"):
        openai = Cloudflare("OpenAI\nLLM/embeddings/vision")
        external_content = Internet("GitHub + Naver\nBlog Search")

    with Cluster("Local/Container Runtime"):
        containers = Docker("Docker Compose\nfrontend / backend / ai-server\npgvector DB")

    users >> Edge(label="SPA") >> frontend
    frontend >> Edge(label="REST API") >> backend
    backend >> Edge(label="/ai/* proxy") >> ai_server
    backend >> Edge(label="CRUD via TypeORM") >> postgres
    ai_server >> Edge(label="asyncpg + similarity search") >> postgres
    ai_server >> Edge(label="completion / embedding") >> openai
    ai_server >> Edge(label="repository + content discovery") >> external_content

    containers >> frontend
    containers >> backend
    containers >> ai_server
    containers >> postgres
