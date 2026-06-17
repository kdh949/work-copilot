from diagrams import Cluster, Diagram, Edge
from diagrams.generic.compute import Rack
from diagrams.generic.database import SQL
from diagrams.generic.network import Firewall
from diagrams.generic.storage import Storage
from diagrams.onprem.client import Users
from diagrams.onprem.compute import Server
from diagrams.onprem.container import Docker
from diagrams.onprem.network import Internet
from diagrams.programming.framework import FastAPI, React
from diagrams.programming.language import NodeJS, Python
from diagrams.saas.cdn import Cloudflare


graph_attr = {
    "splines": "ortho",
    "nodesep": "0.80",
    "ranksep": "0.90",
    "fontsize": "18",
    "pad": "0.35",
}

node_attr = {
    "fontsize": "14",
}

edge_attr = {
    "fontsize": "11",
}


with Diagram(
    "JG Mentor System Architecture",
    filename="docs/architecture-diagram",
    outformat="png",
    show=False,
    direction="LR",
    graph_attr=graph_attr,
    node_attr=node_attr,
    edge_attr=edge_attr,
):
    users = Users("Learners")
    browser = React("React + Vite\nFrontend")

    with Cluster("NestJS Backend"):
        api = NodeJS("REST API\nNestJS")
        auth = Firewall("JWT Auth\nValidation")
        board = Rack("Boards\nComments\nTags")
        ai_proxy = Server("AI Proxy\n/ai/*")

    with Cluster("FastAPI AI Server"):
        ai_api = FastAPI("AI API")
        agent = Python("Agent\nRAG Router")
        indexing = Python("Indexing\nBlogs, GitHub,\nBoards, Exhibitions")
        embeddings = Python("Embeddings\nOpenAI")

    with Cluster("PostgreSQL + pgvector"):
        app_db = SQL("App Tables\nusers, board,\ncomment, tag")
        vector_db = Storage("Vector Tables\nai_documents,\nai_chunks")

    external_web = Internet("External Sources\nBlogs, GitHub,\nExhibitions")
    openai = Cloudflare("OpenAI\nLLM + Embedding")
    docker = Docker("Local Docker\npgvector:pg16")

    users >> Edge(label="uses") >> browser
    browser >> Edge(label="HTTP REST") >> api
    api >> Edge(label="validates") >> auth
    auth >> Edge(label="CRUD") >> board
    board >> Edge(label="TypeORM") >> app_db

    board >> Edge(label="background index") >> ai_proxy
    browser >> Edge(label="mentor ask") >> ai_proxy
    ai_proxy >> Edge(label="POST /ask, /index-text") >> ai_api

    ai_api >> agent
    ai_api >> indexing
    agent >> Edge(label="semantic search") >> vector_db
    indexing >> Edge(label="chunks + metadata") >> vector_db
    indexing >> Edge(label="reads app content") >> app_db
    indexing >> Edge(label="crawls") >> external_web
    agent >> Edge(label="repo analysis") >> external_web
    agent >> Edge(label="answer generation") >> openai
    embeddings >> Edge(label="vectors") >> openai
    indexing >> embeddings

    docker >> app_db
    docker >> vector_db
