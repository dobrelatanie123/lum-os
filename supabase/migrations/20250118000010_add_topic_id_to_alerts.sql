-- Migration: add topic_id to alerts for grouping related claims
-- Purpose: Persist grouping key so multiple micro-claims can be clustered under a single topic
-- Notes:
-- - Adds a nullable text column topic_id with an index for fast filtering
-- - Keeps RLS unchanged; column is non-sensitive grouping metadata

alter table public.alerts
add column if not exists topic_id text;

-- Index for topic queries
create index if not exists alerts_topic_id_idx on public.alerts (topic_id);


