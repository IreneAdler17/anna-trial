-- Anna v1 trial schema. Run once in the Supabase SQL editor (same project as the pipeline).
-- Every table is locked down (RLS on, no policies): only the Netlify functions, using the
-- service key, can read or write. The phone app never talks to Supabase directly.

create table if not exists anna_users (
  id            text primary key,                 -- the name in her link, e.g. 'sophie'
  key           text not null,                    -- secret in her link (?k=…) and her Shortcut
  display_name  text,
  drop_time     text not null default '20:30',    -- local HH:MM
  tz            text not null default 'Australia/Sydney',
  stage         text not null default 'new',      -- new | onboarding | ready
  most_you      jsonb not null default '[]',      -- item ids she picked as "most you"
  shortcut_ok   boolean not null default false,   -- first double-tap has arrived
  created_at    timestamptz not null default now(),
  onboarded_at  timestamptz
);

-- Every piece Anna has ever shown or received, copied here so references stay stable
-- even when the pipeline row changes or a source page disappears.
create table if not exists anna_items (
  id          text primary key,                   -- 'pipe:<row id>' | 'src:<domain>:<id>' | 'cap:<uuid>:<n>'
  kind        text not null,                      -- pipeline | fresh | capture
  source      text,                               -- retailer domain or source name
  image_url   text,
  brand       text,
  name        text,
  price       numeric,
  currency    text default 'AUD',
  url         text,
  first_seen  timestamptz,
  attrs       jsonb not null default '{}',        -- colour, material, piece type, era, etc.
  description text,                               -- short text Claude reads when picking edits
  created_at  timestamptz not null default now()
);

create table if not exists anna_events (
  id         bigserial primary key,
  user_id    text not null references anna_users(id) on delete cascade,
  item_id    text references anna_items(id) on delete set null,
  action     text not null,                       -- love | pass | open | shop | most_you | capture
  context    text,                                -- calibration | edit | detail | capture
  edit_id    uuid,
  ms         integer,                             -- time on card before deciding
  created_at timestamptz not null default now()
);
create index if not exists anna_events_user_idx on anna_events(user_id, created_at desc);

create table if not exists anna_captures (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null references anna_users(id) on delete cascade,
  via         text not null default 'backtap',    -- backtap | photos
  image_path  text,                               -- path in the anna-captures storage bucket
  status      text not null default 'pending',    -- pending | done | failed
  items       jsonb not null default '[]',        -- pieces read out of the screenshot
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists anna_captures_user_idx on anna_captures(user_id, created_at desc);

create table if not exists anna_edits (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null references anna_users(id) on delete cascade,
  edit_date    date not null,                     -- her local date
  items        jsonb not null,                    -- [{item_id, bucket}] in display order
  created_at   timestamptz not null default now(),
  notified_at  timestamptz,
  opened_at    timestamptz,
  finished_at  timestamptz,
  unique (user_id, edit_date)
);

create table if not exists anna_push (
  endpoint     text primary key,
  user_id      text not null references anna_users(id) on delete cascade,
  subscription jsonb not null,
  created_at   timestamptz not null default now()
);

alter table anna_users    enable row level security;
alter table anna_items    enable row level security;
alter table anna_events   enable row level security;
alter table anna_captures enable row level security;
alter table anna_edits    enable row level security;
alter table anna_push     enable row level security;

-- Private bucket for double-tap screenshots.
insert into storage.buckets (id, name, public)
values ('anna-captures', 'anna-captures', false)
on conflict (id) do nothing;
