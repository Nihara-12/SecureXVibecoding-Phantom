export type UserRole = "user" | "admin";
export type SlotStatus = "available" | "occupied" | "out_of_service";
export type ReservationStatus = "active" | "completed" | "cancelled";

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
};

export type Location = {
  id: string;
  name: string;
  area: string;
  address: string;
  city: string;
  currency: "INR";
  hourly_rate: number;
  accessible_hourly_rate: number;
  latitude: number | null;
  longitude: number | null;
  covered: boolean;
  ev_charging: boolean;
  is_active: boolean;
};

export type ParkingSlot = {
  id: string;
  location_id: string;
  code: string;
  is_accessible: boolean;
  status: SlotStatus;
  updated_at: string;
};

export type Reservation = {
  id: string;
  user_id: string;
  slot_id: string;
  status: ReservationStatus;
  started_at: string;
  ends_at: string;
  ended_at: string | null;
  duration_minutes: number;
  amount_inr: number;
  created_at: string;
  parking_slots?: {
    code: string;
    is_accessible: boolean;
    location_id: string;
    locations?: { name: string; area: string } | null;
  } | null;
  profiles?: { full_name: string; email: string } | null;
};
