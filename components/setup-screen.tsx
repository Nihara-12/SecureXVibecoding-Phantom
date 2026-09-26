export default function SetupScreen({ message }: { message?: string }) {
  return (
    <main className="setup-screen">
      <div className="setup-card">
        <div className="brand"><span className="brand-mark">P</span><span>parkly<span className="brand-city"> CHENNAI</span></span></div>
        <p className="eyebrow">SMART PARKING PLATFORM</p>
        <h1>Connect your database to get started.</h1>
        <p className="muted">Parkly uses Supabase Auth and PostgreSQL for accounts, reservations, live parking status, and admin tools.</p>
        <div className="setup-steps">
          <span><b>1</b> Create a Supabase project</span>
          <span><b>2</b> Add the values from <code>.env.example</code> to <code>.env.local</code></span>
          <span><b>3</b> Run <code>supabase/migrations/202609260001_parkly.sql</code> in SQL Editor</span>
        </div>
        {message && <div className="notice error-notice">{message}</div>}
        <p className="muted small">Setup instructions are in README.md. Never put a Supabase secret key in a <code>NEXT_PUBLIC_</code> variable.</p>
      </div>
    </main>
  );
}
