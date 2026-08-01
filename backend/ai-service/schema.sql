CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS wiki_documents (
    id SERIAL PRIMARY KEY,
    source_id VARCHAR(100) UNIQUE NOT NULL,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    department VARCHAR(100) NOT NULL,
    tags TEXT,
    embedding vector(1536),
    created_at TIMESTAMP DEFAULT NOW()
);
