-- Claims Table for Phase 1: Full Mode Extraction
-- Stores synthesized claims extracted from podcast transcripts

CREATE TABLE IF NOT EXISTS claims (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id TEXT UNIQUE NOT NULL,          -- Format: videoId_claim_N
  video_id TEXT NOT NULL,                  -- Reference to podcast
  
  -- Segment data
  segment_text TEXT NOT NULL,
  segment_word_count INTEGER NOT NULL,
  
  -- Extraction data
  author_mentioned TEXT,
  author_normalized TEXT,
  author_variants TEXT[],                  -- Array of variant spellings
  institution_mentioned TEXT,
  finding_summary TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  
  -- Search queries
  primary_query TEXT NOT NULL,
  fallback_queries TEXT[],
  
  -- Verification status (Phase 3)
  verification_status TEXT DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'refuted', 'inconclusive')),
  verification_result JSONB,               -- Full verification response
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Index for lookups
  CONSTRAINT fk_video FOREIGN KEY (video_id) REFERENCES podcasts(id) ON DELETE CASCADE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_claims_video_id ON claims(video_id);
CREATE INDEX IF NOT EXISTS idx_claims_author ON claims(author_normalized);
CREATE INDEX IF NOT EXISTS idx_claims_confidence ON claims(confidence);
CREATE INDEX IF NOT EXISTS idx_claims_verification ON claims(verification_status);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_claims_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER claims_updated_at
  BEFORE UPDATE ON claims
  FOR EACH ROW
  EXECUTE FUNCTION update_claims_updated_at();

-- Disable RLS for development (like other tables)
ALTER TABLE claims DISABLE ROW LEVEL SECURITY;

