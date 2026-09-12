import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Aperture, ArrowRight, Check, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuthStore } from '../stores/auth';

export default function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setError('');
    setLoading(true);
    try {
      const email = String(values.get('email'));
      const password = String(values.get('password'));
      const me = mode === 'login'
        ? await api.login(email, password)
        : await api.register(email, password, String(values.get('displayName')));
      setSession(me);
      await navigate({ to: '/events' });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not reach the service. Check that the API is running.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-visual" aria-label="Wedding photography preview">
        <div className="brand-lockup"><Aperture aria-hidden="true" /><span>Arc & Grain</span></div>
        <div className="auth-statement">
          <p>A private delivery room for photographs worth keeping.</p>
          <div className="proof-line"><span><Check /> Direct-to-cloud uploads</span><span><Check /> PIN-protected galleries</span></div>
        </div>
        <div className="frame-index">01 / 06</div>
      </section>

      <section className="auth-panel">
        <div className="auth-form-wrap">
          <div className="auth-heading">
            <p>{mode === 'login' ? 'Welcome back' : 'Create your studio workspace'}</p>
            <h1>{mode === 'login' ? 'Return to the edit.' : 'Start with the next story.'}</h1>
            <span>{mode === 'login' ? 'Sign in to review shoots, selections, and deliveries.' : 'Set up the lead account. You can invite your team next.'}</span>
          </div>

          <form className="auth-form" onSubmit={submit}>
            {mode === 'register' && <label>Display name<input name="displayName" autoComplete="name" required placeholder="Priya Sharma" /></label>}
            <label>Email address<input name="email" type="email" autoComplete="email" required placeholder="you@studio.com" /></label>
            <label>Password<div className="password-field"><input name="password" type={showPassword ? 'text' : 'password'} minLength={10} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required placeholder="At least 10 characters" /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff /> : <Eye />}</button></div></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-action" disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <>{mode === 'login' ? 'Sign in' : 'Create workspace'}<ArrowRight /></>}</button>
          </form>

          <p className="auth-switch">
            {mode === 'login' ? 'New to Arc & Grain?' : 'Already have an account?'}{' '}
            <Link to={mode === 'login' ? '/register' : '/login'}>{mode === 'login' ? 'Create your workspace' : 'Sign in'}</Link>
          </p>
          <p className="auth-security">Session secured by an httpOnly cookie. Your identity is never stored in local storage.</p>
        </div>
      </section>
    </main>
  );
}
