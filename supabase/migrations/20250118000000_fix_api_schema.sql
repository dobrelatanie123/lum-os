-- Migration: Fix API Schema Compatibility
-- Description: Add missing fields for API implementation compatibility
-- Created: 2025-01-18 00:00:00 UTC

-- Add user_id to podcasts table to track who added each podcast
-- This allows users to manage their own podcast collections
ALTER TABLE public.podcasts 
ADD COLUMN user_id uuid REFERENCES public.users(id) ON DELETE CASCADE;

-- Add user_feedback to alerts table for rating functionality
ALTER TABLE public.alerts 
ADD COLUMN user_feedback text;

-- Update RLS policies for podcasts to allow user-specific access
DROP POLICY IF EXISTS "podcasts_select_authenticated" ON public.podcasts;
DROP POLICY IF EXISTS "podcasts_insert_admin_only" ON public.podcasts;
DROP POLICY IF EXISTS "podcasts_update_admin_only" ON public.podcasts;
DROP POLICY IF EXISTS "podcasts_delete_admin_only" ON public.podcasts;

-- New RLS policies for podcasts - users can manage their own podcasts
-- Users can select their own podcasts and admins can select all
CREATE POLICY "podcasts_select_own" ON public.podcasts
    FOR SELECT
    USING (auth.uid() = user_id OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');

-- Users can insert their own podcasts
CREATE POLICY "podcasts_insert_own" ON public.podcasts
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own podcasts, admins can update all
CREATE POLICY "podcasts_update_own" ON public.podcasts
    FOR UPDATE
    USING (auth.uid() = user_id OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');

-- Users can delete their own podcasts, admins can delete all
CREATE POLICY "podcasts_delete_own" ON public.podcasts
    FOR DELETE
    USING (auth.uid() = user_id OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');

-- Update RLS policies for transcriptions to follow podcast ownership
DROP POLICY IF EXISTS "transcriptions_select_authenticated" ON public.transcriptions;
DROP POLICY IF EXISTS "transcriptions_insert_admin_only" ON public.transcriptions;
DROP POLICY IF EXISTS "transcriptions_update_admin_only" ON public.transcriptions;
DROP POLICY IF EXISTS "transcriptions_delete_admin_only" ON public.transcriptions;

-- New RLS policies for transcriptions based on podcast ownership
-- Users can select transcriptions for their own podcasts
CREATE POLICY "transcriptions_select_own" ON public.transcriptions
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.podcasts 
            WHERE id = podcast_id 
            AND (user_id = auth.uid() OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
        )
    );

-- Users can insert transcriptions for their own podcasts
CREATE POLICY "transcriptions_insert_own" ON public.transcriptions
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.podcasts 
            WHERE id = podcast_id 
            AND user_id = auth.uid()
        )
    );

-- Users can update transcriptions for their own podcasts
CREATE POLICY "transcriptions_update_own" ON public.transcriptions
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.podcasts 
            WHERE id = podcast_id 
            AND (user_id = auth.uid() OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
        )
    );

-- Users can delete transcriptions for their own podcasts
CREATE POLICY "transcriptions_delete_own" ON public.transcriptions
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.podcasts 
            WHERE id = podcast_id 
            AND (user_id = auth.uid() OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
        )
    );

-- Add index for podcasts user_id for performance
CREATE INDEX idx_podcasts_user_id ON public.podcasts(user_id);
CREATE INDEX idx_podcasts_created_at ON public.podcasts(created_at DESC);

-- Update the trigger for podcasts updated_at (it should already exist but just in case)
DROP TRIGGER IF EXISTS podcasts_updated_at ON public.podcasts;
CREATE TRIGGER podcasts_updated_at
    BEFORE UPDATE ON public.podcasts
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
