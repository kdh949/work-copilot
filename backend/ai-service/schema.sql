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

CREATE TABLE IF NOT EXISTS wiki_document_chunks (
    id SERIAL PRIMARY KEY,
    source_id VARCHAR(100) NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536),
    UNIQUE (source_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS ai_request_events (
    id SERIAL PRIMARY KEY,
    request_id VARCHAR(64) NOT NULL,
    route VARCHAR(64) NOT NULL,
    outcome VARCHAR(32) NOT NULL,
    retrieval_mode VARCHAR(32) NOT NULL,
    result_count INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_cost NUMERIC(12, 8) NOT NULL DEFAULT 0,
    error_code VARCHAR(64),
    created_at TIMESTAMP DEFAULT NOW()
);
