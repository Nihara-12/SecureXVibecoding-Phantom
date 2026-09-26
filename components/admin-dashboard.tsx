"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { dateTime, inr } from "@/lib/format";
import type { Location, ParkingSlot, Profile, Reservation, SlotStatus } from "@/lib/types";
import SignOutButton from "@/components/sign-out";

type Props = { profile: Profile; initialLocations: Location[]; initialSlots: ParkingSlot[]; initialReservations: Reservation[] };

export default function AdminDashboard({ profile, initialLocations, initialSlots, initialReservations }: Props) {
  const [locations] = useState(initialLocations);
  const [slots, setSlots] = useState(initialSlots);
  const [reservations, setReservations] = useState(initialReservations);
  const [selectedLocation, setSelectedLocation] = useState(initialLocations[0]?.id ?? "");
  const [newCode, setNewCode] = useState("");
  const [newAccessible, setNewAccessible] = useState(false);
  const [busySlot, setBusySlot] = useState("");
  const [toast, setToast] = useState("");
  const supabase = useMemo(() => createClient(), []);

  const refresh = useCallback(async () => {
    const [{ data: nextSlots }, { data: nextReservations }] = await Promise.all([
      supabase.from("parking_slots").select("*").order("code"),
      supabase.from("reservations").select("*, parking_slots(code,is_accessible,location_id,locations(name,area)), profiles(full_name,email)").order("created_at", { ascending: false }).limit(100),
    ]);
    if (nextSlots) setSlots(nextSlots as ParkingSlot[]);
    if (nextReservations) setReservations(nextReservations as Reservation[]);
  }, [supabase]);

  useEffect(() => {
    const channel = supabase.channel("parkly-admin-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "parking_slots" }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "reservations" }, () => void refresh())
      .subscribe();
    const sync = setInterval(() => void refresh(), 30000);
    return () => { clearInterval(sync); void supabase.removeChannel(channel); };
  }, [refresh, supabase]);

  function flash(text: string) {
    setToast(text);
    setTimeout(() => setToast(""), 3200);
  }

  async function changeStatus(slot: ParkingSlot, status: SlotStatus) {
    setBusySlot(slot.id);
    const { error } = await supabase.from("parking_slots").update({ status, updated_at: new Date().toISOString() }).eq("id", slot.id);
    if (error) flash(error.message);
    else { flash(`${slot.code} marked ${status.replaceAll("_", " ")}.`); await refresh(); }
    setBusySlot("");
  }

  async function addSlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = newCode.trim().toUpperCase();
    if (!code || !selectedLocation) return;
    setBusySlot("new");
    const { error } = await supabase.from("parking_slots").insert({ location_id: selectedLocation, code, is_accessible: newAccessible });
    if (error) flash(error.message);
    else { flash(`Bay ${code} added.`); setNewCode(""); setNewAccessible(false); await refresh(); }
    setBusySlot("");
  }

  async function endSession(reservation: Reservation) {
    const { error } = await supabase.rpc("end_parking_session", { p_reservation_id: reservation.id });
    if (error) flash(error.message);
    else { flash("Session ended and its bay released."); await refresh(); }
  }

  const active = reservations.filter(item => item.status === "active");
  const availableCount = slots.filter(slot => slot.status === "available").length;
  const occupiedCount = slots.filter(slot => slot.status === "occupied").length;
  const offlineCount = slots.filter(slot => slot.status === "out_of_service").length;
  const occupancy = slots.length ? Math.round(occupiedCount / slots.length * 100) : 0;
  const viewSlots = slots.filter(slot => slot.location_id === selectedLocation);

  return <main className="dashboard-shell admin-shell">
    <header className="app-header">
      <Link className="brand" href="/"><span className="brand-mark">P</span><span>parkly<span className="brand-city"> CHENNAI</span></span></Link>
      <nav className="main-nav"><Link className="nav-link" href="/">User app</Link><span className="nav-link active">Admin dashboard</span></nav>
      <div className="user-tools"><div className="user-badge"><span className="user-avatar">{(profile.full_name || profile.email).slice(0, 1).toUpperCase()}</span><span className="user-name">{profile.full_name || profile.email}</span><span className="role-chip">ADMIN</span></div><SignOutButton /></div>
    </header>

    <section className="dashboard-hero admin-hero"><div><p className="eyebrow"><i className="pulse-dot" /> OPERATIONS · CHENNAI</p><h1>Know every space.<br /><em>Move the city.</em></h1><p className="hero-sub">Parking inventory and active sessions update as your team works.</p></div><div className="admin-live"><i className="pulse-dot" /><span><b>Live operations</b><small>PostgreSQL · Realtime</small></span></div></section>

    <section className="admin-stats"><div className="admin-stat"><div className="admin-stat-icon green">⌗</div><div><span>AVAILABLE BAYS</span><strong>{availableCount}</strong><small>Across {locations.length} active locations</small></div></div><div className="admin-stat"><div className="admin-stat-icon dark">◉</div><div><span>OCCUPIED NOW</span><strong>{occupiedCount}</strong><small>Live occupied inventory</small></div></div><div className="admin-stat"><div className="admin-stat-icon yellow">◷</div><div><span>ACTIVE SESSIONS</span><strong>{active.length}</strong><small>Tracked against reservation time</small></div></div><div className="admin-stat"><div className="admin-stat-icon muted-icon">×</div><div><span>OUT OF SERVICE</span><strong>{offlineCount}</strong><small>{occupancy}% current occupancy</small></div></div></section>

    <section className="admin-columns">
      <div className="panel admin-inventory"><div className="panel-heading"><div><p className="eyebrow">INVENTORY</p><h2>Manage parking bays</h2></div><span className="sample-badge"><i /> LIVE SYNC</span></div>
        <div className="admin-location-tabs">{locations.map(location => <button key={location.id} className={selectedLocation === location.id ? "admin-loc-tab current" : "admin-loc-tab"} onClick={() => setSelectedLocation(location.id)}>{location.name}<span>{slots.filter(slot => slot.location_id === location.id).length}</span></button>)}</div>
        <div className="admin-slot-list">{viewSlots.map(slot => <article key={slot.id} className="admin-slot-row"><div className={`slot-mini-icon ${slot.status}`}><span>{slot.is_accessible ? "♿" : "▰"}</span></div><div className="admin-slot-desc"><b>{slot.code} {slot.is_accessible && <span className="access-tag">ACCESSIBLE</span>}</b><small>Updated {dateTime(slot.updated_at)}</small></div><span className={`status-label ${slot.status}`}>{slot.status.replaceAll("_", " ")}</span><select aria-label={`Change status for ${slot.code}`} value={slot.status} disabled={busySlot === slot.id} onChange={event => void changeStatus(slot, event.target.value as SlotStatus)}><option value="available">Available</option><option value="occupied">Occupied</option><option value="out_of_service">Out of service</option></select></article>)}</div>
        <form className="add-slot-form" onSubmit={event => void addSlot(event)}><div><p className="eyebrow">ADD INVENTORY</p><h3>Add a parking bay</h3></div><div className="add-slot-fields"><input required value={newCode} onChange={event => setNewCode(event.target.value)} placeholder="Bay code · e.g. C01" aria-label="New bay code" /><label className="check-label"><input type="checkbox" checked={newAccessible} onChange={event => setNewAccessible(event.target.checked)} /> ♿ Accessible</label><button className="button button-primary" disabled={busySlot === "new"}>{busySlot === "new" ? "Adding…" : "Add bay +"}</button></div></form>
      </div>
      <aside className="panel occupancy-panel"><div className="panel-heading"><div><p className="eyebrow">CITY SNAPSHOT</p><h2>Occupancy</h2></div><span className="occupancy-value">{occupancy}%</span></div><div className="occupancy-gauge"><div className="gauge-track"><div className="gauge-fill" style={{ width: `${occupancy}%` }} /></div><div className="gauge-labels"><span>0%</span><span>100%</span></div></div><div className="occupancy-breakdown"><div><i className="legend-dot available-dot" /><span>Available</span><b>{availableCount}</b></div><div><i className="legend-dot occupied-dot" /><span>Occupied</span><b>{occupiedCount}</b></div><div><i className="legend-dot offline-dot" /><span>Out of service</span><b>{offlineCount}</b></div></div><div className="admin-tip"><span>⌁</span><p>Changes publish instantly to the user slot grid. Mark a bay <b>out of service</b> during maintenance.</p></div></aside>
    </section>

    <section className="panel activity-panel"><div className="panel-heading"><div><p className="eyebrow">PARKING ACTIVITY</p><h2>Session monitor</h2></div><span className="session-count">{active.length} ACTIVE</span></div>{reservations.length === 0 ? <div className="empty-inline">No parking sessions have been recorded yet.</div> : <div className="table-scroll"><table className="activity-table"><thead><tr><th>USER</th><th>LOCATION / BAY</th><th>STARTED</th><th>ENDS</th><th>DURATION</th><th>AMOUNT</th><th>STATUS</th><th></th></tr></thead><tbody>{reservations.map(item => <tr key={item.id}><td><b>{item.profiles?.full_name || "Parkly user"}</b><small>{item.profiles?.email}</small></td><td><b>{item.parking_slots?.locations?.name ?? "—"}</b><small>Bay {item.parking_slots?.code ?? "—"}{item.parking_slots?.is_accessible ? " · Accessible" : ""}</small></td><td>{dateTime(item.started_at)}</td><td>{dateTime(item.ends_at)}</td><td>{item.duration_minutes >= 60 ? `${(item.duration_minutes / 60).toFixed(item.duration_minutes % 60 ? 1 : 0)} hr` : `${item.duration_minutes} min`}</td><td>{inr(Number(item.amount_inr))}</td><td><span className={`table-status ${item.status}`}>{item.status}</span></td><td>{item.status === "active" && <button className="table-action" onClick={() => void endSession(item)}>End</button>}</td></tr>)}</tbody></table></div>}</section>

    <footer className="dashboard-footer"><span>Parkly admin · {profile.email}</span><span>Role is assigned through protected database administration</span></footer>
    {toast && <div className="toast-message" role="status">{toast}</div>}
  </main>;
}
