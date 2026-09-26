-- Enable the pg_cron extension first in Supabase Dashboard > Integrations > Cron.
-- Then run this once in SQL Editor. This automatically completes expired sessions
-- and frees their parking spaces once per minute.
select cron.schedule(
  'parkly-release-expired-sessions',
  '* * * * *',
  'select public.release_expired_reservations();'
);
