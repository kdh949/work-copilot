# JungleBoard Technology Stack

![Simplified technology stack diagram](technology-stack-diagram-simplified.png)

```mermaid
flowchart LR
  user[Users] --> browser[Web Browser]

  subgraph frontend[Frontend]
    react[React 19]
    vite[Vite 8]
    router[React Router 7]
    tsfe[TypeScript 6]
    react --- vite
    react --- router
    react --- tsfe
  end

  subgraph backend[Backend API]
    node[Node.js]
    nest[NestJS 11]
    typeorm[TypeORM 0.3]
    jwt[JWT Auth]
    validation[class-validator]
    tsbe[TypeScript 5]
    node --- nest
    nest --- typeorm
    nest --- jwt
    nest --- validation
    nest --- tsbe
  end

  subgraph ai[AI Server]
    python[Python]
    fastapi[FastAPI]
    langchain[LangChain]
    openaisdk[OpenAI SDK]
    asyncpg[asyncpg]
    crawlers[httpx / bs4]
    python --- fastapi
    fastapi --- langchain
    fastapi --- openaisdk
    fastapi --- asyncpg
    fastapi --- crawlers
  end

  subgraph external[External Knowledge / AI]
    openaiapi[OpenAI API]
    web[Blogs / GitHub / Web]
  end

  subgraph data[Data Layer]
    postgres[(PostgreSQL 16)]
    pgvector[pgvector]
    init[init.sql]
    postgres --- pgvector
    postgres --- init
  end

  subgraph tooling[Local Tooling]
    docker[Docker Compose]
    jest[Jest 30]
    eslint[ESLint]
    prettier[Prettier]
  end

  browser -->|SPA| react
  react -->|HTTP API| nest
  nest -->|SQL / ORM| postgres
  nest -->|AI requests| fastapi
  fastapi -->|vector SQL| postgres
  fastapi -->|embeddings / chat| openaiapi
  fastapi -->|indexing| web
  docker -->|runs| postgres
  nest -->|tested by| jest
  react -->|lint / build| eslint
  nest -->|format| prettier
```

## Source Files

- `docs/technology-stack-diagram.py`: diagrams/mingrammer source of truth.
- `docs/technology-stack-diagram.md`: Mermaid preview for GitHub and documentation.

## Render

After Graphviz is available on the machine, render the PNG with:

```bash
.venv-diagrams/bin/python docs/technology-stack-diagram.py
```
