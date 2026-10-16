import { useState, useEffect } from 'react';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchTeams,
  fetchUsers,
  fetchItems,
  fetchItemDetail,
  createItem,
  claimItem,
  transitionItem,
  addComment,
} from './api.js';
import { User, WorkItem } from './types.js';
import { LoginPage } from './components/LoginPage.js';
import { Sidebar, NavView } from './components/Sidebar.js';
import { TopNav } from './components/TopNav.js';
import { FilterToolbar } from './components/FilterToolbar.js';
import { WorkItemTable } from './components/WorkItemTable.js';
import { ItemDetailPanel } from './components/ItemDetailPanel.js';
import { NewItemModal } from './components/NewItemModal.js';

export function App() {
  const queryClient = useQueryClient();

  // 1. Authentication State
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem('workdesk_user');
      const token = localStorage.getItem('workdesk_token');
      if (stored && token) {
        return JSON.parse(stored);
      }
    } catch {
      // Fallback
    }
    return null;
  });

  const handleLoginSuccess = (user: User) => {
    setCurrentUser(user);
  };

  const handleLogout = () => {
    localStorage.removeItem('workdesk_token');
    localStorage.removeItem('workdesk_user');
    setCurrentUser(null);
    queryClient.clear();
  };

  // 2. Navigation View State
  const [currentView, setCurrentView] = useState<NavView>('all');

  // 3. Search and Filters State
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({
    status: '',
    priority: '',
    team_id: '',
    assignee: '',
  });

  // 4. Detail Panel & Modals
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isNewItemModalOpen, setIsNewItemModalOpen] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);

  // Sync sidebar view with filter query params
  const effectiveFilters = {
    ...filters,
    search: search.trim() || undefined,
    // Map navigation views to server query parameters
    ...(currentView === 'my_work' && currentUser ? { assignee: currentUser.id } : {}),
    ...(currentView === 'needs_approval' ? { status: 'blocked' } : {}),
    ...(currentView === 'unassigned_urgent' ? { assignee: 'unassigned', priority: 'critical' } : {}),
  };

  // Fetch Teams and Users
  const { data: teams = [] } = useQuery({
    queryKey: ['teams'],
    queryFn: fetchTeams,
    enabled: !!currentUser,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
    enabled: !!currentUser,
  });

  // Fetch Work Items with Server-Side Keyset Cursor Pagination
  const {
    data: itemsPages,
    isLoading: isLoadingItems,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch: refetchItems,
  } = useInfiniteQuery({
    queryKey: ['items', effectiveFilters, currentUser?.id],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      fetchItems({
        team_id: effectiveFilters.team_id || undefined,
        status: effectiveFilters.status || undefined,
        priority: effectiveFilters.priority || undefined,
        assignee: effectiveFilters.assignee || undefined,
        search: effectiveFilters.search,
        cursor: pageParam || undefined,
        limit: 10,
      }),
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? (lastPage.next_cursor ?? undefined) : undefined,
    enabled: !!currentUser,
  });

  const allItems = itemsPages?.pages.flatMap((page) => page.items) || [];
  const totalCount = itemsPages?.pages[0]?.total_count ?? allItems.length;

  // Selected item detail query
  const {
    data: detailData,
    isLoading: isLoadingDetail,
    refetch: refetchDetail,
  } = useQuery({
    queryKey: ['item-detail', selectedItemId],
    queryFn: () => fetchItemDetail(selectedItemId!),
    enabled: !!selectedItemId && !!currentUser,
  });

  const selectedItem = detailData?.item || allItems.find((i) => i.id === selectedItemId) || null;

  // Clear conflict errors when selection changes
  useEffect(() => {
    setConflictError(null);
  }, [selectedItemId]);

  // Mutations
  const claimMutation = useMutation({
    mutationFn: (item: WorkItem) => claimItem(item.id, item.version),
    onSuccess: () => {
      setConflictError(null);
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['item-detail', selectedItemId] });
    },
    onError: (err: any) => {
      if (err.code === 'ALREADY_CLAIMED') {
        setConflictError('This item was already claimed by another team member. Reloading...');
      } else if (err.code === 'OPTIMISTIC_LOCK_CONFLICT') {
        setConflictError('This item was changed by someone else. Reload.');
      } else {
        setConflictError(err.message || 'Failed to claim item');
      }
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });



  const transitionMutation = useMutation({
    mutationFn: ({ item, to }: { item: WorkItem; to: string }) =>
      transitionItem(item.id, to, item.version),
    onSuccess: () => {
      setConflictError(null);
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['item-detail', selectedItemId] });
    },
    onError: (err: any) => {
      if (err.status === 409 || err.code === 'OPTIMISTIC_LOCK_CONFLICT' || err.code === 'INVALID_TRANSITION') {
        setConflictError(err.message || 'This item was changed by someone else. Reload.');
      } else {
        setConflictError(err.message || 'Failed to transition item');
      }
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['item-detail', selectedItemId] });
    },
  });

  const addCommentMutation = useMutation({
    mutationFn: ({ itemId, content }: { itemId: string; content: string }) =>
      addComment(itemId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['item-detail', selectedItemId] });
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: {
      team_id: string;
      title: string;
      description: string;
      priority: string;
      due_date?: string;
      idempotencyKey: string;
    }) =>
      createItem(
        {
          team_id: data.team_id,
          title: data.title,
          description: data.description,
          priority: data.priority,
          due_date: data.due_date,
        },
        data.idempotencyKey
      ),
    onSuccess: (data) => {
      setIsNewItemModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['items'] });
      setSelectedItemId(data.item.id);
    },
  });

  // If unauthenticated, show real login page
  if (!currentUser) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      {/* Sidebar with Navigation and User Profile */}
      <Sidebar
        currentView={currentView}
        onSelectView={(view) => {
          setCurrentView(view);
          setSelectedItemId(null);
        }}
        currentUser={currentUser}
        onLogout={handleLogout}
      />

      {/* Main Workspace Layout */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, height: '100%' }}>
        {/* Top Bar with Search and New item button */}
        <TopNav
          search={search}
          onSearchChange={setSearch}
          onOpenNewItem={() => setIsNewItemModalOpen(true)}
        />

        {/* Filter Toolbar with Dropdowns and Removable Chips */}
        <FilterToolbar
          teams={teams}
          users={users}
          status={filters.status}
          priority={filters.priority}
          teamId={filters.team_id}
          assignee={filters.assignee}
          onFilterChange={(newFilters) => setFilters((prev) => ({ ...prev, ...newFilters }))}
          onClearAll={() =>
            setFilters({
              status: '',
              priority: '',
              team_id: '',
              assignee: '',
            })
          }
        />

        {/* Table & Right Detail Panel Container */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Dense Work Item Table */}
          <WorkItemTable
            items={allItems}
            teams={teams}
            selectedItemId={selectedItemId}
            onSelectItem={(item) => setSelectedItemId(item.id)}
            isLoading={isLoadingItems}
            hasNextPage={!!hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            onLoadMore={() => fetchNextPage()}
            totalCount={totalCount}
          />

          {/* Right-Side Item Detail Panel */}
          {selectedItem && (
            <ItemDetailPanel
              item={selectedItem}
              teams={teams}
              users={users}
              currentUser={currentUser}
              activityEvents={detailData?.activity_events || []}
              comments={detailData?.comments || []}
              isLoadingDetail={isLoadingDetail}
              onClose={() => setSelectedItemId(null)}
              onClaim={async (it) => {
                await claimMutation.mutateAsync(it);
              }}
              onTransition={async (it, to) => {
                await transitionMutation.mutateAsync({ item: it, to });
              }}
              onAddComment={async (itemId, content) => {
                await addCommentMutation.mutateAsync({ itemId, content });
              }}
              conflictError={conflictError}
              onReload={() => {
                setConflictError(null);
                refetchItems();
                refetchDetail();
              }}
              isActionPending={
                claimMutation.isPending ||
                transitionMutation.isPending
              }
            />
          )}
        </div>
      </div>

      {/* New Work Item Modal */}
      {isNewItemModalOpen && (
        <NewItemModal
          teams={teams}
          onClose={() => setIsNewItemModalOpen(false)}
          onSubmit={async (data) => {
            await createMutation.mutateAsync(data);
          }}
          isSubmitting={createMutation.isPending}
        />
      )}
    </div>
  );
}

export default App;
