import React from 'react';
import { WorkItem, Team } from '../types.js';

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

  const formatDate = (dateString?: string | null) => {
    if (!dateString) return '-';
    try {
      const d = new Date(dateString);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table className="dense-table">
          <thead>
            <tr>
              <th style={{ width: 90 }}>ID</th>
              <th>Title</th>
              <th style={{ width: 130 }}>Status</th>
              <th style={{ width: 100 }}>Priority</th>
              <th style={{ width: 140 }}>Team</th>
              <th style={{ width: 160 }}>Assignee</th>
              <th style={{ width: 100 }}>Due date</th>
              <th style={{ width: 100 }}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && items.length === 0 ? (
              // Skeleton loading rows
              Array.from({ length: 6 }).map((_, idx) => (
                <tr key={idx}>
                  <td><div className="skeleton" style={{ width: 50, height: 14 }} /></td>
                  <td><div className="skeleton" style={{ width: 220, height: 14 }} /></td>
                  <td><div className="skeleton" style={{ width: 70, height: 14 }} /></td>
                  <td><div className="skeleton" style={{ width: 50, height: 14 }} /></td>
                  <td><div className="skeleton" style={{ width: 90, height: 14 }} /></td>
                  <td><div className="skeleton" style={{ width: 110, height: 14 }} /></td>
                  <td><div className="skeleton" style={{ width: 60, height: 14 }} /></td>
                  <td><div className="skeleton" style={{ width: 60, height: 14 }} /></td>
                </tr>
              ))
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '60px 16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: '#4B5563' }}>
                      No work items match these filters
                    </div>
                    {onClearFilters && (
                      <button
                        onClick={onClearFilters}
                        className="btn btn-secondary"
                        style={{ height: 32, fontSize: 13, padding: '0 14px' }}
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
                  >
                    {/* ID */}
                    <td style={{ color: '#6B7280', fontSize: 12 }}>
                      {item.id}
                    </td>

                    {/* Title */}
                    <td style={{ fontWeight: 500, color: '#111827' }}>
                      {item.title}
                    </td>

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
                    <td style={{ color: '#4B5563', fontSize: 12 }}>
                      {getTeamName(item.team_id)}
                    </td>

                    {/* Assignee */}
                    <td>
                      {item.assignee_id ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className="avatar">
                            {getInitials(item.assignee_name)}
                          </span>
                          <span style={{ fontSize: 12, color: '#374151' }}>
                            {item.assignee_name || item.assignee_id}
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: '#9CA3AF', fontSize: 12 }}>
                          Unassigned
                        </span>
                      )}
                    </td>

                    {/* Due Date */}
                    <td style={{ color: '#4B5563', fontSize: 12 }}>
                      {formatDate(item.due_date)}
                    </td>

                    {/* Updated */}
                    <td style={{ color: '#6B7280', fontSize: 12 }}>
                      {formatDate(item.updated_at)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer with cursor pagination and count */}
      <div style={{
        padding: '10px 20px',
        borderTop: '1px solid #E5E7EB',
        background: '#FFFFFF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: 12,
        color: '#6B7280',
      }}>
        <div>
          Showing {items.length} of {totalCount} work items
        </div>

        {hasNextPage && (
          <button
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
            className="btn btn-secondary"
            style={{ fontSize: 12, padding: '4px 12px' }}
          >
            {isFetchingNextPage ? 'Loading more...' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  );
};
