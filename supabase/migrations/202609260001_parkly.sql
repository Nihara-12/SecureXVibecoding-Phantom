-- Parkly Chennai: database schema, access policies, reservation transactions,
-- and seed inventory. Run this once in the Supabase SQL Editor.

create type public.account_role as enum ('user', 'admin');
create type public.slot_status as enum ('available', 'occupied', 'out_of_service');
create type public.reservation_status as enum ('active', 'completed', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null default '',
  role public.account_role not null default 'user',
  created_at timestamptz not null default now()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  area text not null,
  address text not null,
  city text not null default 'Chennai',
  currency char(3) not null default 'INR' check (currency = 'INR'),
  hourly_rate numeric(10,2) not null check (hourly_rate >= 0),
  accessible_hourly_rate numeric(10,2) not null check (accessible_hourly_rate >= 0 and accessible_hourly_rate <= hourly_rate),
  latitude numeric(9,6),
  longitude numeric(9,6),
  covered boolean not null default false,
  ev_charging boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.parking_slots (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  code text not null,
  is_accessible boolean not null default false,
  status public.slot_status not null default 'available',
  updated_at timestamptz not null default now(),
  unique (location_id, code)
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  slot_id uuid not null references public.parking_slots(id) on delete restrict,
  status public.reservation_status not null default 'active',
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  ended_at timestamptz,
  duration_minutes integer not null check (duration_minutes between 15 and 1440),
  amount_inr numeric(10,2) not null check (amount_inr >= 0),
  created_at timestamptz not null default now(),
  check (ends_at > started_at)
);

create unique index one_active_reservation_per_slot
  on public.reservations(slot_id) where status = 'active';
create index reservations_user_status_idx on public.reservations(user_id, status, ends_at desc);
create index reservations_slot_status_idx on public.reservations(slot_id, status, ends_at desc);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'user'
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;

create or replace function public.release_expired_reservations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  released_count integer;
begin
  with expired as (
    update public.reservations r
    set status = 'completed', ended_at = r.ends_at
    where r.status = 'active' and r.ends_at <= now()
    returning r.slot_id
  )
  update public.parking_slots s
  set status = 'available', updated_at = now()
  where s.id in (select e.slot_id from expired e)
    and s.status <> 'out_of_service'
    and not exists (
      select 1 from public.reservations r
      where r.slot_id = s.id and r.status = 'active'
    );

  get diagnostics released_count = row_count;
  return released_count;
end;
$$;

create or replace function public.reserve_parking_slot(
  p_slot_id uuid,
  p_duration_minutes integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_slot public.parking_slots%rowtype;
  location_rate numeric(10,2);
  accessible_rate numeric(10,2);
  reservation_id uuid;
  final_amount numeric(10,2);
begin
  if current_user_id is null then
    raise exception 'Sign in before reserving a space.' using errcode = '28000';
  end if;
  if p_duration_minutes < 15 or p_duration_minutes > 1440 then
    raise exception 'Parking duration must be between 15 minutes and 24 hours.' using errcode = '22023';
  end if;

  perform public.release_expired_reservations();

  select s.* into target_slot
  from public.parking_slots s
  join public.locations l on l.id = s.location_id
  where s.id = p_slot_id and l.is_active = true
  for update of s;

  if not found then
    raise exception 'Parking space was not found.' using errcode = 'P0002';
  end if;
  select l.hourly_rate, l.accessible_hourly_rate
  into location_rate, accessible_rate
  from public.locations l where l.id = target_slot.location_id;
  if target_slot.status <> 'available' or exists (
    select 1 from public.reservations r
    where r.slot_id = p_slot_id and r.status = 'active' and r.ends_at > now()
  ) then
    raise exception 'This space has just been taken. Please choose another.' using errcode = '55000';
  end if;

  final_amount := round(
    (case when target_slot.is_accessible then accessible_rate else location_rate end)
    * p_duration_minutes / 60.0,
    2
  );

  insert into public.reservations (user_id, slot_id, started_at, ends_at, duration_minutes, amount_inr)
  values (current_user_id, p_slot_id, now(), now() + make_interval(mins => p_duration_minutes), p_duration_minutes, final_amount)
  returning id into reservation_id;

  update public.parking_slots set status = 'occupied', updated_at = now() where id = p_slot_id;
  return reservation_id;
end;
$$;

create or replace function public.extend_parking_session(
  p_reservation_id uuid,
  p_extra_minutes integer
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_reservation public.reservations%rowtype;
  is_accessible boolean;
  hourly_rate numeric(10,2);
  extra_amount numeric(10,2);
  new_end timestamptz;
begin
  if current_user_id is null then
    raise exception 'Sign in before extending a session.' using errcode = '28000';
  end if;
  if p_extra_minutes < 15 or p_extra_minutes > 1440 then
    raise exception 'Extension must be between 15 minutes and 24 hours.' using errcode = '22023';
  end if;

  perform public.release_expired_reservations();
  select * into current_reservation from public.reservations
  where id = p_reservation_id for update;
  if not found then
    raise exception 'Reservation was not found.' using errcode = 'P0002';
  end if;
  if current_reservation.user_id <> current_user_id and not public.is_admin() then
    raise exception 'You cannot extend another user’s reservation.' using errcode = '42501';
  end if;
  if current_reservation.status <> 'active' or current_reservation.ends_at <= now() then
    raise exception 'This parking session has already ended.' using errcode = '55000';
  end if;
  if current_reservation.duration_minutes + p_extra_minutes > 1440 then
    raise exception 'A parking session cannot exceed 24 hours in total.' using errcode = '22023';
  end if;

  select s.is_accessible, case when s.is_accessible then l.accessible_hourly_rate else l.hourly_rate end
  into is_accessible, hourly_rate
  from public.parking_slots s join public.locations l on l.id = s.location_id
  where s.id = current_reservation.slot_id;
  extra_amount := round(hourly_rate * p_extra_minutes / 60.0, 2);
  new_end := current_reservation.ends_at + make_interval(mins => p_extra_minutes);

  update public.reservations
  set ends_at = new_end,
      duration_minutes = duration_minutes + p_extra_minutes,
      amount_inr = amount_inr + extra_amount
  where id = p_reservation_id;
  return new_end;
end;
$$;

create or replace function public.end_parking_session(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_reservation public.reservations%rowtype;
begin
  if current_user_id is null then
    raise exception 'Sign in before ending a session.' using errcode = '28000';
  end if;

  select * into current_reservation from public.reservations
  where id = p_reservation_id for update;
  if not found then
    raise exception 'Reservation was not found.' using errcode = 'P0002';
  end if;
  if current_reservation.user_id <> current_user_id and not public.is_admin() then
    raise exception 'You cannot end another user’s reservation.' using errcode = '42501';
  end if;
  if current_reservation.status <> 'active' then
    return false;
  end if;

  update public.reservations
  set status = 'completed', ended_at = now()
  where id = p_reservation_id;

  update public.parking_slots s
  set status = 'available', updated_at = now()
  where s.id = current_reservation.slot_id
    and s.status <> 'out_of_service'
    and not exists (
      select 1 from public.reservations r
      where r.slot_id = s.id and r.status = 'active'
    );
  return true;
end;
$$;

alter table public.profiles enable row level security;
alter table public.locations enable row level security;
alter table public.parking_slots enable row level security;
alter table public.reservations enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.locations, public.parking_slots to anon, authenticated;
grant select on public.profiles, public.reservations to authenticated;
grant insert, update, delete on public.locations, public.parking_slots to authenticated;

create policy "profiles read own or admin" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));

create policy "public read active locations" on public.locations
  for select to anon, authenticated using (is_active or (select public.is_admin()));
create policy "admins manage locations" on public.locations
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "public read parking slots" on public.parking_slots
  for select to anon, authenticated using (true);
create policy "admins manage parking slots" on public.parking_slots
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "users read own reservations and admins read all" on public.reservations
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to anon, authenticated;
revoke all on function public.release_expired_reservations() from public, anon, authenticated;
grant execute on function public.release_expired_reservations() to service_role;
revoke all on function public.reserve_parking_slot(uuid, integer) from public, anon;
grant execute on function public.reserve_parking_slot(uuid, integer) to authenticated;
revoke all on function public.extend_parking_session(uuid, integer) from public, anon;
grant execute on function public.extend_parking_session(uuid, integer) to authenticated;
revoke all on function public.end_parking_session(uuid) from public, anon;
grant execute on function public.end_parking_session(uuid) to authenticated;

insert into public.locations (name, area, address, hourly_rate, accessible_hourly_rate, latitude, longitude, covered, ev_charging)
values
  ('T. Nagar Multi-Level Parking', 'Pondy Bazaar · GN Chetty Road', 'Pondy Bazaar, T. Nagar, Chennai', 60, 40, 13.041800, 80.233700, true, true),
  ('Marina Beach Parking', 'Marina Loop Road · Triplicane', 'Marina Loop Road, Triplicane, Chennai', 40, 25, 13.050000, 80.282400, true, false),
  ('Chennai Central Station Parking', 'Park Town · Periamet', 'Park Town, Chennai', 50, 35, 13.082700, 80.270700, false, true)
on conflict (name) do nothing;

insert into public.parking_slots (location_id, code, is_accessible)
select l.id,
       case when n <= 20 then 'A' || lpad(n::text, 2, '0') else 'B' || lpad((n - 20)::text, 2, '0') end,
       n in (1, 2, 21, 22)
from public.locations l
cross join generate_series(1, 40) as series(n)
where l.city = 'Chennai'
on conflict (location_id, code) do nothing;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'parking_slots'
    ) then
      execute 'alter publication supabase_realtime add table public.parking_slots';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reservations'
    ) then
      execute 'alter publication supabase_realtime add table public.reservations';
    end if;
  end if;
end;
$$;
