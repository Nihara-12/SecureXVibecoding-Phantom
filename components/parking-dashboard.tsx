"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dateTime, inr, remainingTime } from "@/lib/format";
import type { Location, ParkingSlot, Profile, Reservation } from "@/lib/types";
import SignOutButton from "@/components/sign-out";

type Props = {
  profile: Profile;
  initialLocations: Location[];
  initialSlots: ParkingSlot[];
  initialReservations: Reservation[];
};

export default function ParkingDashboard({ profile, initialLocations, initialSlots, initialReservations }: Props) {
  const [locations, setLocations] = useState(initialLocations);
  const [slots, setSlots] = useState(initialSlots);
  const [reservations, setReservations] = useState(initialReservations);
  const [locationId, setLocationId] = useState(initialLocations[0]?.id ?? "");
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [duration, setDuration] = useState(120);
  const [accessibleOnly, setAccessibleOnly] = useState(false);
  const [view, setView] = useState<"find" | "sessions">("find");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(Date.now());
  const [extendTarget, setExtendTarget] = useState<Reservation | null>(null);
  const [extendMinutes, setExtendMinutes] = useState(30);
  const supabase = useMemo(() => createClient(), []);
  const reminderIds = useRef(new Set<string>());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const location = locations.find(item => item.id === locationId);
  const locationSlots = slots.filter(slot => slot.location_id === locationId);
  const selectedSlot = locationSlots.find(slot => slot.id === selectedSlotId);
  const activeReservations = reservations.filter(item => item.status === "active");
  const availableCount = slots.filter(slot => slot.status === "available").length;
  const occupiedCount = slots.filter(slot => slot.status === "occupied").length;
  const hourlyRate = location && selectedSlot?.is_accessible ? Number(location.accessible_hourly_rate) : Number(location?.hourly_rate ?? 0);
  const estimate = hourlyRate * duration / 60;

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3500);
  }, []);

  const refresh = useCallback(async () => {
    const [{ data: nextLocations }, { data: nextSlots }, { data: nextReservations }] = await Promise.all([
      supabase.from("locations").select("*").eq("is_active", true).order("name"),
      supabase.from("parking_slots").select("*").order("code"),
      supabase.from("reservations").select("*, parking_slots(code,is_accessible,location_id,locations(name,area))").eq("user_id", profile.id).order("created_at", { ascending: false }).limit(30),
    ]);
    if (nextLocations) setLocations(nextLocations as Location[]);
    if (nextSlots) setSlots(nextSlots as ParkingSlot[]);
    if (nextReservations) setReservations(nextReservations as Reservation[]);
  }, [profile.id, supabase]);

  useEffect(() => {
    const channel = supabase.channel(`parkly-user-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "parking_slots" }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "reservations", filter: `user_id=eq.${profile.id}` }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [profile.id, refresh, supabase]);

  useEffect(() => {
    const tick = () => {
      const current = Date.now();
      setNow(current);
      for (const reservation of reservations.filter(item => item.status === "active")) {
        const remaining = new Date(reservation.ends_at).getTime() - current;
        if (remaining > 0 && remaining <= 10 * 60 * 1000 && !reminderIds.current.has(reservation.id)) {
          reminderIds.current.add(reservation.id);
          notify(`Your space ${reservation.parking_slots?.code ?? ""} session ends in 10 minutes. Extend it now.`);
        }
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    const sync = setInterval(() => void refresh(), 30000);
    return () => { clearInterval(timer); clearInterval(sync); };
  }, [reservations, notify, refresh]);

  async function reserve() {
    if (!selectedSlot || !location || selectedSlot.status !== "available") return;
    setBusy(true);
    const { error } = await supabase.rpc("reserve_parking_slot", {
      p_slot_id: selectedSlot.id,
      p_duration_minutes: duration,
    });
    if (error) notify(error.message);
    else {
      notify(`${selectedSlot.code} reserved. Your session is now active.`);
      setSelectedSlotId("");
      setView("sessions");
      await refresh();
    }
    setBusy(false);
  }

  async function endSession(reservation: Reservation) {
    setBusy(true);
    const { error } = await supabase.rpc("end_parking_session", { p_reservation_id: reservation.id });
    if (error) notify(error.message);
    else {
      notify("Session ended. The slot is available again.");
      await refresh();
    }
    setBusy(false);
  }

  async function extendSession() {
    if (!extendTarget) return;
    setBusy(true);
    const { error } = await supabase.rpc("extend_parking_session", {
      p_reservation_id: extendTarget.id,
      p_extra_minutes: extendMinutes,
    });
    if (error) notify(error.message);
    else {
      reminderIds.current.delete(extendTarget.id);
      notify(`Session extended by ${extendMinutes} minutes.`);
      setExtendTarget(null);
      await refresh();
    }
    setBusy(false);
  }

  const onTheLot = locationSlots.filter(slot => slot.status === "occupied").length;
  const freeAtLocation = locationSlots.filter(slot => slot.status === "available").length;

  return (
    <main className="dashboard-shell">
      <header className="app-header">
        <Link className="brand" href="/"><span className="brand-mark">P</span><span>parkly<span className="brand-city"> CHENNAI</span></span></Link>
        <nav className="main-nav"><button className={view === "find" ? "nav-link active" : "nav-link"} onClick={() => setView("find")}>Find parking</button><button className={view === "sessions" ? "nav-link active" : "nav-link"} onClick={() => setView("sessions")}>My sessions{activeReservations.length > 0 && <i className="nav-count">{activeReservations.length}</i>}</button>{profile.role === "admin" && <Link className="nav-link" href="/admin">Admin dashboard</Link>}</nav>
        <div className="user-tools"><div className="user-badge"><span className="user-avatar">{(profile.full_name || profile.email).slice(0, 1).toUpperCase()}</span><span className="user-name">{profile.full_name || profile.email}</span>{profile.role === "admin" && <span className="role-chip">ADMIN</span>}</div><SignOutButton /></div>
      </header>

      <section className="dashboard-hero">
        <div><p className="eyebrow"><i className="pulse-dot" /> SMART PARKING · CHENNAI</p><h1>{view === "find" ? <>Your next spot,<br /><em>already found.</em></> : <>Your parking,<br /><em>under control.</em></>}</h1><p className="hero-sub">{view === "find" ? "Choose a nearby location, pick a bay, and get on with your day." : "Track your sessions and keep your plans moving."}</p></div>
        <div className="hero-stats"><div className="hero-stat"><span className="stat-icon green">⌗</span><div><strong>{availableCount}</strong><span>spaces free</span></div></div><div className="hero-stat"><span className="stat-icon dark">◉</span><div><strong>{occupiedCount}</strong><span>occupied</span></div></div><div className="hero-stat"><span className="stat-icon lime">↗</span><div><strong>{activeReservations.length}</strong><span>your sessions</span></div></div></div>
      </section>

      {view === "find" ? (
        <section className="workspace-grid">
          <div className="panel lot-panel">
            <div className="panel-heading"><div><p className="eyebrow">STEP 1 · LOCATION</p><h2>Choose where to park</h2></div><span className="sample-badge"><i /> LIVE FROM DATABASE</span></div>
            <div className="location-pills">{locations.map(item => {
              const count = slots.filter(slot => slot.location_id === item.id && slot.status === "available").length;
              return <button key={item.id} className={locationId === item.id ? "location-pill selected" : "location-pill"} onClick={() => { setLocationId(item.id); setSelectedSlotId(""); setAccessibleOnly(false); }}><span className="pill-pin">⌖</span><span><b>{item.name}</b><small>{item.area} · {count} free</small></span><i>{locationId === item.id ? "✓" : "→"}</i></button>;
            })}</div>
            {location && <>
              <div className="lot-intro"><div><p className="eyebrow">STEP 2 · PICK YOUR BAY</p><h3>{location.name}</h3><p>{location.address}</p></div><button className={accessibleOnly ? "access-toggle on" : "access-toggle"} onClick={() => setAccessibleOnly(value => !value)}><span>♿</span> Accessible bays</button></div>
              <div className="lot-toolbar"><span><i className="legend-dot available-dot" /> Available <b>{freeAtLocation}</b></span><span><i className="legend-dot occupied-dot" /> Occupied <b>{onTheLot}</b></span><span><i className="legend-dot access-dot" /> Accessible <b>{locationSlots.filter(slot => slot.is_accessible).length}</b></span><span className="lot-entry">← ENTRY</span></div>
              <div className="parking-floor"><div className="floor-label"><span>LEVEL 01</span><span>{locationSlots.length} BAYS</span></div><div className="parking-grid">
                {locationSlots.map(slot => {
                  const dimmed = accessibleOnly && !slot.is_accessible;
                  const stateClass = slot.status === "available" ? "free" : slot.status === "occupied" ? "taken" : "offline";
                  const selected = selectedSlotId === slot.id;
                  return <button key={slot.id} disabled={slot.status !== "available" || dimmed} onClick={() => setSelectedSlotId(slot.id)} className={`slot-card ${stateClass} ${slot.is_accessible ? "accessible" : ""} ${selected ? "chosen" : ""} ${dimmed ? "dimmed" : ""}`} aria-label={`${slot.code}, ${slot.status}${slot.is_accessible ? ", accessible" : ""}`}><span className="slot-car">{slot.status === "occupied" ? "▰" : slot.status === "out_of_service" ? "×" : "⌑"}</span><b>{slot.code}</b>{slot.is_accessible && <small>♿</small>}</button>;
                })}
              </div><div className="drive-aisle"><span>↔</span> ONE WAY · DRIVE AISLE <span>↔</span></div></div>
              <div className="lot-footer"><span>⟳ &nbsp;Space status syncs instantly for all users</span><span>{location.covered ? "Covered parking" : "Open air"}{location.ev_charging ? " · EV charging" : ""}</span></div>
            </>}
          </div>

          <aside className="panel booking-panel">
            <div className="panel-heading"><div><p className="eyebrow">STEP 3 · RESERVE</p><h2>Reservation details</h2></div><span className="booking-icon">P</span></div>
            <div className="selection-summary"><span className="summary-pin">⌖</span><div><b>{location?.name ?? "Select a location"}</b><small>{location?.area ?? "Chennai"}</small></div></div>
            <div className="selection-summary"><span className="summary-pin pale">▰</span><div><b>{selectedSlot ? `Bay ${selectedSlot.code}` : "Choose an available bay"}</b><small>{selectedSlot?.is_accessible ? "Accessible · reduced rate" : "Standard parking bay"}</small></div><span className="summary-status">{selectedSlot ? "SELECTED" : "WAITING"}</span></div>
            <label className="form-label" htmlFor="duration">Parking duration</label><div className="duration-control"><button onClick={() => setDuration(value => Math.max(15, value - 15))} aria-label="Reduce duration">−</button><div><strong>{duration >= 60 ? `${Math.floor(duration / 60)} hr${duration >= 120 ? "s" : ""}${duration % 60 ? ` ${duration % 60} min` : ""}` : `${duration} min`}</strong><small>From now</small></div><button onClick={() => setDuration(value => Math.min(1440, value + 15))} aria-label="Add duration">+</button></div>
            <input className="duration-range" type="range" min="15" max="480" step="15" value={Math.min(duration, 480)} onChange={event => setDuration(Number(event.target.value))} aria-label="Parking duration in minutes" />
            <div className="quick-durations">{[30, 60, 120, 240].map(minutes => <button key={minutes} className={duration === minutes ? "quick-time active" : "quick-time"} onClick={() => setDuration(minutes)}>{minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}</button>)}</div>
            <div className="cost-box"><div><span>Rate</span><b>{inr(hourlyRate)} / hr</b></div><div><span>Estimated total</span><strong>{inr(estimate)}</strong></div></div>
            <button className="button button-primary reserve-button" onClick={reserve} disabled={!selectedSlot || busy}>{busy ? "Reserving…" : "Reserve this space"}<span>→</span></button>
            <p className="payment-note">The estimate is saved to your reservation. Online payment collection can be connected once a payment provider is configured.</p>
            <div className="reminder-note"><span>◷</span><p><b>We’ll remind you 10 minutes before expiry.</b><br />Extend in-app to keep your session going.</p></div>
          </aside>
        </section>
      ) : (
        <section className="panel sessions-panel">
          <div className="panel-heading"><div><p className="eyebrow">YOUR ACCOUNT</p><h2>My parking sessions</h2></div><button className="button button-secondary" onClick={() => setView("find")}>Find a space <span>→</span></button></div>
          {activeReservations.length === 0 ? <div className="empty-state"><span>⌑</span><h3>No active sessions</h3><p>Reserve a Chennai parking bay and it’ll appear here.</p><button className="button button-primary" onClick={() => setView("find")}>Explore available spaces</button></div> : <div className="reservation-list">{activeReservations.map(reservation => <ReservationCard key={reservation.id} reservation={reservation} now={now} busy={busy} onEnd={() => void endSession(reservation)} onExtend={() => { setExtendTarget(reservation); setExtendMinutes(30); }} />)}</div>}
          {reservations.some(item => item.status !== "active") && <details className="history-details"><summary>Recent completed sessions</summary><div className="history-list">{reservations.filter(item => item.status !== "active").slice(0, 8).map(item => <div key={item.id} className="history-row"><span>{item.parking_slots?.locations?.name ?? "Chennai parking"} · Bay {item.parking_slots?.code ?? "—"}</span><span>{dateTime(item.started_at)}</span><b>{inr(Number(item.amount_inr))}</b></div>)}</div></details>}
        </section>
      )}

      <footer className="dashboard-footer"><span>© Parkly Chennai · Smart city parking</span><span><i className="pulse-dot" /> Reservations and inventory are live from PostgreSQL</span></footer>
      {toast && <div className="toast-message" role="status">{toast}</div>}
      {extendTarget && <div className="modal-scrim" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setExtendTarget(null); }}><div className="extend-dialog" role="dialog" aria-modal="true" aria-labelledby="extend-title"><button className="modal-close" onClick={() => setExtendTarget(null)} aria-label="Close">×</button><p className="eyebrow">KEEP YOUR SPOT</p><h2 id="extend-title">Extend parking</h2><p className="muted">Bay {extendTarget.parking_slots?.code} · {extendTarget.parking_slots?.locations?.name}</p><label className="form-label" htmlFor="extra-time">Add time</label><select id="extra-time" value={extendMinutes} onChange={event => setExtendMinutes(Number(event.target.value))}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={120}>2 hours</option></select><div className="cost-box"><div><span>Extension estimate</span><strong>{inr((extendTarget.parking_slots?.is_accessible ? Number(locations.find(x => x.id === extendTarget.parking_slots?.location_id)?.accessible_hourly_rate ?? 0) : Number(locations.find(x => x.id === extendTarget.parking_slots?.location_id)?.hourly_rate ?? 0)) * extendMinutes / 60)}</strong></div></div><p className="payment-note">This records the extra charge on the session. Online payment collection needs provider credentials.</p><button className="button button-primary reserve-button" onClick={() => void extendSession()} disabled={busy}>{busy ? "Updating…" : "Confirm extension"}<span>→</span></button></div></div>}
    </main>
  );
}

function ReservationCard({ reservation, now, busy, onEnd, onExtend }: { reservation: Reservation; now: number; busy: boolean; onEnd: () => void; onExtend: () => void }) {
  const remaining = new Date(reservation.ends_at).getTime() - now;
  const soon = remaining <= 10 * 60 * 1000;
  return <article className={soon ? "reservation-card expiring" : "reservation-card"}>
    <div className="reservation-mark">P</div><div className="reservation-main"><div className="reservation-title"><h3>{reservation.parking_slots?.locations?.name ?? "Chennai parking"}</h3><span className={soon ? "session-pill warning" : "session-pill"}>{soon ? "ENDING SOON" : "ACTIVE"}</span></div><p>{reservation.parking_slots?.locations?.area ?? "Chennai"} · Bay {reservation.parking_slots?.code ?? "—"}{reservation.parking_slots?.is_accessible ? " · Accessible" : ""}</p><div className="reservation-meta"><span>Started {dateTime(reservation.started_at)}</span><span>Ends {dateTime(reservation.ends_at)}</span><span>{inr(Number(reservation.amount_inr))} recorded</span></div></div><div className="reservation-timer"><small>{remaining > 0 ? "TIME LEFT" : "ENDING"}</small><strong>{remainingTime(reservation.ends_at, now)}</strong><div className="reservation-actions"><button className="mini-button" onClick={onExtend}>Extend</button><button className="mini-button danger" disabled={busy} onClick={onEnd}>End now</button></div></div>
  </article>;
}
