from diagrams import Cluster, Diagram, Edge
from diagrams.generic.blank import Blank
from diagrams.onprem.client import Users
from diagrams.onprem.compute import Server
from diagrams.onprem.database import PostgreSQL
from diagrams.onprem.network import Internet


with Diagram(
    "JungleBoard Technology Stack",
    filename="docs/technology-stack-diagram",
    outformat="png",
    show=False,
    direction="LR",
    graph_attr={
        "splines": "ortho",
        "nodesep": "0.60",
        "ranksep": "0.75",
        "fontsize": "20",
    },
):
    users = Users("Users")
    browser = Internet("Web Browser")

    with Cluster("Frontend"):
        react = Server("React 19")
        vite = Blank("Vite 8")
        router = Blank("React Router 7")
        typescript_fe = Blank("TypeScript 6")
        react - vite
        react - router
        react - typescript_fe

    with Cluster("Backend API"):
        nest = Server("NestJS 11")
        node = Blank("Node.js")
        typeorm = Blank("TypeORM 0.3")
        jwt = Blank("JWT Auth")
        validation = Blank("class-validator")
        typescript_be = Blank("TypeScript 5")
        node - nest
        nest - typeorm
        nest - jwt
        nest - validation
        nest - typescript_be

    with Cluster("AI Server"):
        python = Blank("Python")
        fastapi = Server("FastAPI")
        langchain = Blank("LangChain")
        openai_sdk = Blank("OpenAI SDK")
        asyncpg = Blank("asyncpg")
        crawlers = Blank("httpx / bs4")
        python - fastapi
        fastapi - langchain
        fastapi - openai_sdk
        fastapi - asyncpg
        fastapi - crawlers

    with Cluster("External Knowledge / AI"):
        openai_api = Internet("OpenAI API")
        web_sources = Internet("Blogs / GitHub / Web")

    with Cluster("Data Layer"):
        postgres = PostgreSQL("PostgreSQL 16")
        pgvector = Blank("pgvector")
        init_sql = Blank("init.sql")
        postgres - pgvector
        postgres - init_sql

    with Cluster("Local Tooling"):
        docker = Blank("Docker Compose")
        jest = Blank("Jest 30")
        eslint = Blank("ESLint")
        prettier = Blank("Prettier")

    users >> browser
    browser >> Edge(label="SPA") >> react
    react >> Edge(label="HTTP API") >> nest
    nest >> Edge(label="SQL / ORM") >> postgres
    nest >> Edge(label="AI requests") >> fastapi
    fastapi >> Edge(label="vector SQL") >> postgres
    fastapi >> Edge(label="embeddings / chat") >> openai_api
    fastapi >> Edge(label="indexing") >> web_sources
    docker >> Edge(label="runs") >> postgres
    nest >> Edge(label="tested by") >> jest
    react >> Edge(label="lint/build") >> eslint
    nest >> Edge(label="format") >> prettier
