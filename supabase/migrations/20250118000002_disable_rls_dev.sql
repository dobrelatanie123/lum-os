-- Migration: Disable RLS for Development
-- Description: Temporarily disable RLS to fix infinite recursion issues

-- Disable RLS on all tables for development
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.podcasts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcriptions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.whitelist DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments DISABLE ROW LEVEL SECURITY;

-- Drop all existing policies
DROP POLICY IF EXISTS "users_select_own" ON public.users;
DROP POLICY IF EXISTS "users_insert_own" ON public.users;
DROP POLICY IF EXISTS "users_update_own" ON public.users;
DROP POLICY IF EXISTS "users_delete_admin_only" ON public.users;

DROP POLICY IF EXISTS "podcasts_select_own" ON public.podcasts;
DROP POLICY IF EXISTS "podcasts_insert_own" ON public.podcasts;
DROP POLICY IF EXISTS "podcasts_update_own" ON public.podcasts;
DROP POLICY IF EXISTS "podcasts_delete_own" ON public.podcasts;

DROP POLICY IF EXISTS "transcriptions_select_own" ON public.transcriptions;
DROP POLICY IF EXISTS "transcriptions_insert_own" ON public.transcriptions;
DROP POLICY IF EXISTS "transcriptions_update_own" ON public.transcriptions;
DROP POLICY IF EXISTS "transcriptions_delete_own" ON public.transcriptions;

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
