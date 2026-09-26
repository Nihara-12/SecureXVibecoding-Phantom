# Parkly Chennai

A full-stack smart parking MVP built with Next.js, Supabase Auth, PostgreSQL, and Supabase Realtime. It replaces the earlier static HTML demo as the deployable application entry point.

## Features

- Email/password sign-up and sign-in, verified cookie sessions, and user/admin roles.
- Chennai sample locations with accessible bays and INR hourly rates.
- Live slot grid backed by PostgreSQL inventory; reservations lock a slot inside a database transaction so concurrent users cannot book the same bay.
- Session duration and amount tracking, manual end, extensions, and a 10-minute in-app reminder.
- Realtime slot and reservation updates for user and admin dashboards.
- Admin tools to add bays, mark spaces available/occupied/out of service, and monitor current and recent sessions.
- Row Level Security policies and server-verified role checks. A user cannot choose the admin role during sign-up.
- Supabase Cron job to complete expired reservations and release their spaces every minute.

## Requirements

- Node.js 20.9 or newer.
- A Supabase project with the Data API and email/password Auth enabled.

## Local setup

1. Create a Supabase project. In **Project Settings → API** (or the **Connect** panel), copy the project URL and publishable key.
2. Copy `.env.example` to `.env.local` and fill in the Supabase values:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

3. Run [`supabase/migrations/202609260001_parkly.sql`](supabase/migrations/202609260001_parkly.sql) once in the Supabase **SQL Editor**. It creates the tables, RLS policies, booking functions, Chennai sample inventory, and Realtime publication entries.
4. In **Authentication → URL Configuration**, set the local Site URL to `http://localhost:3000` and add `http://localhost:3000/auth/callback` to the redirect allow list. Add your Vercel domain after deployment.
5. Install dependencies and start Next.js:

   ```powershell
   npm install
   npm run dev
   ```

6. Open `http://localhost:3000` and create a user account.

## Create the first admin

Admin role is never accepted from the sign-up form. After creating and confirming the account, replace the example address in [`supabase/make-admin.sql`](supabase/make-admin.sql), then run that SQL once in Supabase SQL Editor. Sign out and back in, then use **Admin dashboard** in the header.

## Automatic expiry

In Supabase Dashboard, enable the **Cron / pg_cron** integration. Then run [`supabase/cron.sql`](supabase/cron.sql) once in SQL Editor. The scheduled job calls the protected database function every minute. You can monitor runs in the Supabase Cron dashboard. The dashboard also shows a 10-minute reminder while the user app is open; browser push/email notifications are not configured.

## Deploy to Vercel

Push this project root to GitHub and import that repository into Vercel. Vercel detects Next.js automatically. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in **Project → Settings → Environment Variables**, then deploy. Add the Vercel deployment URL to Supabase Auth's redirect allow list. Do not commit `.env.local` or a Supabase secret/service-role key.

## Data and payment notes

The included Chennai locations, bay counts, availability, distances, and tariffs are sample data for the MVP. Replace them with operator inventory and approved rates before public operation. Reservation amounts are stored in INR and extensions update the recorded amount, but the app does **not** collect real payments yet; connect a payment provider such as Razorpay and verify its signed webhooks before charging users.

The app uses the Supabase publishable key in the browser and relies on RLS for authorization. No service-role key is required by the app.
