"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AuthForm({ mode, info = "" }: { mode: "login" | "signup"; info?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  const isSignup = mode === "signup";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const supabase = createClient();

    if (isSignup) {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/`,
        },
      });
      if (error) {
        setMessage(error.message);
      } else if (data.session) {
        router.replace("/");
        router.refresh();
      } else {
        setMessage("Account created. Check your email to confirm it, then sign in.");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        setMessage(error.message);
      } else {
        router.replace("/");
        router.refresh();
      }
    }
    setBusy(false);
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Link className="brand auth-brand" href="/"><span className="brand-mark">P</span><span>parkly<span className="brand-city"> CHENNAI</span></span></Link>
        <div className="auth-copy">
          <p className="eyebrow">{isSignup ? "YOUR SPACE IS WAITING" : "WELCOME BACK"}</p>
          <h1>{isSignup ? "Create your account" : "Sign in to Parkly"}</h1>
          <p className="muted">{isSignup ? "Book parking across Chennai in a few taps." : "Manage your parking and find your next spot."}</p>
        </div>
        {info && <div className="notice">{info}</div>}
        <form className="auth-form" onSubmit={submit}>
          {isSignup && <label>Full name<input required autoComplete="name" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name" /></label>}
          <label>Email address<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label>
          <label>Password<input required type="password" minLength={8} autoComplete={isSignup ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" /></label>
          {message && <div className={`notice ${message.includes("created") ? "" : "error-notice"}`}>{message}</div>}
          <button className="button button-primary auth-submit" disabled={busy}>{busy ? "Please wait…" : isSignup ? "Create account" : "Sign in"}<span>→</span></button>
        </form>
        <p className="auth-switch">{isSignup ? "Already have an account?" : "New to Parkly?"} <Link href={isSignup ? "/login" : "/signup"}>{isSignup ? "Sign in" : "Create an account"}</Link></p>
        <div className="auth-foot"><span>🔒</span> Your account is protected by Supabase Auth</div>
      </section>
      <aside className="auth-aside">
        <div className="auth-aside-art"><div className="art-road"></div><div className="art-car car-one"></div><div className="art-car car-two"></div><div className="art-pin">P</div><div className="art-label">A spot saved for you</div></div>
        <p className="eyebrow">LESS SEARCHING, MORE LIVING</p>
        <h2>Parking sorted.<br />Chennai explored.</h2>
        <p className="muted">See spaces, reserve your bay, and extend your session from one simple dashboard.</p>
      </aside>
    </main>
  );
}
