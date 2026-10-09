-- Links each Supabase-authenticated user to their credentials on the dummy
-- e-commerce site, so the shopping agent can log in as *them* instead of a
-- single shared hardcoded account. Run this once in the Supabase SQL Editor.
--
-- The password is stored encrypted (Fernet, symmetric) — the backend is the
-- only thing that ever decrypts it, to re-submit to the e-commerce site's
-- own login endpoint. It's still a password-equivalent secret at rest, so
-- treat SUPABASE_SERVICE_ROLE_KEY and ECOMMERCE_CRED_ENCRYPTION_KEY
-- (backend/.env) with the same care as any other production secret.

create table if not exists public.ecommerce_accounts (
    user_id uuid primary key references auth.users(id) on delete cascade,
    username text not null,
    encrypted_password text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.ecommerce_accounts enable row level security;

-- The backend talks to this table via the service-role key, which bypasses
-- RLS entirely. This policy only matters if this table is ever queried
-- directly from the frontend with a user's own JWT instead.
create policy "Users can view their own ecommerce account link"
    on public.ecommerce_accounts for select
    using (auth.uid() = user_id);
