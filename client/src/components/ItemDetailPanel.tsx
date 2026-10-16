import React, { useState } from 'react';
import { WorkItem, ActivityEvent, Comment, Team, User } from '../types.js';
import { X, Check, XCircle, AlertTriangle, Send } from 'lucide-react';

interface ItemDetailPanelProps {
  item: WorkItem;
  teams: Team[];
  users: User[];
  currentUser: User;
  activityEvents: ActivityEvent[];
  comments: Comment[];
  isLoadingDetail: boolean;
  onClose: () => void;
  onClaim: (item: WorkItem) => Promise<void>;
  onTransition: (item: WorkItem, to: string) => Promise<void>;
  onAddComment: (itemId: string, content: string) => Promise<void>;
  conflictError: string | null;
  onReload: () => void;
  isActionPending: boolean;
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  open: ['in_progress'],
  in_progress: ['awaiting_approval'],
  awaiting_approval: ['resolved', 'in_progress'],
  resolved: ['closed', 'in_progress'],
  closed: [],
};

const TRANSITION_LABELS: Record<string, string> = {
  in_progress: 'In Progress',
  awaiting_approval: 'Awaiting Approval',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const ItemDetailPanel: React.FC<ItemDetailPanelProps> = ({
  item,
  teams,
  currentUser,
  activityEvents,
  comments,
  isLoadingDetail: _isLoadingDetail,
  onClose,
  onClaim,
  onTransition,
  onAddComment,
  conflictError,
  onReload,
  isActionPending,
}) => {
  const [newComment, setNewComment] = useState('');
  const [isPostingComment, setIsPostingComment] = useState(false);

  // Check user permissions in item team
  const userTeamMembership = currentUser.memberships?.find((m) => m.team_id === item.team_id);
  const isTeamMemberOrLead = currentUser.is_admin || !!userTeamMembership;
  const isLeadOrAdmin = currentUser.is_admin || userTeamMembership?.role === 'lead';
  const isViewer = !currentUser.is_admin && (!userTeamMembership || userTeamMembership.role === 'viewer');

  const canClaim = isTeamMemberOrLead && !isViewer && !item.assignee_id;
  const canModify = isTeamMemberOrLead && !isViewer;

  const teamName = teams.find((t) => t.id === item.team_id)?.name || item.team_id;

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    setIsPostingComment(true);
    try {
      await onAddComment(item.id, newComment.trim());
      setNewComment('');
    } finally {
      setIsPostingComment(false);
    }
  };

  const allowedNext = (ALLOWED_TRANSITIONS[item.status] || []).filter((_toState) => {
    if (item.status === 'awaiting_approval') {
      return isLeadOrAdmin;
    }
    return true;
  });

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: '480px',
        maxWidth: '100vw',
        background: '#FFFFFF',
        boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.08)',
        borderLeft: '1px solid #E5E7EB',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid #E5E7EB',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          background: '#FFFFFF',
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#6B7280' }}>
            {item.id}
          </span>
          <span style={{ fontSize: 12, color: '#9CA3AF' }}>·</span>
          <span style={{ fontSize: 12, color: '#4B5563' }}>
            Version {item.version}
          </span>
        </div>

        <button
          onClick={onClose}
          className="btn btn-ghost"
          style={{ padding: 4 }}
          title="Close panel"
        >
          <X size={16} />
        </button>
      </div>

      <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Task 5: 409 Conflict / Error Banner with Reload button */}
        {conflictError && (
          <div
            style={{
              background: '#FEF2F2',
              border: '1px solid #F87171',
              borderRadius: 6,
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#B91C1C', fontSize: 13, fontWeight: 500 }}>
              <AlertTriangle size={16} />
              <span>{conflictError}</span>
            </div>
            <button
              onClick={onReload}
              className="btn btn-secondary"
              style={{
                fontSize: 12,
                fontWeight: 600,
                height: 28,
                padding: '0 10px',
                background: '#FFFFFF',
                borderColor: '#F87171',
                color: '#B91C1C',
                cursor: 'pointer',
              }}
            >
              Reload
            </button>
          </div>
        )}

        {/* Action Controls & Allowed Status Transitions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Claim Button */}
          {canClaim && (
            <button
              onClick={() => onClaim(item)}
              disabled={isActionPending}
              className="btn btn-primary"
              style={{ fontSize: 12, height: 30 }}
            >
              Claim
            </button>
          )}

          {/* Task 5: Status menu showing only allowed next states */}
          {item.status === 'awaiting_approval' && isLeadOrAdmin && (
            <>
              <button
                onClick={() => onTransition(item, 'resolved')}
                disabled={isActionPending}
                className="btn btn-primary"
                style={{ fontSize: 12, height: 30, background: '#059669', borderColor: '#059669', color: '#FFFFFF' }}
                title="Lead Approval"
              >
                <Check size={14} />
                <span>Approve</span>
              </button>
              <button
                onClick={() => onTransition(item, 'in_progress')}
                disabled={isActionPending}
                className="btn btn-secondary"
                style={{ fontSize: 12, height: 30, color: '#DC2626', borderColor: '#FCA5A5' }}
                title="Lead Rejection (return to in progress)"
              >
                <XCircle size={14} />
                <span>Reject</span>
              </button>
            </>
          )}

          {item.status === 'awaiting_approval' && !isLeadOrAdmin && (
            <span
              style={{
                fontSize: 12,
                padding: '4px 10px',
                background: '#FEF3C7',
                color: '#92400E',
                borderRadius: 4,
                fontWeight: 500,
              }}
            >
              Awaiting Lead Approval
            </span>
          )}

          {/* Status dropdown menu showing only allowed next states */}
          {canModify && allowedNext.length > 0 && (
            <select
              className="select"
              disabled={isActionPending}
              style={{ width: 'auto', height: 30, fontSize: 12, padding: '2px 8px' }}
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  onTransition(item, e.target.value);
                }
              }}
            >
              <option value="" disabled>Next status...</option>
              {allowedNext.map((toState) => (
                <option key={toState} value={toState}>
                  {item.status === 'awaiting_approval' && toState === 'resolved'
                    ? 'Approve (Resolved)'
                    : item.status === 'awaiting_approval' && toState === 'in_progress'
                    ? 'Reject (In Progress)'
                    : item.status === 'resolved' && toState === 'in_progress'
                    ? 'Reopen (In Progress)'
                    : TRANSITION_LABELS[toState] || toState}
                </option>
              ))}
            </select>
          )}

          {item.status === 'closed' && (
            <span
              style={{
                fontSize: 12,
                padding: '4px 10px',
                background: '#F3F4F6',
                color: '#6B7280',
                borderRadius: 4,
                fontWeight: 500,
              }}
            >
              Closed
            </span>
          )}
        </div>

        {/* Title */}
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#111827', lineHeight: 1.4 }}>
            {item.title}
          </h2>
        </div>

        {/* Description */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: '#6B7280', marginBottom: 4 }}>
            Description
          </div>
          <p style={{ fontSize: 13, color: '#374151', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
            {item.description || 'No description provided.'}
          </p>
        </div>

        {/* Metadata Details */}
        <div style={{ borderTop: '1px solid #E5E7EB', borderBottom: '1px solid #E5E7EB', padding: '16px 0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, fontSize: 13 }}>
            <div style={{ color: '#6B7280' }}>Status</div>
            <div>
              <span className={`badge badge-status-${item.status}`}>
                {item.status.replace('_', ' ')}
              </span>
            </div>

            <div style={{ color: '#6B7280' }}>Priority</div>
            <div>
              <span className={`badge badge-priority-${item.priority}`}>
                {item.priority}
              </span>
            </div>

            <div style={{ color: '#6B7280' }}>Team</div>
            <div style={{ color: '#111827', fontWeight: 500 }}>{teamName}</div>

            <div style={{ color: '#6B7280' }}>Assignee</div>
            <div style={{ color: '#111827' }}>
              {item.assignee_name || (
                <span style={{ color: '#9CA3AF', fontStyle: 'italic' }}>Unassigned</span>
              )}
            </div>

            <div style={{ color: '#6B7280' }}>Created By</div>
            <div style={{ color: '#111827' }}>{item.creator_name || item.created_by}</div>

            <div style={{ color: '#6B7280' }}>Due Date</div>
            <div style={{ color: '#111827' }}>
              {item.due_date ? new Date(item.due_date).toLocaleDateString() : 'None'}
            </div>
          </div>
        </div>

        {/* Activity Events */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 12 }}>
            Activity ({activityEvents.length})
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {activityEvents.length === 0 ? (
              <div style={{ fontSize: 12, color: '#9CA3AF' }}>No activity events recorded yet.</div>
            ) : (
              activityEvents.map((evt) => (
                <div
                  key={evt.id}
                  style={{
                    fontSize: 12,
                    color: '#4B5563',
                    padding: '8px 12px',
                    background: '#F9FAFB',
                    borderRadius: 6,
                    border: '1px solid #F3F4F6',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, color: '#111827' }}>
                      {evt.actor_name || evt.actor_id}
                    </span>
                    <span style={{ color: '#9CA3AF', fontSize: 11 }}>
                      {new Date(evt.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div>
                    {evt.action === 'created' && 'created this work item'}
                    {evt.action === 'claimed' && 'claimed this work item'}
                    {evt.action === 'transition' && `transitioned status: ${evt.details?.from || ''} → ${evt.details?.to || ''}`}
                    {evt.action === 'updated' && 'updated work item properties'}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Comments */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 12 }}>
            Comments ({comments.length})
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {comments.length === 0 ? (
              <div style={{ fontSize: 12, color: '#9CA3AF' }}>No comments yet.</div>
            ) : (
              comments.map((c) => (
                <div
                  key={c.id}
                  style={{
                    padding: '10px 12px',
                    background: '#F9FAFB',
                    border: '1px solid #E5E7EB',
                    borderRadius: 6,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>
                      {c.user_name || c.user_id}
                    </span>
                    <span style={{ fontSize: 11, color: '#9CA3AF' }}>
                      {new Date(c.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: '#374151', whiteSpace: 'pre-wrap' }}>
                    {c.content}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Add Comment Input */}
          <form onSubmit={handleCommentSubmit} style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              className="input"
              style={{ fontSize: 13 }}
              placeholder="Add a comment..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              disabled={isPostingComment}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!newComment.trim() || isPostingComment}
              style={{ padding: '0 12px' }}
            >
              <Send size={14} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
