-- Add urls column to alerts table
-- This will store the actual study URLs found during fact-checking

-- Add the urls column as JSONB to store an array of URLs
ALTER TABLE public.alerts 
ADD COLUMN urls JSONB DEFAULT '[]'::jsonb;

-- Add a comment to explain the column
COMMENT ON COLUMN public.alerts.urls IS 'Array of actual study URLs found during fact-checking, stored as JSONB';

-- Create an index on the urls column for better query performance
CREATE INDEX idx_alerts_urls ON public.alerts USING GIN (urls);
