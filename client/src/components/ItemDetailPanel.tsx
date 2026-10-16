import React, { useState } from 'react';
import { WorkItem, ActivityEvent, Comment, Team, User } from '../types.js';
import { X, Check, AlertTriangle, Send } from 'lucide-react';

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
  onStatusChange: (item: WorkItem, newStatus: string) => Promise<void>;
  onApprove: (item: WorkItem) => Promise<void>;
  onAddComment: (itemId: string, content: string) => Promise<void>;
  conflictError: string | null;
  onReload: () => void;
  isActionPending: boolean;
}

export const ItemDetailPanel: React.FC<ItemDetailPanelProps> = ({
  item,
  teams,
  currentUser,
  activityEvents,
  comments,
  isLoadingDetail,
  onClose,
  onClaim,
  onStatusChange,
  onApprove,
  onAddComment,
  conflictError,
  onReload,
  isActionPending,
}) => {
  const [newComment, setNewComment] = useState('');
  const [isPostingComment, setIsPostingComment] = useState(false);

  // Check if current user has permission in this item's team
  const userTeamMembership = currentUser.memberships?.find((m) => m.team_id === item.team_id);
  const isTeamMemberOrLead = currentUser.is_admin || !!userTeamMembership;
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

  const formatTimestamp = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMins / 60);

      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return dateString;
    }
  };

  return (
    <div style={{
      width: 480,
      background: '#FFFFFF',
      borderLeft: '1px solid #E5E7EB',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      flexShrink: 0,
      overflowY: 'auto',
    }}>
      {/* Panel Header */}
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid #E5E7EB',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        background: '#FFFFFF',
        zIndex: 10,
      }}>
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
        {/* Inline Conflict / Error Banner */}
        {conflictError && (
          <div className="error-banner">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={15} />
              <span>{conflictError}</span>
            </div>
            <button
              onClick={onReload}
              className="btn btn-secondary"
              style={{ fontSize: 11, padding: '2px 8px', height: 24 }}
            >
              Reload
            </button>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Claim */}
          <button
            onClick={() => onClaim(item)}
            disabled={!canClaim || isActionPending}
            className="btn btn-primary"
            style={{ fontSize: 12, height: 30 }}
            title={
              !isTeamMemberOrLead
                ? 'You do not have permission for this team.'
                : item.assignee_id
                ? 'Item already claimed.'
                : 'Claim this work item'
            }
          >
            Claim
          </button>

          {/* Change status dropdown */}
          <select
            className="select"
            disabled={!canModify || isActionPending}
            style={{ width: 'auto', height: 30, fontSize: 12, padding: '2px 8px' }}
            value={item.status}
            onChange={(e) => onStatusChange(item, e.target.value)}
            title={!canModify ? 'You do not have permission to modify this item.' : 'Change status'}
          >
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="blocked">Blocked</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>

          {/* Approve / Resolve */}
          {item.status !== 'resolved' && (
            <button
              onClick={() => onApprove(item)}
              disabled={!canModify || isActionPending}
              className="btn btn-secondary"
              style={{ fontSize: 12, height: 30, color: '#059669' }}
              title={!canModify ? 'You do not have permission to approve.' : 'Approve and resolve work item'}
            >
              <Check size={14} />
              <span>Approve</span>
            </button>
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

        {/* Properties Column */}
        <div style={{
          background: '#F9FAFB',
          border: '1px solid #E5E7EB',
          borderRadius: 6,
          padding: '12px 14px',
          display: 'grid',
          gridTemplateColumns: '120px 1fr',
          rowGap: 10,
          fontSize: 13,
        }}>
          <div style={{ color: '#6B7280' }}>Status</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className={`status-dot status-dot-${item.status}`} />
              <span style={{ textTransform: 'capitalize' }}>
                {item.status.replace('_', ' ')}
              </span>
            </div>
          </div>

          <div style={{ color: '#6B7280' }}>Priority</div>
          <div>
            <span className={`priority-tag priority-${item.priority}`}>
              {item.priority}
            </span>
          </div>

          <div style={{ color: '#6B7280' }}>Team</div>
          <div style={{ color: '#374151' }}>{teamName}</div>

          <div style={{ color: '#6B7280' }}>Assignee</div>
          <div style={{ color: '#374151' }}>
            {item.assignee_name || item.assignee_id || 'Unassigned'}
          </div>

          <div style={{ color: '#6B7280' }}>Due date</div>
          <div style={{ color: '#374151' }}>
            {item.due_date
              ? new Date(item.due_date).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })
              : 'None'}
          </div>

          <div style={{ color: '#6B7280' }}>Created by</div>
          <div style={{ color: '#374151' }}>
            {item.creator_name || item.created_by}
          </div>
        </div>

        {/* Comments Section */}
        <div>
          <div style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#1F2937',
            marginBottom: 10,
          }}>
            Comments ({comments.length})
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
            {comments.length === 0 ? (
              <div style={{ fontSize: 13, color: '#9CA3AF' }}>
                No comments yet.
              </div>
            ) : (
              comments.map((cmt) => (
                <div
                  key={cmt.id}
                  style={{
                    background: '#F9FAFB',
                    border: '1px solid #E5E7EB',
                    borderRadius: 4,
                    padding: '8px 12px',
                    fontSize: 13,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, color: '#374151' }}>
                      {cmt.user_name || cmt.user_id}
                    </span>
                    <span style={{ fontSize: 11, color: '#9CA3AF' }}>
                      {formatTimestamp(cmt.created_at)}
                    </span>
                  </div>
                  <div style={{ color: '#4B5563', lineHeight: 1.4 }}>
                    {cmt.content}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* New comment input */}
          <form onSubmit={handleCommentSubmit} style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              className="input"
              placeholder="Add a comment..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
            />
            <button
              type="submit"
              disabled={isPostingComment || !newComment.trim()}
              className="btn btn-secondary"
              style={{ padding: '0 10px', height: 32 }}
            >
              <Send size={14} />
            </button>
          </form>
        </div>

        {/* Activity Timeline Section */}
        <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 16 }}>
          <div style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#1F2937',
            marginBottom: 12,
          }}>
            Activity
          </div>

          {isLoadingDetail ? (
            <div style={{ fontSize: 13, color: '#9CA3AF' }}>Loading activity...</div>
          ) : activityEvents.length === 0 ? (
            <div style={{ fontSize: 13, color: '#9CA3AF' }}>No activity events recorded.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {activityEvents.map((act) => {
                const actor = act.actor_name || act.actor_id;
                let description = `${actor} ${act.action} this item`;

                if (act.action === 'created') {
                  description = `${actor} created this work item`;
                } else if (act.action === 'claimed') {
                  description = `${actor} claimed this item`;
                } else if (act.action === 'resolved') {
                  description = `${actor} resolved this item`;
                } else if (act.action === 'updated' && act.details?.changes) {
                  const changedKeys = Object.keys(act.details.changes).join(', ');
                  description = `${actor} updated ${changedKeys}`;
                }

                return (
                  <div
                    key={act.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      fontSize: 12,
                      color: '#4B5563',
                    }}
                  >
                    <span style={{ color: '#9CA3AF', marginTop: 2 }}>•</span>
                    <div style={{ flex: 1 }}>
                      <span>{description}</span>
                      <span style={{ color: '#9CA3AF', marginLeft: 6 }}>
                        {formatTimestamp(act.created_at)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
