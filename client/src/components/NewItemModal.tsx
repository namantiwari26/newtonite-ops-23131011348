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
  const [teamId, setTeamId] = useState(teams[0]?.id || 'team_billing');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [dueDate, setDueDate] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const idempotencyKey = `idem_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 18,
          paddingBottom: 12,
          borderBottom: '1px solid #E5E7EB',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>
            New work item
          </h2>
          <button
            onClick={onClose}
            className="btn btn-ghost"
            style={{ padding: 4 }}
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Team */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#4B5563', marginBottom: 4 }}>
              Team
            </label>
            <select
              className="select"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              required
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
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#4B5563', marginBottom: 4 }}>
              Title
            </label>
            <input
              type="text"
              className="input"
              placeholder="e.g. Refund not processed for order 48213"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          {/* Priority & Due Date Row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#4B5563', marginBottom: 4 }}>
                Priority
              </label>
              <select
                className="select"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#4B5563', marginBottom: 4 }}>
                Due date
              </label>
              <input
                type="date"
                className="input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          {/* Description */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#4B5563', marginBottom: 4 }}>
              Description
            </label>
            <textarea
              className="textarea"
              rows={4}
              placeholder="Add more details, ticket references, or context..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !title.trim()}
              className="btn btn-primary"
            >
              {isSubmitting ? 'Creating...' : 'Create item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
