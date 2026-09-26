import { redirect } from "next/navigation";
import ParkingDashboard from "@/components/parking-dashboard";
import SetupScreen from "@/components/setup-screen";
import { createClient } from "@/lib/supabase/server";
import type { Location, ParkingSlot, Profile, Reservation } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return <SetupScreen />;
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: locations, error: locationsError }, { data: slots, error: slotsError }, { data: reservations }] = await Promise.all([
    supabase.from("profiles").select("id,email,full_name,role").eq("id", user.id).single(),
    supabase.from("locations").select("*").eq("is_active", true).order("name"),
    supabase.from("parking_slots").select("*").order("code"),
    supabase.from("reservations").select("*, parking_slots(code,is_accessible,location_id,locations(name,area))").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30),
  ]);

  if (!profile) return <SetupScreen message="Your profile is not ready yet. Refresh in a moment or check that the database migration ran." />;
  if (locationsError || slotsError) return <SetupScreen message={`The database is connected, but its schema is missing. Run the SQL migration in supabase/migrations first. ${locationsError?.message ?? slotsError?.message ?? ""}`} />;

  return (
    <ParkingDashboard
      profile={profile as Profile}
      initialLocations={(locations ?? []) as Location[]}
      initialSlots={(slots ?? []) as ParkingSlot[]}
      initialReservations={(reservations ?? []) as Reservation[]}
    />
  );
}
