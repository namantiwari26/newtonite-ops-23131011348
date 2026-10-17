import React, { useState } from 'react';
import { WorkItem, ActivityEvent, Comment, Team, User } from '../types.js';
import { formatRelativeTime, formatExactTime, formatDate } from '../dateUtils.js';
import { X, Check, XCircle, AlertTriangle, Send } from 'lucide-react';

interface ItemDetailPanelProps {
  item: WorkItem | null;
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
  users = [],
  currentUser,
  activityEvents,
  comments,
  isLoadingDetail,
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
  const [commentError, setCommentError] = useState<string | null>(null);

  // User name lookup helper
  const getUserName = (userId?: string | null) => {
    if (!userId) return '';
    const u = users.find((user) => user.id === userId);
    return u ? u.name : userId;
  };

  const formatStatus = (s?: string) => {
    if (!s) return '';
    return TRANSITION_LABELS[s] || s.replace(/_/g, ' ');
  };

  // If loading and no item data yet, render detail skeleton
  if (isLoadingDetail && !item) {
    return (
      <div className="detail-panel" role="region" aria-label="Loading item details">
        <div className="detail-panel-header">
          <div className="skeleton" style={{ width: 120, height: 16 }} />
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost"
            style={{ padding: 4 }}
            title="Close panel"
            aria-label="Close detail panel"
          >
            <X size={16} />
          </button>
        </div>
        <div className="detail-panel-body">
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="skeleton" style={{ width: 70, height: 30 }} />
            <div className="skeleton" style={{ width: 100, height: 30 }} />
          </div>
          <div className="skeleton" style={{ width: '85%', height: 22 }} />
          <div className="skeleton" style={{ width: '100%', height: 60 }} />
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: '16px 0',
              borderTop: '1px solid #E5E7EB',
              borderBottom: '1px solid #E5E7EB',
            }}
          >
            <div className="skeleton" style={{ width: '60%', height: 14 }} />
            <div className="skeleton" style={{ width: '50%', height: 14 }} />
            <div className="skeleton" style={{ width: '70%', height: 14 }} />
            <div className="skeleton" style={{ width: '40%', height: 14 }} />
          </div>
          <div className="skeleton" style={{ width: '50%', height: 18 }} />
          <div className="skeleton" style={{ width: '100%', height: 70 }} />
        </div>
      </div>
    );
  }

  // If no item selected, render empty state
  if (!item) {
    return (
      <div className="detail-panel" role="region" aria-label="Item details">
        <div className="detail-panel-header">
          <span style={{ fontSize: 13, fontWeight: 600, color: '#6B7280' }}>Details</span>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost"
            style={{ padding: 4 }}
            title="Close panel"
            aria-label="Close detail panel"
          >
            <X size={16} />
          </button>
        </div>
        <div className="empty-state">
          <div className="empty-state-title">No work item selected</div>
          <div className="empty-state-desc">Select an item from the list to view its details.</div>
        </div>
      </div>
    );
  }

  // Check user permissions in item team
  const userTeamMembership = currentUser.memberships?.find((m) => m.team_id === item.team_id);
  const isTeamMemberOrLead = currentUser.is_admin || !!userTeamMembership;
  const isLeadOrAdmin = currentUser.is_admin || userTeamMembership?.role === 'lead';
  const isViewer =
    !currentUser.is_admin && (!userTeamMembership || userTeamMembership.role === 'viewer');

  const canClaim = isTeamMemberOrLead && !isViewer && !item.assignee_id;
  const canModify = isTeamMemberOrLead && !isViewer;

  const teamName = teams.find((t) => t.id === item.team_id)?.name || item.team_id;

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    setCommentError(null);
    setIsPostingComment(true);
    try {
      await onAddComment(item.id, newComment.trim());
      setNewComment('');
    } catch (err: any) {
      setCommentError(err.message || 'Failed to post comment. Please try again.');
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

  // Merge comments and activity into one chronological list
  const commentIdsInActivity = new Set(
    activityEvents
      .filter((a) => a.action === 'comment' && a.details?.comment_id)
      .map((a) => a.details.comment_id)
  );

  interface TimelineItem {
    id: string;
    actorName: string;
    createdAt: string;
    action: string;
    sentences: string[];
    content?: string;
  }

  const timelineItems: TimelineItem[] = [];

  for (const evt of activityEvents) {
    const actor = evt.actor_name || getUserName(evt.actor_id);
    const sentences: string[] = [];
    let content: string | undefined;

    if (evt.action === 'created') {
      sentences.push('created this work item');
    } else if (evt.action === 'claimed') {
      const claimer = evt.details?.actor_name || getUserName(evt.details?.claimed_by) || actor;
      sentences.push(`claimed by ${claimer}`);
    } else if (evt.action === 'transition') {
      const from = formatStatus(evt.details?.from);
      const to = formatStatus(evt.details?.to);
      sentences.push(`status changed from ${from} to ${to}`);
    } else if (evt.action === 'updated') {
      const changes = evt.details?.changes || {};
      if (changes.title) {
        sentences.push(`title changed from "${changes.title.from}" to "${changes.title.to}"`);
      }
      if (changes.priority) {
        sentences.push(`priority changed from ${changes.priority.from} to ${changes.priority.to}`);
      }
      if (changes.status) {
        sentences.push(
          `status changed from ${formatStatus(changes.status.from)} to ${formatStatus(changes.status.to)}`
        );
      }
      if (changes.due_date) {
        sentences.push(
          `due date changed from ${formatDate(changes.due_date.from)} to ${formatDate(changes.due_date.to)}`
        );
      }
      if (changes.assignee_id) {
        const fromName = getUserName(changes.assignee_id.from) || 'unassigned';
        const toName = getUserName(changes.assignee_id.to) || 'unassigned';
        sentences.push(`assignee changed from ${fromName} to ${toName}`);
      }
      if (sentences.length === 0) {
        sentences.push('updated work item properties');
      }
    } else if (evt.action === 'comment') {
      sentences.push('commented');
      content = evt.details?.content;
    } else {
      sentences.push(evt.action);
    }

    timelineItems.push({
      id: evt.id,
      actorName: actor,
      createdAt: evt.created_at,
      action: evt.action,
      sentences,
      content,
    });
  }

  for (const c of comments) {
    if (!commentIdsInActivity.has(c.id)) {
      const actor = c.user_name || getUserName(c.user_id);
      timelineItems.push({
        id: c.id,
        actorName: actor,
        createdAt: c.created_at,
        action: 'comment',
        sentences: ['commented'],
        content: c.content,
      });
    }
  }

  // Sort chronological (oldest to newest)
  timelineItems.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return (
    <div className="detail-panel" role="region" aria-label={`Details for ${item.title}`}>
      {/* Header */}
      <div className="detail-panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#6B7280' }}>{item.id}</span>
          <span style={{ fontSize: 12, color: '#9CA3AF' }}>·</span>
          <span style={{ fontSize: 12, color: '#4B5563' }}>Version {item.version}</span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="btn btn-ghost"
          style={{ padding: 4 }}
          title="Close panel"
          aria-label="Close detail panel"
        >
          <X size={16} />
        </button>
      </div>

      <div className="detail-panel-body">
        {/* Error Banner with Reload button */}
        {conflictError && (
          <div className="error-banner" role="alert">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <AlertTriangle size={16} />
              <span>{conflictError}</span>
            </div>
            <button
              type="button"
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
              aria-label="Reload item details"
            >
              Reload
            </button>
          </div>
        )}

        {/* Action Controls & Allowed Status Transitions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Claim Button */}
          {!item.assignee_id &&
            (canClaim ? (
              <button
                type="button"
                onClick={() => onClaim(item)}
                disabled={isActionPending}
                className="btn btn-primary"
                style={{ fontSize: 12, height: 30 }}
                title={isActionPending ? 'Claiming item...' : 'Claim this work item'}
                aria-label="Claim this work item"
              >
                Claim
              </button>
            ) : isViewer ? (
              <button
                type="button"
                disabled
                className="btn btn-primary"
                style={{ fontSize: 12, height: 30 }}
                title="Viewers cannot claim work items"
                aria-label="Claim (disabled: Viewers cannot claim work items)"
              >
                Claim
              </button>
            ) : (
              <button
                type="button"
                disabled
                className="btn btn-primary"
                style={{ fontSize: 12, height: 30 }}
                title="Only team members can claim work items"
                aria-label="Claim (disabled: Only team members can claim work items)"
              >
                Claim
              </button>
            ))}

          {/* Status buttons: Lead Approval & Rejection */}
          {item.status === 'awaiting_approval' && isLeadOrAdmin && (
            <>
              <button
                type="button"
                onClick={() => onTransition(item, 'resolved')}
                disabled={isActionPending}
                className="btn btn-primary"
                style={{
                  fontSize: 12,
                  height: 30,
                  background: '#059669',
                  borderColor: '#059669',
                  color: '#FFFFFF',
                }}
                title={isActionPending ? 'Updating...' : 'Approve and mark resolved'}
                aria-label="Approve work item"
              >
                <Check size={14} />
                <span>Approve</span>
              </button>
              <button
                type="button"
                onClick={() => onTransition(item, 'in_progress')}
                disabled={isActionPending}
                className="btn btn-secondary"
                style={{ fontSize: 12, height: 30, color: '#DC2626', borderColor: '#FCA5A5' }}
                title={isActionPending ? 'Updating...' : 'Reject and return to in progress'}
                aria-label="Reject work item"
              >
                <XCircle size={14} />
                <span>Reject</span>
              </button>
            </>
          )}

          {item.status === 'awaiting_approval' && !isLeadOrAdmin && (
            <>
              <button
                type="button"
                disabled
                className="btn btn-primary"
                style={{
                  fontSize: 12,
                  height: 30,
                  background: '#059669',
                  borderColor: '#059669',
                  color: '#FFFFFF',
                  opacity: 0.5,
                  cursor: 'not-allowed',
                }}
                title="Only team leads can approve"
                aria-label="Approve (disabled: Only team leads can approve)"
              >
                <Check size={14} />
                <span>Approve</span>
              </button>
              <button
                type="button"
                disabled
                className="btn btn-secondary"
                style={{
                  fontSize: 12,
                  height: 30,
                  color: '#DC2626',
                  borderColor: '#FCA5A5',
                  opacity: 0.5,
                  cursor: 'not-allowed',
                }}
                title="Only team leads can reject"
                aria-label="Reject (disabled: Only team leads can reject)"
              >
                <XCircle size={14} />
                <span>Reject</span>
              </button>
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
            </>
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
              title={isActionPending ? 'Updating status...' : 'Select next status'}
              aria-label="Select next status transition"
            >
              <option value="" disabled>
                Next status...
              </option>
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

          {isViewer && item.status !== 'awaiting_approval' && item.status !== 'closed' && (
            <select
              className="select"
              disabled
              style={{
                width: 'auto',
                height: 30,
                fontSize: 12,
                padding: '2px 8px',
                opacity: 0.5,
                cursor: 'not-allowed',
              }}
              title="Viewers cannot change work item status"
              aria-label="Select next status (disabled: Viewers cannot change work item status)"
              value=""
            >
              <option value="" disabled>
                Next status...
              </option>
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
              title="Closed work items cannot be transitioned"
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
        <div
          style={{
            borderTop: '1px solid #E5E7EB',
            borderBottom: '1px solid #E5E7EB',
            padding: '16px 0',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, fontSize: 13 }}>
            <div style={{ color: '#6B7280' }}>Status</div>
            <div>
              <span className={`badge badge-status-${item.status}`}>
                {item.status.replace('_', ' ')}
              </span>
            </div>

            <div style={{ color: '#6B7280' }}>Priority</div>
            <div>
              <span className={`badge badge-priority-${item.priority}`}>{item.priority}</span>
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

            <div style={{ color: '#6B7280' }}>Created</div>
            <div style={{ color: '#111827' }}>
              <span title={formatExactTime(item.created_at)}>
                {formatRelativeTime(item.created_at)}
              </span>
            </div>

            <div style={{ color: '#6B7280' }}>Updated</div>
            <div style={{ color: '#111827' }}>
              <span title={formatExactTime(item.updated_at)}>
                {formatRelativeTime(item.updated_at)}
              </span>
            </div>

            <div style={{ color: '#6B7280' }}>Due Date</div>
            <div style={{ color: '#111827' }}>
              <span title={formatExactTime(item.due_date)}>
                {item.due_date ? formatDate(item.due_date) : 'None'}
              </span>
            </div>
          </div>
        </div>

        {/* Unified Chronological Activity & Comments Timeline */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 12 }}>
            Activity & Comments ({timelineItems.length})
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
            {/* Comments Empty State */}
            {timelineItems.length === 0 ? (
              <div className="empty-state" style={{ padding: '24px 12px' }}>
                <div className="empty-state-title">No comments or activity yet</div>
                <div className="empty-state-desc">Leave a comment below to start a discussion.</div>
              </div>
            ) : (
              timelineItems.map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    fontSize: 12,
                    color: '#4B5563',
                    padding: '10px 12px',
                    background: entry.action === 'comment' ? '#F9FAFB' : '#FAFAFA',
                    borderRadius: 6,
                    border: '1px solid #E5E7EB',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      marginBottom: 4,
                    }}
                  >
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
                    >
                      <span style={{ fontWeight: 600, color: '#111827' }}>{entry.actorName}</span>
                      {entry.sentences.map((sentence, idx) => (
                        <span key={idx} style={{ color: '#4B5563' }}>
                          {sentence}
                        </span>
                      ))}
                    </div>
                    <span
                      title={formatExactTime(entry.createdAt)}
                      style={{
                        color: '#9CA3AF',
                        fontSize: 11,
                        whiteSpace: 'nowrap',
                        marginLeft: 8,
                      }}
                    >
                      {formatRelativeTime(entry.createdAt)}
                    </span>
                  </div>

                  {entry.content && (
                    <div
                      style={{
                        marginTop: 6,
                        padding: '8px 10px',
                        background: '#FFFFFF',
                        border: '1px solid #E5E7EB',
                        borderRadius: 4,
                        fontSize: 13,
                        color: '#1F2937',
                        whiteSpace: 'pre-wrap',
                        lineHeight: 1.5,
                      }}
                    >
                      {entry.content}
                    </div>
                  )}
                </div>
              ))
            )}

            {/* Posting Comment Skeleton */}
            {isPostingComment && (
              <div className="skeleton" style={{ height: 48, borderRadius: 6 }} />
            )}
          </div>

          {/* Comment Error Banner */}
          {commentError && (
            <div className="error-banner" role="alert" style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={14} />
                <span>{commentError}</span>
              </div>
              <button
                type="button"
                onClick={() => setCommentError(null)}
                className="btn btn-ghost"
                style={{ padding: 2 }}
                aria-label="Dismiss comment error"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {/* Add Comment Input */}
          <form onSubmit={handleCommentSubmit} style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              className="input"
              style={{ fontSize: 13 }}
              placeholder="Add a comment..."
              value={newComment}
              onChange={(e) => {
                setNewComment(e.target.value);
                if (commentError) setCommentError(null);
              }}
              disabled={isPostingComment}
              aria-label="Add a comment"
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!newComment.trim() || isPostingComment}
              style={{ padding: '0 12px' }}
              title={
                !newComment.trim()
                  ? 'Enter a comment to submit'
                  : isPostingComment
                    ? 'Posting comment...'
                    : 'Submit comment'
              }
              aria-label={
                !newComment.trim()
                  ? 'Submit comment (disabled: Enter a comment to submit)'
                  : isPostingComment
                    ? 'Posting comment...'
                    : 'Submit comment'
              }
            >
              <Send size={14} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
