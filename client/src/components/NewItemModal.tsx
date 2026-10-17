import React, { useState } from 'react';
import { Team } from '../types.js';
import { X } from 'lucide-react';

interface NewItemModalProps {
  teams: Team[];
  onClose: () => void;
  onSubmit: (data: {
    team_id: string;
    title: string;
    description: string;
    priority: string;
    due_date?: string;
    idempotencyKey: string;
  }) => Promise<void>;
  isSubmitting: boolean;
}

export const NewItemModal: React.FC<NewItemModalProps> = ({
  teams,
  onClose,
  onSubmit,
  isSubmitting,
}) => {
  const [teamId, setTeamId] = useState(teams[0]?.id || '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [dueDate, setDueDate] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || isSubmitting) return;

    const idempotencyKey = crypto.randomUUID();
    await onSubmit({
      team_id: teamId,
      title: title.trim(),
      description: description.trim(),
      priority,
      due_date: dueDate ? new Date(dueDate).toISOString() : undefined,
      idempotencyKey,
    });
  };

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-item-modal-title"
    >
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 18,
            paddingBottom: 12,
            borderBottom: '1px solid #E5E7EB',
          }}
        >
          <h2 id="new-item-modal-title" style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>
            New work item
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost"
            style={{ padding: 4 }}
            aria-label="Close modal"
            title="Close modal"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Team */}
          <div style={{ marginBottom: 14 }}>
            <label
              htmlFor="item-team"
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 500,
                color: '#4B5563',
                marginBottom: 4,
              }}
            >
              Team
            </label>
            <select
              id="item-team"
              className="select"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              required
              aria-label="Select team"
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div style={{ marginBottom: 14 }}>
            <label
              htmlFor="item-title"
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 500,
                color: '#4B5563',
                marginBottom: 4,
              }}
            >
              Title
            </label>
            <input
              id="item-title"
              type="text"
              className="input"
              placeholder="e.g. Refund not processed for order 48213"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              aria-label="Work item title"
            />
          </div>

          {/* Priority & Due Date Row */}
          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}
          >
            <div>
              <label
                htmlFor="item-priority"
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#4B5563',
                  marginBottom: 4,
                }}
              >
                Priority
              </label>
              <select
                id="item-priority"
                className="select"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                aria-label="Select priority"
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="item-due-date"
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#4B5563',
                  marginBottom: 4,
                }}
              >
                Due date
              </label>
              <input
                id="item-due-date"
                type="date"
                className="input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                aria-label="Select due date"
              />
            </div>
          </div>

          {/* Description */}
          <div style={{ marginBottom: 20 }}>
            <label
              htmlFor="item-description"
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 500,
                color: '#4B5563',
                marginBottom: 4,
              }}
            >
              Description
            </label>
            <textarea
              id="item-description"
              className="textarea"
              rows={4}
              placeholder="Add more details, ticket references, or context..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-label="Work item description"
            />
          </div>

          {/* Action buttons */}
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}
          >
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
              aria-label="Cancel and close modal"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !title.trim()}
              className="btn btn-primary"
              title={
                !title.trim()
                  ? 'Title is required to create a work item'
                  : isSubmitting
                    ? 'Creating work item...'
                    : 'Create work item'
              }
              aria-label={
                !title.trim()
                  ? 'Create item (disabled: Title is required)'
                  : isSubmitting
                    ? 'Creating work item...'
                    : 'Create work item'
              }
            >
              {isSubmitting ? 'Creating...' : 'Create item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
