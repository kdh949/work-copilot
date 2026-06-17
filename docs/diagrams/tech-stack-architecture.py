from diagrams import Cluster, Diagram, Edge
from diagrams.onprem.client import Users
from diagrams.onprem.container import Docker
from diagrams.onprem.database import PostgreSQL
from diagrams.onprem.network import Internet, Nginx
from diagrams.programming.framework import FastAPI, React
from diagrams.programming.language import Nodejs, Python, TypeScript
from diagrams.saas.cdn import Cloudflare


graph_attr = {
    "splines": "ortho",
    "nodesep": "0.60",
    "ranksep": "0.80",
    "fontsize": "18",
}

with Diagram(
    "JG Mentor Technology Stack Architecture",
    filename="docs/diagrams/tech-stack-architecture",
    outformat="png",
    show=False,
    direction="LR",
    graph_attr=graph_attr,
):
    users = Users("Browser Users")

    with Cluster("Frontend"):
        react = React("React 19")
        vite = TypeScript("Vite + TypeScript")
        router = React("React Router")
        nginx = Nginx("Nginx\nproduction")

    with Cluster("Backend API"):
        nest = Nodejs("NestJS 11")
        modules = TypeScript("Users / Boards\nComments / AI")
        orm = TypeScript("TypeORM")
        jwt = TypeScript("JWT auth/config")

    with Cluster("AI Server"):
        fastapi = FastAPI("FastAPI")
        langchain = Python("LangChain")
        rag = Python("RAG agent\nsearch + guardrails")
        indexers = Python("Indexers\nblogs, boards, exhibits")

    with Cluster("Data Layer"):
        postgres = PostgreSQL("PostgreSQL 16\npgvector")
        vector_tables = PostgreSQL("ai_documents\nai_document_chunks")
        app_tables = PostgreSQL("users, boards\ncomments, tags")

    with Cluster("External APIs"):
        openai = Cloudflare("OpenAI\nLLM/embeddings/vision")
        github = Internet("GitHub")
        blog_search = Internet("Naver / Blog Search")

    with Cluster("Local/Container Runtime"):
        frontend_image = Docker("frontend Dockerfile")
        backend_image = Docker("backend Dockerfile")
        ai_image = Docker("ai-server Dockerfile")
        compose = Docker("docker-compose\npgvector DB")

    users >> Edge(label="SPA") >> react >> vite >> router >> nginx
    nginx >> Edge(label="REST API") >> nest

    nest >> modules
    modules >> Edge(label="CRUD") >> orm >> app_tables
    modules >> Edge(label="/ai/* proxy") >> fastapi
    jwt >> nest

    fastapi >> rag
    rag >> langchain
    rag >> Edge(label="similarity search") >> vector_tables
    indexers >> Edge(label="chunk + upsert") >> vector_tables
    fastapi >> Edge(label="asyncpg") >> postgres
    postgres >> app_tables
    postgres >> vector_tables

    rag >> Edge(label="completion/embedding") >> openai
    indexers >> Edge(label="repository analysis") >> github
    indexers >> Edge(label="content discovery") >> blog_search

    frontend_image >> nginx
    backend_image >> nest
    ai_image >> fastapi
    compose >> postgres
