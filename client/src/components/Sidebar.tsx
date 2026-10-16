import React from 'react';
import { User, Team } from '../types.js';
import { CheckSquare, AlertCircle, Inbox, Layers, LogOut } from 'lucide-react';

export type NavView = 'all' | 'my_work' | 'needs_approval' | 'unassigned_urgent';

export function getUserDisplayRole(user: User, teams: Team[] = []): string {
  if (user.is_admin) {
    return 'Administrator';
  }

  if (!user.memberships || user.memberships.length === 0) {
    return 'Viewer';
  }

  // Priority ranking: lead (3) > member (2) > viewer (1)
  const roleWeight: Record<string, number> = {
    lead: 3,
    member: 2,
    viewer: 1,
  };

  const sorted = [...user.memberships].sort(
    (a, b) => (roleWeight[b.role] || 0) - (roleWeight[a.role] || 0)
  );
  const highest = sorted[0];

  const team = teams.find((t) => t.id === highest.team_id);
  const teamName = team?.name;

  if (highest.role === 'lead') {
    return teamName ? `Lead in ${teamName}` : 'Lead';
  }

  if (highest.role === 'member') {
    return 'Member';
  }

  return 'Viewer';
}

interface SidebarProps {
  currentView: NavView;
  onSelectView: (view: NavView) => void;
  currentUser: User;
  teams?: Team[];
  onLogout: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onSelectView,
  currentUser,
  teams = [],
  onLogout,
}) => {
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  const navItems: Array<{ id: NavView; label: string; icon: React.ReactNode }> = [
    { id: 'all', label: 'All Items', icon: <Layers size={16} /> },
    { id: 'my_work', label: 'My Work', icon: <CheckSquare size={16} /> },
    { id: 'needs_approval', label: 'Needs Approval', icon: <AlertCircle size={16} /> },
    { id: 'unassigned_urgent', label: 'Unassigned Urgent', icon: <Inbox size={16} /> },
  ];

  return (
    <aside style={{
      width: 240,
      background: '#F6F7F9',
      borderRight: '1px solid #E5E7EB',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      height: '100vh',
      flexShrink: 0,
      userSelect: 'none',
    }}>
      {/* Brand & Nav */}
      <div>
        {/* App Title */}
        <div style={{
          padding: '16px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          borderBottom: '1px solid #E5E7EB',
        }}>
          <div style={{
            width: 24,
            height: 24,
            borderRadius: 4,
            background: '#2563EB',
            color: '#FFFFFF',
            fontWeight: 700,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            W
          </div>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#1F2937' }}>
            Workdesk
          </span>
        </div>

        {/* Navigation List */}
        <div style={{ padding: '12px 8px' }}>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#9CA3AF',
            padding: '4px 10px',
            marginBottom: 4,
          }}>
            VIEWS
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {navItems.map((item) => {
              const isActive = currentView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectView(item.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 4,
                    border: 'none',
                    background: isActive ? '#E5E7EB' : 'transparent',
                    color: isActive ? '#1F2937' : '#4B5563',
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 400,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background-color 0.1s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.backgroundColor = '#F1F3F5';
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <span style={{ color: isActive ? '#2563EB' : '#6B7280' }}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* User Menu at Bottom */}
      <div style={{
        padding: '12px 14px',
        borderTop: '1px solid #E5E7EB',
        background: '#FFFFFF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
          <div className="avatar">
            {getInitials(currentUser.name)}
          </div>
          <div style={{ overflow: 'hidden' }}>
            <div style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#1F2937',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {currentUser.name}
            </div>
            <div
              style={{
                fontSize: 11,
                color: '#6B7280',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={getUserDisplayRole(currentUser, teams)}
            >
              {getUserDisplayRole(currentUser, teams)}
            </div>
          </div>
        </div>

        <button
          onClick={onLogout}
          className="btn btn-ghost"
          style={{ padding: '6px', color: '#6B7280' }}
          title="Log out"
        >
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  );
};
