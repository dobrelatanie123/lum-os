-- Migration: Create Lumos Schema
-- Description: Initial database schema for Lumos podcast fact-checking application
-- Created: 2025-01-17 12:53:59 UTC
-- 
-- This migration creates the core tables for the MVP:
-- - users: User accounts and authentication
-- - podcasts: Podcast metadata and information
-- - transcriptions: Audio transcriptions for podcasts
-- - alerts: Fact-checking alerts for users
-- - whitelist: Approved YouTube channels
-- - payments: Payment tracking for usage-based pricing
--
-- All tables include audit fields (created_at, updated_at) and appropriate RLS policies

-- Enable necessary extensions
create extension if not exists "uuid-ossp";

-- ============================================================================
-- USERS TABLE
-- ============================================================================
-- Stores user account information with role-based access control
create table public.users (
    id uuid primary key default uuid_generate_v4(),
    email varchar(255) not null unique,
    password varchar(255) not null,
    role varchar(50) not null check (role in ('user', 'admin')) default 'user',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Enable RLS for users table
alter table public.users enable row level security;

-- RLS Policies for users table
-- Users can select their own record, admins can select all
create policy "users_select_own" on public.users
    for select
    using (auth.uid()::text = id::text or (select role from public.users where id = auth.uid()) = 'admin');

-- Users can insert their own record during registration
create policy "users_insert_own" on public.users
    for insert
    with check (auth.uid()::text = id::text);

-- Users can update their own record, admins can update all
create policy "users_update_own" on public.users
    for update
    using (auth.uid()::text = id::text or (select role from public.users where id = auth.uid()) = 'admin');

-- Only admins can delete users
create policy "users_delete_admin_only" on public.users
    for delete
    using ((select role from public.users where id = auth.uid()) = 'admin');

-- ============================================================================
-- PODCASTS TABLE
-- ============================================================================
-- Stores metadata about YouTube podcasts that have been analyzed
create table public.podcasts (
    id uuid primary key default uuid_generate_v4(),
    title varchar(255) not null,
    url text not null,
    description text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Enable RLS for podcasts table
alter table public.podcasts enable row level security;

-- RLS Policies for podcasts table - read-only for all authenticated users
-- Authenticated users can select all podcasts
create policy "podcasts_select_authenticated" on public.podcasts
    for select
    using (auth.role() = 'authenticated');

-- Only admins can insert new podcasts
create policy "podcasts_insert_admin_only" on public.podcasts
    for insert
    with check ((select role from public.users where id = auth.uid()) = 'admin');

-- Only admins can update podcasts
create policy "podcasts_update_admin_only" on public.podcasts
    for update
    using ((select role from public.users where id = auth.uid()) = 'admin');

-- Only admins can delete podcasts
create policy "podcasts_delete_admin_only" on public.podcasts
    for delete
    using ((select role from public.users where id = auth.uid()) = 'admin');

-- ============================================================================
-- TRANSCRIPTIONS TABLE
-- ============================================================================
-- Stores audio transcriptions for podcasts (1:1 relationship with podcasts)
create table public.transcriptions (
    id uuid primary key default uuid_generate_v4(),
    podcast_id uuid not null unique,
    transcript text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint fk_transcriptions_podcast
        foreign key (podcast_id)
        references public.podcasts(id) 
        on delete cascade
);

-- Enable RLS for transcriptions table
alter table public.transcriptions enable row level security;

-- RLS Policies for transcriptions table - read-only for authenticated users
-- Authenticated users can select all transcriptions
create policy "transcriptions_select_authenticated" on public.transcriptions
    for select
    using (auth.role() = 'authenticated');

-- Only admins can insert new transcriptions
create policy "transcriptions_insert_admin_only" on public.transcriptions
    for insert
    with check ((select role from public.users where id = auth.uid()) = 'admin');

-- Only admins can update transcriptions
create policy "transcriptions_update_admin_only" on public.transcriptions
    for update
    using ((select role from public.users where id = auth.uid()) = 'admin');

-- Only admins can delete transcriptions
create policy "transcriptions_delete_admin_only" on public.transcriptions
    for delete
    using ((select role from public.users where id = auth.uid()) = 'admin');

-- ============================================================================
-- ALERTS TABLE
-- ============================================================================
-- Stores fact-checking alerts generated for users
create table public.alerts (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid not null,
    podcast_id uuid not null,
    alert_type varchar(50) not null,
    details text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint fk_alerts_user
        foreign key (user_id)
        references public.users(id) 
        on delete cascade,
    constraint fk_alerts_podcast
        foreign key (podcast_id)
        references public.podcasts(id) 
        on delete cascade
);

-- Enable RLS for alerts table
alter table public.alerts enable row level security;

-- RLS Policies for alerts table - users can only access their own alerts
-- Users can select their own alerts, admins can select all
create policy "alerts_select_own" on public.alerts
    for select
    using (auth.uid() = user_id or (select role from public.users where id = auth.uid()) = 'admin');

-- System can insert alerts for any user (admins only)
create policy "alerts_insert_admin_only" on public.alerts
    for insert
    with check ((select role from public.users where id = auth.uid()) = 'admin');

-- Users can update their own alerts, admins can update all
create policy "alerts_update_own" on public.alerts
    for update
    using (auth.uid() = user_id or (select role from public.users where id = auth.uid()) = 'admin');

-- Users can delete their own alerts, admins can delete all
create policy "alerts_delete_own" on public.alerts
    for delete
    using (auth.uid() = user_id or (select role from public.users where id = auth.uid()) = 'admin');

-- ============================================================================
-- WHITELIST TABLE
-- ============================================================================
-- Stores approved YouTube channels for podcast analysis
create table public.whitelist (
    id uuid primary key default uuid_generate_v4(),
    channel_identifier varchar(255) not null unique,
    config_description text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Enable RLS for whitelist table
alter table public.whitelist enable row level security;

-- RLS Policies for whitelist table - read-only for authenticated users
-- Authenticated users can select all whitelist entries
create policy "whitelist_select_authenticated" on public.whitelist
    for select
    using (auth.role() = 'authenticated');

-- Only admins can insert new whitelist entries
create policy "whitelist_insert_admin_only" on public.whitelist
    for insert
    with check ((select role from public.users where id = auth.uid()) = 'admin');

-- Only admins can update whitelist entries
create policy "whitelist_update_admin_only" on public.whitelist
    for update
    using ((select role from public.users where id = auth.uid()) = 'admin');

-- Only admins can delete whitelist entries
create policy "whitelist_delete_admin_only" on public.whitelist
    for delete
    using ((select role from public.users where id = auth.uid()) = 'admin');

-- ============================================================================
-- PAYMENTS TABLE
-- ============================================================================
-- Stores payment transactions for usage-based pricing
create table public.payments (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid not null,
    payment_status varchar(50) not null,
    amount numeric(10,2) not null,
    transaction_details text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint fk_payments_user
        foreign key (user_id)
        references public.users(id) 
        on delete cascade
);

-- Enable RLS for payments table
alter table public.payments enable row level security;

-- RLS Policies for payments table - users can only access their own payments
-- Users can select their own payments, admins can select all
create policy "payments_select_own" on public.payments
    for select
    using (auth.uid() = user_id or (select role from public.users where id = auth.uid()) = 'admin');

-- Only admins can insert new payment records (system-generated)
create policy "payments_insert_admin_only" on public.payments
    for insert
    with check ((select role from public.users where id = auth.uid()) = 'admin');

-- Only admins can update payment records
create policy "payments_update_admin_only" on public.payments
    for update
    using ((select role from public.users where id = auth.uid()) = 'admin');

-- Only admins can delete payment records
create policy "payments_delete_admin_only" on public.payments
    for delete
    using ((select role from public.users where id = auth.uid()) = 'admin');

-- ============================================================================
-- INDEXES
-- ============================================================================
-- Performance indexes for frequently queried columns

-- Indexes for alerts table (most frequently queried)
create index idx_alerts_user_id on public.alerts(user_id);
create index idx_alerts_podcast_id on public.alerts(podcast_id);
create index idx_alerts_created_at on public.alerts(created_at desc);

-- Indexes for payments table
create index idx_payments_user_id on public.payments(user_id);
create index idx_payments_created_at on public.payments(created_at desc);

-- Index for transcriptions table
create index idx_transcriptions_podcast_id on public.transcriptions(podcast_id);

-- ============================================================================
-- TRIGGERS FOR AUTOMATIC UPDATED_AT
-- ============================================================================
-- Function to automatically update the updated_at timestamp
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
security definer
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- Apply the trigger to all tables with updated_at columns
create trigger users_updated_at
    before update on public.users
    for each row
    execute function public.handle_updated_at();

create trigger podcasts_updated_at
    before update on public.podcasts
    for each row
    execute function public.handle_updated_at();

create trigger transcriptions_updated_at
    before update on public.transcriptions
    for each row
    execute function public.handle_updated_at();

create trigger alerts_updated_at
    before update on public.alerts
    for each row
    execute function public.handle_updated_at();

create trigger whitelist_updated_at
    before update on public.whitelist
    for each row
    execute function public.handle_updated_at();

create trigger payments_updated_at
    before update on public.payments
    for each row
    execute function public.handle_updated_at();
