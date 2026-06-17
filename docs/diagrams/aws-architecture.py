from diagrams import Cluster, Diagram, Edge
from diagrams.aws.compute import ECR, ECS, Fargate
from diagrams.aws.database import RDSPostgresqlInstance
from diagrams.aws.integration import SQS
from diagrams.aws.management import Cloudwatch
from diagrams.aws.network import ALB, CloudFront, NATGateway, Route53
from diagrams.aws.security import SecretsManager
from diagrams.onprem.client import Users
from diagrams.onprem.network import Internet
from diagrams.saas.cdn import Cloudflare


graph_attr = {
    "splines": "ortho",
    "nodesep": "0.60",
    "ranksep": "0.75",
    "fontsize": "18",
}

with Diagram(
    "JG Mentor AWS Architecture",
    filename="docs/diagrams/aws-architecture",
    outformat="png",
    show=False,
    direction="LR",
    graph_attr=graph_attr,
):
    users = Users("Users")
    dns = Route53("Route 53")
    cdn = CloudFront("CloudFront")

    with Cluster("AWS VPC"):
        alb = ALB("Application Load Balancer")

        with Cluster("Public Subnets"):
            nat = NATGateway("NAT Gateway")

        with Cluster("Private App Subnets"):
            frontend = Fargate("Frontend\nReact + Nginx")
            backend = Fargate("Backend API\nNestJS")
            ai_server = Fargate("AI Server\nFastAPI")

        with Cluster("Private Data Subnets"):
            postgres = RDSPostgresqlInstance("RDS PostgreSQL\npgvector")

        secrets = SecretsManager("Secrets Manager\nJWT/API keys")
        logs = Cloudwatch("CloudWatch\nlogs/metrics")
        registry = ECR("ECR\ncontainer images")
        jobs = SQS("Optional async\nindexing queue")

    with Cluster("External Services"):
        openai = Cloudflare("OpenAI API")
        github = Internet("GitHub API")
        naver = Internet("Naver / Blog Search")

    users >> Edge(label="HTTPS") >> dns >> cdn >> alb
    alb >> Edge(label="/") >> frontend
    alb >> Edge(label="/api, /ai") >> backend
    backend >> Edge(label="HTTP AI requests") >> ai_server

    backend >> Edge(label="TypeORM") >> postgres
    ai_server >> Edge(label="asyncpg + vectors") >> postgres
    backend >> Edge(label="board/comment indexing") >> ai_server
    backend >> Edge(label="optional enqueue") >> jobs >> ai_server

    secrets >> backend
    secrets >> ai_server
    registry >> frontend
    registry >> backend
    registry >> ai_server

    frontend >> logs
    backend >> logs
    ai_server >> logs
    postgres >> logs

    ai_server >> Edge(label="LLM, embeddings, vision") >> nat >> openai
    ai_server >> Edge(label="repo analysis") >> github
    ai_server >> Edge(label="blog search/sync") >> naver
