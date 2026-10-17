import React, { useState, useRef } from 'react';
import { User } from '../types.js';

interface LoginPageProps {
  onLoginSuccess: (user: User, token: string) => void;
}

interface DemoAccount {
  name: string;
  email: string;
  role: string;
}

const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    name: 'Priya Sharma',
    email: 'priya.sharma@workdesk.test',
    role: 'Lead in Billing & Payments',
  },
  {
    name: 'Marcus Chen',
    email: 'marcus.chen@workdesk.test',
    role: 'Member in Billing & Payments and Core Platform',
  },
  {
    name: 'Samira Khan',
    email: 'samira.khan@workdesk.test',
    role: 'Viewer',
  },
  {
    name: 'Alex Vance',
    email: 'alex.vance@workdesk.test',
    role: 'Administrator',
  },
];

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    // Read values directly from the form DOM at submit time using FormData and input refs
    // This ensures browser autofill works reliably on the first attempt without depending on React state
    const form = e.currentTarget;
    const formData = new FormData(form);

    const formEmail = (formData.get('email') as string) || emailInputRef.current?.value || email;

    const formPassword =
      (formData.get('password') as string) || passwordInputRef.current?.value || password;

    const emailToSubmit = (formEmail || '').trim();
    const passwordToSubmit = formPassword || '';

    if (!emailToSubmit || !passwordToSubmit) {
      setError('Please enter both your email address and password.');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailToSubmit, password: passwordToSubmit }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Invalid email or password');
      }

      localStorage.setItem('workdesk_token', data.token);
      localStorage.setItem('workdesk_user', JSON.stringify(data.user));
      onLoginSuccess(data.user, data.token);
    } catch (err: any) {
      setError(err.message || 'Unable to sign in. Please verify your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickLogin = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('Demo@12345');
    if (emailInputRef.current) emailInputRef.current.value = demoEmail;
    if (passwordInputRef.current) passwordInputRef.current.value = 'Demo@12345';
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F6F7F9',
        padding: 16,
      }}
    >
      <div
        style={{
          background: '#FFFFFF',
          border: '1px solid #E5E7EB',
          borderRadius: 6,
          padding: 32,
          width: '100%',
          maxWidth: 420,
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
        }}
      >
        {/* Brand */}
        <div style={{ marginBottom: 24, textAlign: 'center' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              borderRadius: 6,
              background: '#2563EB',
              color: '#FFFFFF',
              fontWeight: 700,
              fontSize: 18,
              marginBottom: 12,
            }}
          >
            W
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1F2937' }}>Workdesk</h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>
            Sign in to access your team's work items
          </p>
        </div>

        {error && (
          <div
            style={{
              background: '#FEF2F2',
              border: '1px solid #FCA5A5',
              color: '#991B1B',
              borderRadius: 4,
              padding: '8px 12px',
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        {/* Real HTML form with onSubmit and type="submit" button */}
        <form onSubmit={handleSubmit} noValidate={false}>
          <div style={{ marginBottom: 16 }}>
            <label
              htmlFor="email"
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 500,
                color: '#374151',
                marginBottom: 6,
              }}
            >
              Work Email
            </label>
            <input
              ref={emailInputRef}
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@workdesk.test"
              required
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label
              htmlFor="password"
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 500,
                color: '#374151',
                marginBottom: 6,
              }}
            >
              Password
            </label>
            <input
              ref={passwordInputRef}
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="btn btn-primary"
            style={{ width: '100%', padding: '8px 16px', fontSize: 14 }}
            title={isLoading ? 'Signing in...' : 'Sign in to Workdesk'}
            aria-label={isLoading ? 'Signing in...' : 'Sign in to Workdesk'}
          >
            {isLoading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        {/* Demo credentials switcher for testing */}
        <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #E5E7EB' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 500, color: '#6B7280' }}>Quick sign-in as:</div>
            <div style={{ fontSize: 11, color: '#9CA3AF' }}>
              Demo password:{' '}
              <code
                style={{
                  color: '#4B5563',
                  background: '#F3F4F6',
                  padding: '1px 4px',
                  borderRadius: 3,
                }}
              >
                Demo@12345
              </code>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.email}
                type="button"
                onClick={() => handleQuickLogin(acc.email)}
                title={`Sign in as ${acc.name} (${acc.role})`}
                aria-label={`Sign in as ${acc.name}, ${acc.role}`}
                style={{
                  background: '#F9FAFB',
                  border: '1px solid #E5E7EB',
                  borderRadius: 4,
                  padding: '6px 10px',
                  textAlign: 'left',
                  fontSize: 12,
                  cursor: 'pointer',
                  color: '#374151',
                }}
              >
                <strong>{acc.name}</strong> ({acc.role}) ·{' '}
                <span style={{ color: '#6B7280' }}>{acc.email}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
