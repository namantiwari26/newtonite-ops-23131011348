import React, { useState } from 'react';
import { User } from '../types.js';

interface LoginPageProps {
  onLoginSuccess: (user: User, token: string) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('priya.sharma@workdesk.test');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Login failed');
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
    setPassword('password123');
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#F6F7F9',
      padding: 16,
    }}>
      <div style={{
        background: '#FFFFFF',
        border: '1px solid #E5E7EB',
        borderRadius: 6,
        padding: 32,
        width: '100%',
        maxWidth: 400,
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
      }}>
        {/* Brand */}
        <div style={{ marginBottom: 24, textAlign: 'center' }}>
          <div style={{
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
          }}>
            W
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1F2937' }}>
            Workdesk
          </h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>
            Sign in to access your team's work items
          </p>
        </div>

        {error && (
          <div style={{
            background: '#FEF2F2',
            border: '1px solid #FCA5A5',
            color: '#991B1B',
            borderRadius: 4,
            padding: '8px 12px',
            fontSize: 13,
            marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
              Work Email
            </label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@workdesk.test"
              required
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
              Password
            </label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="btn btn-primary"
            style={{ width: '100%', padding: '8px 16px', fontSize: 14 }}
          >
            {isLoading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        {/* Demo credentials switcher for testing */}
        <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #E5E7EB' }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: '#6B7280', marginBottom: 8 }}>
            Quick sign-in as:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              type="button"
              onClick={() => handleQuickLogin('priya.sharma@workdesk.test')}
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
              <strong>Priya Sharma</strong> (Admin) · priya.sharma@workdesk.test
            </button>
            <button
              type="button"
              onClick={() => handleQuickLogin('marcus.chen@workdesk.test')}
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
              <strong>Marcus Chen</strong> (Billing Lead) · marcus.chen@workdesk.test
            </button>
            <button
              type="button"
              onClick={() => handleQuickLogin('sarah.jenkins@workdesk.test')}
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
              <strong>Sarah Jenkins</strong> (Team Member) · sarah.jenkins@workdesk.test
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
