-- Pinterest / 平台连接表（OAuth token 存储）
-- 在 Supabase SQL Editor 中执行一次即可
create table if not exists platform_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  provider varchar(20) not null,
  provider_user_id varchar(128),
  provider_username varchar(128),
  access_token text,
  scopes text,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- 每个用户每个平台只有一条连接
create unique index if not exists platform_connections_user_provider_uidx
  on platform_connections (user_id, provider);

create index if not exists platform_connections_user_provider_idx
  on platform_connections (user_id, provider);

-- 行级安全：仅本人可见
alter table platform_connections enable row level security;

drop policy if exists platform_connections_select on platform_connections;
create policy platform_connections_select on platform_connections
  for select using (auth.uid() = user_id);

drop policy if exists platform_connections_insert on platform_connections;
create policy platform_connections_insert on platform_connections
  for insert with check (auth.uid() = user_id);

drop policy if exists platform_connections_update on platform_connections;
create policy platform_connections_update on platform_connections
  for update using (auth.uid() = user_id);

drop policy if exists platform_connections_delete on platform_connections;
create policy platform_connections_delete on platform_connections
  for delete using (auth.uid() = user_id);
