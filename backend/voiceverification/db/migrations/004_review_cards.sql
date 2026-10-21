-- Persists product review cards sent to the user during a conversation, so
-- they survive and are restorable from chat history — mirrors product_cards,
-- which already does this for product search results. Run this once in the
-- Supabase SQL Editor.

create table if not exists public.review_cards (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.conversation_sessions(id) on delete cascade,
    product_name text,
    reviews jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now()
);

alter table public.review_cards enable row level security;

-- The backend talks to this table via the service-role key, which bypasses
-- RLS entirely. This policy only matters if this table is ever queried
-- directly from the frontend with a user's own JWT instead.
create policy "Users can view review cards from their own sessions"
    on public.review_cards for select
    using (
        exists (
            select 1 from public.conversation_sessions cs
            where cs.id = review_cards.session_id
            and cs.user_id = auth.uid()
        )
    );
