import React from 'react';
import { WorkItem, Team } from '../types.js';
import { formatRelativeTime, formatExactTime, formatDate } from '../dateUtils.js';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface WorkItemTableProps {
  items: WorkItem[];
  teams: Team[];
  selectedItemId: string | null;
  onSelectItem: (item: WorkItem) => void;
  isLoading: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  totalCount: number;
  onClearFilters?: () => void;
  error?: Error | null;
  onRetry?: () => void;
}

export const WorkItemTable: React.FC<WorkItemTableProps> = ({
  items,
  teams,
  selectedItemId,
  onSelectItem,
  isLoading,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  totalCount,
  onClearFilters,
  error,
  onRetry,
}) => {
  const getTeamName = (teamId: string) => {
    return teams.find((t) => t.id === teamId)?.name || teamId;
  };

  const getInitials = (name?: string | null) => {
    if (!name) return 'U';
    return name
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* Error banner for list */}
      {error && (
        <div style={{ padding: '12px 16px 0' }}>
          <div className="error-banner" role="alert">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={16} />
              <span>Failed to load work items: {error.message || 'Server error'}.</span>
            </div>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="btn btn-secondary"
                style={{ height: 26, fontSize: 12, padding: '0 8px' }}
                aria-label="Retry loading work items"
              >
                <RefreshCw size={12} />
                <span>Retry</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto' }}>
        <table className="dense-table" aria-label="Work items table">
          <thead>
            <tr>
              <th style={{ width: 90 }}>ID</th>
              <th>Title</th>
              <th style={{ width: 130 }}>Status</th>
              <th style={{ width: 100 }}>Priority</th>
              <th style={{ width: 140 }}>Team</th>
              <th style={{ width: 160 }}>Assignee</th>
              <th style={{ width: 100 }}>Due date</th>
              <th style={{ width: 110 }}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && items.length === 0 ? (
              // Loading skeleton rows
              Array.from({ length: 6 }).map((_, idx) => (
                <tr key={idx} aria-hidden="true">
                  <td>
                    <div className="skeleton" style={{ width: 50, height: 14 }} />
                  </td>
                  <td>
                    <div className="skeleton" style={{ width: 220, height: 14 }} />
                  </td>
                  <td>
                    <div className="skeleton" style={{ width: 70, height: 14 }} />
                  </td>
                  <td>
                    <div className="skeleton" style={{ width: 50, height: 14 }} />
                  </td>
                  <td>
                    <div className="skeleton" style={{ width: 90, height: 14 }} />
                  </td>
                  <td>
                    <div className="skeleton" style={{ width: 110, height: 14 }} />
                  </td>
                  <td>
                    <div className="skeleton" style={{ width: 60, height: 14 }} />
                  </td>
                  <td>
                    <div className="skeleton" style={{ width: 60, height: 14 }} />
                  </td>
                </tr>
              ))
            ) : items.length === 0 ? (
              // Empty state
              <tr>
                <td colSpan={8}>
                  <div className="empty-state">
                    <div className="empty-state-title">No work items match these filters</div>
                    <div className="empty-state-desc">
                      Try broadening your search or resetting your active filters.
                    </div>
                    {onClearFilters && (
                      <button
                        type="button"
                        onClick={onClearFilters}
                        className="btn btn-secondary"
                        style={{ height: 32, fontSize: 13, padding: '0 14px', marginTop: 8 }}
                        aria-label="Clear all filters"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const isSelected = selectedItemId === item.id;
                return (
                  <tr
                    key={item.id}
                    className={isSelected ? 'selected' : ''}
                    onClick={() => onSelectItem(item)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectItem(item);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`View details for ${item.title}`}
                    aria-selected={isSelected}
                  >
                    {/* ID */}
                    <td style={{ color: '#6B7280', fontSize: 12 }}>{item.id}</td>

                    {/* Title */}
                    <td style={{ fontWeight: 500, color: '#111827' }}>{item.title}</td>

                    {/* Status */}
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className={`status-dot status-dot-${item.status}`} />
                        <span style={{ textTransform: 'capitalize' }}>
                          {item.status.replace('_', ' ')}
                        </span>
                      </div>
                    </td>

                    {/* Priority */}
                    <td>
                      <span className={`priority-tag priority-${item.priority}`}>
                        {item.priority}
                      </span>
                    </td>

                    {/* Team */}
                    <td style={{ color: '#4B5563', fontSize: 12 }}>{getTeamName(item.team_id)}</td>

                    {/* Assignee */}
                    <td>
                      {item.assignee_id ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className="avatar">{getInitials(item.assignee_name)}</span>
                          <span style={{ fontSize: 12, color: '#374151' }}>
                            {item.assignee_name || item.assignee_id}
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: '#9CA3AF', fontSize: 12 }}>Unassigned</span>
                      )}
                    </td>

                    {/* Due Date */}
                    <td style={{ color: '#4B5563', fontSize: 12 }}>
                      <span title={formatExactTime(item.due_date)}>
                        {formatDate(item.due_date)}
                      </span>
                    </td>

                    {/* Updated Relative Time */}
                    <td style={{ color: '#6B7280', fontSize: 12 }}>
                      <span title={formatExactTime(item.updated_at)}>
                        {formatRelativeTime(item.updated_at)}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer with cursor pagination and count */}
      <div
        style={{
          padding: '10px 20px',
          borderTop: '1px solid #E5E7EB',
          background: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 12,
          color: '#6B7280',
        }}
      >
        <div>
          Showing {items.length} of {totalCount} work items
        </div>

        {hasNextPage && (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
            className="btn btn-secondary"
            style={{ fontSize: 12, padding: '4px 12px' }}
            title={isFetchingNextPage ? 'Loading additional items...' : 'Load next batch of items'}
            aria-label="Load more work items"
          >
            {isFetchingNextPage ? 'Loading more...' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  );
};
