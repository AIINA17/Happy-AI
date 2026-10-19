-- Lets each user link an account per e-commerce source (see
-- backend/ecommerce_sources.py) instead of just one — needed now that the
-- shopping agent searches/compares across multiple dummy stores and needs
-- a separate cart/login per store. Run this once in the Supabase SQL Editor,
-- after 001_ecommerce_accounts.sql.

alter table public.ecommerce_accounts
    add column if not exists source text not null default 'tau';

-- Existing rows predate multi-source and were all against the original
-- store — the column default above already backfills them as 'tau'.

alter table public.ecommerce_accounts drop constraint if exists ecommerce_accounts_pkey;
alter table public.ecommerce_accounts add primary key (user_id, source);

-- Drop the default now that backfill is done — new rows must always say
-- which source they're for.
alter table public.ecommerce_accounts alter column source drop default;
