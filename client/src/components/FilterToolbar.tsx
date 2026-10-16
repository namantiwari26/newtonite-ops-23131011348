import React from 'react';
import { Team, User, WORK_ITEM_STATUSES, STATUS_LABELS, WorkItemStatus } from '../types.js';
import { X } from 'lucide-react';

interface FilterToolbarProps {
  teams: Team[];
  users: User[];
  status: string;
  priority: string;
  teamId: string;
  assignee: string;
  onFilterChange: (filters: {
    status?: string;
    priority?: string;
    team_id?: string;
    assignee?: string;
  }) => void;
  onClearAll: () => void;
}

export const FilterToolbar: React.FC<FilterToolbarProps> = ({
  teams,
  users,
  status,
  priority,
  teamId,
  assignee,
  onFilterChange,
  onClearAll,
}) => {
  const activeChips: Array<{ key: string; label: string; onRemove: () => void }> = [];

  if (status) {
    activeChips.push({
      key: 'status',
      label: `Status: ${STATUS_LABELS[status as WorkItemStatus] || status.replace('_', ' ')}`,
      onRemove: () => onFilterChange({ status: '' }),
    });
  }

  if (priority) {
    activeChips.push({
      key: 'priority',
      label: `Priority: ${priority}`,
      onRemove: () => onFilterChange({ priority: '' }),
    });
  }

  if (teamId) {
    const teamName = teams.find((t) => t.id === teamId)?.name || teamId;
    activeChips.push({
      key: 'team',
      label: `Team: ${teamName}`,
      onRemove: () => onFilterChange({ team_id: '' }),
    });
  }

  if (assignee) {
    const assigneeName =
      assignee === 'unassigned'
        ? 'Unassigned'
        : users.find((u) => u.id === assignee)?.name || assignee;
    activeChips.push({
      key: 'assignee',
      label: `Assignee: ${assigneeName}`,
      onRemove: () => onFilterChange({ assignee: '' }),
    });
  }

  return (
    <div style={{
      padding: '12px 20px',
      borderBottom: '1px solid #E5E7EB',
      background: '#FFFFFF',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      {/* Dropdown controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <select
          className="select"
          style={{ width: 'auto', height: 30, fontSize: 12, padding: '2px 8px' }}
          value={status}
          onChange={(e) => onFilterChange({ status: e.target.value })}
        >
          <option value="">Status: All</option>
          {WORK_ITEM_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>

        <select
          className="select"
          style={{ width: 'auto', height: 30, fontSize: 12, padding: '2px 8px' }}
          value={priority}
          onChange={(e) => onFilterChange({ priority: e.target.value })}
        >
          <option value="">Priority: All</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <select
          className="select"
          style={{ width: 'auto', height: 30, fontSize: 12, padding: '2px 8px' }}
          value={teamId}
          onChange={(e) => onFilterChange({ team_id: e.target.value })}
        >
          <option value="">Team: All</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <select
          className="select"
          style={{ width: 'auto', height: 30, fontSize: 12, padding: '2px 8px' }}
          value={assignee}
          onChange={(e) => onFilterChange({ assignee: e.target.value })}
        >
          <option value="">Assignee: All</option>
          <option value="unassigned">Unassigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>

        {activeChips.length > 0 && (
          <button
            onClick={onClearAll}
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '4px 8px', height: 30 }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Active filter chips */}
      {activeChips.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {activeChips.map((chip) => (
            <div key={chip.key} className="filter-chip">
              <span>{chip.label}</span>
              <button
                type="button"
                onClick={chip.onRemove}
                className="filter-chip-remove"
                title="Remove filter"
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
