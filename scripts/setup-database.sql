-- Lumos Database Setup (All Tables)
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- USERS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'user',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- PODCASTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.podcasts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    description TEXT,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- TRANSCRIPTIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.transcriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    podcast_id UUID NOT NULL UNIQUE REFERENCES public.podcasts(id) ON DELETE CASCADE,
    transcript TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- ALERTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    podcast_id UUID REFERENCES public.podcasts(id) ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL,
    details TEXT,
    user_feedback TEXT,
    urls TEXT,
    topic_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- WHITELIST TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.whitelist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_identifier VARCHAR(255) NOT NULL UNIQUE,
    config_description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- PAYMENTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    payment_status VARCHAR(50) NOT NULL,
    amount NUMERIC(10,2) NOT NULL,
    transaction_details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- CLAIMS TABLE (New - Gemini extraction)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id TEXT UNIQUE NOT NULL,
    video_id TEXT NOT NULL,
    timestamp TEXT,
    segment_text TEXT,
    author_mentioned TEXT,
    author_normalized TEXT,
    institution_mentioned TEXT,
    finding_summary TEXT,
    confidence TEXT,
    primary_query TEXT,
    verification_status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON public.alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_podcast_id ON public.alerts(podcast_id);
CREATE INDEX IF NOT EXISTS idx_podcasts_user_id ON public.podcasts(user_id);
CREATE INDEX IF NOT EXISTS idx_transcriptions_podcast_id ON public.transcriptions(podcast_id);
CREATE INDEX IF NOT EXISTS idx_claims_video_id ON public.claims(video_id);

-- ============================================================================
-- DISABLE RLS FOR DEVELOPMENT
-- ============================================================================
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.podcasts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcriptions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.whitelist DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.claims DISABLE ROW LEVEL SECURITY;

-- Done!
SELECT 'All tables created successfully!' as status;

