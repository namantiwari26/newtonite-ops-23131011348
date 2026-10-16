import React from 'react';
import { Search, Plus } from 'lucide-react';

interface TopNavProps {
  search: string;
  onSearchChange: (value: string) => void;
  onOpenNewItem: () => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  search,
  onSearchChange,
  onOpenNewItem,
}) => {
  return (
    <header style={{
      height: 52,
      background: '#FFFFFF',
      borderBottom: '1px solid #E5E7EB',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 20px',
      position: 'sticky',
      top: 0,
      zIndex: 50,
    }}>
      {/* Search Input */}
      <div style={{ position: 'relative', width: 340 }}>
        <Search size={15} color="#9CA3AF" style={{ position: 'absolute', left: 10, top: 9 }} />
        <input
          type="text"
          className="input"
          style={{ paddingLeft: 32, height: 32, fontSize: 13, background: '#F9FAFB' }}
          placeholder="Search work items by title or description..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {/* Action Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={onOpenNewItem}
          className="btn btn-primary"
          style={{ height: 32, padding: '0 12px' }}
        >
          <Plus size={15} />
          <span>New item</span>
        </button>
      </div>
    </header>
  );
};
