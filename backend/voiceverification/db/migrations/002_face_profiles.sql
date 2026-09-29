-- Face recognition enrollment + verification-attempt logs, backing
-- face_recognition/main.py via voiceverification/db/face_repo.py and
-- face_verification_logs.py. Previously stored in local JSON files
-- (face_recognition/data/face_embeddings.json /
-- face_verification_logs.json) — moved here so it survives container
-- restarts/redeploys and isn't tied to a single machine's disk, same as
-- voice's speaker_profiles. Run this once in the Supabase SQL Editor.
--
-- Only one face enrollment per user is supported right now (user_id is the
-- primary key — enroll-face overwrites any existing row), unlike
-- speaker_profiles, which allows up to 3 labeled voice enrollments per
-- user. See backend/README.md for why face doesn't have a label column.

create table if not exists public.face_profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    embedding jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.face_profiles enable row level security;

-- The backend talks to this table via the service-role key, which bypasses
-- RLS entirely. This policy only matters if this table is ever queried
-- directly from the frontend with a user's own JWT instead.
create policy "Users can view their own face profile"
    on public.face_profiles for select
    using (auth.uid() = user_id);

-- Global log of every verify-face attempt (not scoped per user in the
-- API — GET/DELETE /face/verification-logs return/clear all rows, matching
-- the local-JSON-file behavior this replaces). No RLS policy is added since
-- these endpoints are meant for operator/debugging access via the
-- service-role key, not end users.
create table if not exists public.face_verification_logs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    image_filename text,
    verified boolean not null,
    status text not null,
    similarity double precision,
    threshold double precision,
    error_message text,
    created_at timestamptz not null default now()
);

alter table public.face_verification_logs enable row level security;
