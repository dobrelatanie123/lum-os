-- Migration: Fix ID Types for YouTube Support
-- Description: Change UUID columns to text to support YouTube video IDs

-- Disable RLS to avoid issues
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.podcasts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcriptions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.whitelist DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments DISABLE ROW LEVEL SECURITY;

-- Drop all policies
DROP POLICY IF EXISTS "users_select_own" ON public.users;
DROP POLICY IF EXISTS "users_insert_own" ON public.users;
DROP POLICY IF EXISTS "users_update_own" ON public.users;
DROP POLICY IF EXISTS "users_delete_admin_only" ON public.users;
DROP POLICY IF EXISTS "podcasts_select_authenticated" ON public.podcasts;
DROP POLICY IF EXISTS "podcasts_insert_admin_only" ON public.podcasts;
DROP POLICY IF EXISTS "podcasts_update_admin_only" ON public.podcasts;
DROP POLICY IF EXISTS "podcasts_delete_admin_only" ON public.podcasts;
DROP POLICY IF EXISTS "transcriptions_select_authenticated" ON public.transcriptions;
DROP POLICY IF EXISTS "transcriptions_insert_admin_only" ON public.transcriptions;
DROP POLICY IF EXISTS "transcriptions_update_admin_only" ON public.transcriptions;
DROP POLICY IF EXISTS "transcriptions_delete_admin_only" ON public.transcriptions;
DROP POLICY IF EXISTS "alerts_select_own" ON public.alerts;
DROP POLICY IF EXISTS "alerts_insert_admin_only" ON public.alerts;
DROP POLICY IF EXISTS "alerts_update_own" ON public.alerts;
DROP POLICY IF EXISTS "alerts_delete_own" ON public.alerts;
DROP POLICY IF EXISTS "whitelist_select_authenticated" ON public.whitelist;
DROP POLICY IF EXISTS "whitelist_insert_admin_only" ON public.whitelist;
DROP POLICY IF EXISTS "whitelist_update_admin_only" ON public.whitelist;
DROP POLICY IF EXISTS "whitelist_delete_admin_only" ON public.whitelist;
DROP POLICY IF EXISTS "payments_select_own" ON public.payments;
DROP POLICY IF EXISTS "payments_insert_admin_only" ON public.payments;
DROP POLICY IF EXISTS "payments_update_admin_only" ON public.payments;
DROP POLICY IF EXISTS "payments_delete_admin_only" ON public.payments;

-- Drop foreign key constraints first
ALTER TABLE public.transcriptions DROP CONSTRAINT IF EXISTS fk_transcriptions_podcast;
ALTER TABLE public.alerts DROP CONSTRAINT IF EXISTS fk_alerts_podcast;
ALTER TABLE public.alerts DROP CONSTRAINT IF EXISTS fk_alerts_user;
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS fk_payments_user;
ALTER TABLE public.podcasts DROP CONSTRAINT IF EXISTS podcasts_user_id_fkey;

-- Change column types to text
ALTER TABLE public.users ALTER COLUMN id TYPE text;
ALTER TABLE public.podcasts ALTER COLUMN id TYPE text;
ALTER TABLE public.podcasts ALTER COLUMN user_id TYPE text;
ALTER TABLE public.transcriptions ALTER COLUMN podcast_id TYPE text;
ALTER TABLE public.alerts ALTER COLUMN podcast_id TYPE text;
ALTER TABLE public.alerts ALTER COLUMN user_id TYPE text;
ALTER TABLE public.payments ALTER COLUMN user_id TYPE text;

-- Recreate foreign key constraints
ALTER TABLE public.transcriptions 
ADD CONSTRAINT fk_transcriptions_podcast 
FOREIGN KEY (podcast_id) REFERENCES public.podcasts(id) ON DELETE CASCADE;

ALTER TABLE public.alerts 
ADD CONSTRAINT fk_alerts_podcast 
FOREIGN KEY (podcast_id) REFERENCES public.podcasts(id) ON DELETE CASCADE;

ALTER TABLE public.alerts 
ADD CONSTRAINT fk_alerts_user 
FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.payments 
ADD CONSTRAINT fk_payments_user 
FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.podcasts 
ADD CONSTRAINT podcasts_user_id_fkey 
FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- Insert test data
INSERT INTO public.users (id, email, password, role) 
VALUES ('demo-user-123', 'demo@example.com', 'demo-password', 'user')
ON CONFLICT (email) DO NOTHING;

-- Insert a test podcast with YouTube ID
INSERT INTO public.podcasts (id, title, url, description, user_id)
VALUES ('yt-xXVB8A5xvSw', 'Test YouTube Video', 'https://www.youtube.com/watch?v=xXVB8A5xvSw', 'Test video for fact-checking', 'demo-user-123')
ON CONFLICT (id) DO NOTHING;
