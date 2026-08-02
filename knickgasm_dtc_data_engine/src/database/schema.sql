-- PostgreSQL Schema Setup for Competitor Mailers Ingestion Pipeline

-- Enable UUID extension if not already present
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS competitor_mailers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor_sender VARCHAR(255) NOT NULL,
    email_subject TEXT NOT NULL,
    received_at TIMESTAMP WITH TIME ZONE NOT NULL,
    extracted_html_body TEXT NOT NULL,
    s3_snapshot_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Optimize search indexing for filtering by competitor sender
CREATE INDEX IF NOT EXISTS idx_competitor_sender ON competitor_mailers(competitor_sender);

-- Optimize analytics indexing on timestamp order
CREATE INDEX IF NOT EXISTS idx_received_at ON competitor_mailers(received_at DESC);
