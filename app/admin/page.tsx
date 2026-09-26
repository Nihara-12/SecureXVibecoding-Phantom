import { redirect } from "next/navigation";
import AdminDashboard from "@/components/admin-dashboard";
import { createClient } from "@/lib/supabase/server";
import type { Location, ParkingSlot, Profile, Reservation } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) redirect("/login");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("id,email,full_name,role").eq("id", user.id).single();
  if (!profile || profile.role !== "admin") redirect("/");

  const [{ data: locations }, { data: slots }, { data: reservations }] = await Promise.all([
    supabase.from("locations").select("*").order("name"),
    supabase.from("parking_slots").select("*").order("code"),
    supabase.from("reservations").select("*, parking_slots(code,is_accessible,location_id,locations(name,area)), profiles(full_name,email)").order("created_at", { ascending: false }).limit(100),
  ]);

  return <AdminDashboard profile={profile as Profile} initialLocations={(locations ?? []) as Location[]} initialSlots={(slots ?? []) as ParkingSlot[]} initialReservations={(reservations ?? []) as Reservation[]} />;
}
