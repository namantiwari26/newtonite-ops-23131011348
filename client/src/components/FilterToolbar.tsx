import React from 'react';
import { Team, User, WORK_ITEM_STATUSES, STATUS_LABELS } from '../types.js';
import { FilterState, getFilterChips } from '../filterUtils.js';
import { X } from 'lucide-react';

interface FilterToolbarProps {
  teams: Team[];
  users: User[];
  currentUser?: User | null;
  filters: FilterState;
  onFilterChange: (updates: Partial<FilterState>) => void;
  onClearAll: () => void;
}

export const FilterToolbar: React.FC<FilterToolbarProps> = ({
  teams,
  users,
  currentUser,
  filters,
  onFilterChange,
  onClearAll,
}) => {
  const activeChips = getFilterChips(filters, teams, users, currentUser?.id);

  // Selected value for assignee dropdown
  const assigneeSelectValue =
    filters.assignee === 'me' || (currentUser && filters.assignee === currentUser.id)
      ? 'me'
      : filters.assignee;

  return (
    <div className="filter-toolbar">
      {/* Dropdown controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {/* Status Dropdown */}
        <select
          className="select"
          style={{ width: 'auto', height: 30, fontSize: 12, padding: '2px 8px' }}
          value={filters.status}
          onChange={(e) => onFilterChange({ status: e.target.value })}
          aria-label="Filter by status"
        >
          <option value="">Status: All</option>
          {WORK_ITEM_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>

        {/* Priority Dropdown */}
        <select
          className="select"
          style={{ width: 'auto', height: 30, fontSize: 12, padding: '2px 8px' }}
          value={filters.priority}
          onChange={(e) => onFilterChange({ priority: e.target.value })}
          aria-label="Filter by priority"
        >
          <option value="">Priority: All</option>
          <option value="critical,high">Urgent (Critical & High)</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        {/* Team Dropdown */}
        <select
          className="select"
          style={{ width: 'auto', height: 30, fontSize: 12, padding: '2px 8px' }}
          value={filters.team_id}
          onChange={(e) => onFilterChange({ team_id: e.target.value })}
          aria-label="Filter by team"
        >
          <option value="">Team: All</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        {/* Assignee Dropdown */}
        <select
          className="select"
          style={{ width: 'auto', height: 30, fontSize: 12, padding: '2px 8px' }}
          value={assigneeSelectValue}
          onChange={(e) => {
            const val = e.target.value;
            onFilterChange({
              assignee: val === 'me' && currentUser ? currentUser.id : val,
            });
          }}
          aria-label="Filter by assignee"
        >
          <option value="">Assignee: All</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
          {users
            .filter((u) => !currentUser || u.id !== currentUser.id)
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
        </select>

        {/* Clear filters button in toolbar if chips are present */}
        {activeChips.length > 0 && (
          <button
            type="button"
            onClick={onClearAll}
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '4px 8px', height: 30 }}
            aria-label="Clear all active filters"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Active filter chips (one-to-one with active query parameters) */}
      {activeChips.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {activeChips.map((chip) => (
            <div key={chip.key} className="filter-chip">
              <span>{chip.label}</span>
              <button
                type="button"
                onClick={() => onFilterChange({ [chip.paramKey]: chip.nextValue })}
                className="filter-chip-remove"
                title={`Remove filter: ${chip.label}`}
                aria-label={`Remove filter: ${chip.label}`}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
