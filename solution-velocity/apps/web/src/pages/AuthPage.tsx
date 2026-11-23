import { useState } from 'react';
import { ApiError } from '../lib/api';
import { useStore } from '../lib/store';

export function AuthPage() {
  const { signIn, register } = useStore();
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [name, setName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signin') await signIn(email, password);
      else await register({ name, email, password, organizationName: organizationName || undefined });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in');
      setBusy(false);
    }
  };

  const useDemo = () => {
    setMode('signin');
    setEmail('aniruddh@solutionvelocity.dev');
    setPassword('JourneyFirst1');
  };

  return (
    <div className="auth-wrap">
      <div className="auth-hero">
        <div>
          <div className="brand" style={{ marginBottom: 40 }}>
            <span className="brand-mark">SV</span>
            <span>
              Solution Velocity
              <small style={{ color: '#8fa9b7' }}>Product development</small>
            </span>
          </div>
          <h1>One connected environment for product development.</h1>
          <p>
            Every project has its own Journey. Work through stages and activities, keep every requirement, document,
            design and approval attached to the work it belongs to, and always know what comes next.
          </p>
          <div className="auth-pillars">
            <div className="pillar">
              <strong>Journey</strong>
              <span>Tells you what needs to happen, and manages the work.</span>
            </div>
            <div className="pillar">
              <strong>AI Assistant</strong>
              <span>Helps you understand, plan and execute — inside one project's context.</span>
            </div>
            <div className="pillar">
              <strong>Design Studio</strong>
              <span>Where the product takes shape, linked back to the Journey.</span>
            </div>
          </div>
        </div>
        <p className="small" style={{ color: '#7e9dab' }}>
          Three destinations. Nothing else to navigate.
        </p>
      </div>

      <div className="auth-form">
        <div className="auth-form-inner">
          <h2 style={{ marginBottom: 4 }}>{mode === 'signin' ? 'Sign in' : 'Create your workspace'}</h2>
          <p className="muted small" style={{ marginBottom: 22 }}>
            {mode === 'signin'
              ? 'Continue to your projects and their Journeys.'
              : 'Your first project becomes your Journey in a few seconds.'}
          </p>

          {error ? <div className="form-error">{error}</div> : null}

          <form onSubmit={submit}>
            {mode === 'register' ? (
              <>
                <div className="field">
                  <label htmlFor="name">Your name</label>
                  <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
                </div>
                <div className="field">
                  <label htmlFor="org">Organisation (optional)</label>
                  <input id="org" className="input" value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} placeholder="Your team or company" />
                </div>
              </>
            ) : null}
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === 'register' ? 8 : undefined}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              />
              {mode === 'register' ? <span className="hint">At least 8 characters.</span> : null}
            </div>
            <button className="btn block" type="submit" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create workspace'}
            </button>
          </form>

          <p className="small muted" style={{ marginTop: 16, textAlign: 'center' }}>
            {mode === 'signin' ? (
              <>
                New here?{' '}
                <button className="link-button" onClick={() => { setMode('register'); setError(null); }}>
                  Create a workspace
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button className="link-button" onClick={() => { setMode('signin'); setError(null); }}>
                  Sign in
                </button>
              </>
            )}
          </p>

          <div className="demo-hint">
            <strong>Demo workspace</strong> — two projects, real Journeys.{' '}
            <button className="link-button" onClick={useDemo}>
              Fill demo credentials
            </button>
            <div style={{ marginTop: 6 }}>
              <code>aniruddh@solutionvelocity.dev</code> / <code>JourneyFirst1</code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
