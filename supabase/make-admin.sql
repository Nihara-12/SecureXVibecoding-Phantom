-- Create the user through the app first, then replace the email below and run this.
-- Role changes are intentionally not available from signup or the client app.
update public.profiles
set role = 'admin'
where lower(email) = lower('replace-with-your-admin-email@example.com');
