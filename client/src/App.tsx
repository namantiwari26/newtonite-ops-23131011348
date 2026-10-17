import { useState, useEffect, useMemo } from 'react';
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
import { Sidebar } from './components/Sidebar.js';
import { TopNav } from './components/TopNav.js';
import { FilterToolbar } from './components/FilterToolbar.js';
import { WorkItemTable } from './components/WorkItemTable.js';
import { ItemDetailPanel } from './components/ItemDetailPanel.js';
import { NewItemModal } from './components/NewItemModal.js';
import {
  FilterState,
  DEFAULT_FILTERS,
  getViewFilters,
  VIEW_TITLES,
  detectActiveView,
} from './filterUtils.js';

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

  // Validate authentication session on app start
  useEffect(() => {
    const token = localStorage.getItem('workdesk_token');
    if (!token) {
      if (currentUser) {
        handleLogout();
      }
      return;
    }

    let isMounted = true;
    fetch('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error('Invalid or expired authentication session');
        }
        const data = await res.json();
        if (isMounted && data.user) {
          setCurrentUser(data.user);
          localStorage.setItem('workdesk_user', JSON.stringify(data.user));
        }
      })
      .catch(() => {
        if (isMounted) {
          handleLogout();
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Single Source of Truth for Filters and Search
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [search, setSearch] = useState('');

  // 3. Derive active navigation view purely from the single filter state
  const activeView = useMemo(
    () => detectActiveView(filters, search, currentUser?.id),
    [filters, search, currentUser?.id]
  );

  // 4. Detail Panel & Modals
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isNewItemModalOpen, setIsNewItemModalOpen] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);

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

  // Scoped Teams and Users for logged-in user
  const userTeamIds = useMemo(() => {
    return new Set(currentUser?.memberships?.map((m) => m.team_id) || []);
  }, [currentUser]);

  // Team filter lists only teams the logged-in user belongs to (everything for admins)
  const availableTeams = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.is_admin) return teams;
    return teams.filter((t) => userTeamIds.has(t.id));
  }, [currentUser, teams, userTeamIds]);

  // Assignee filter lists only users who share a team with the current user
  const availableUsers = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.is_admin) return users;
    return users.filter((u) => u.memberships?.some((m) => userTeamIds.has(m.team_id)));
  }, [currentUser, users, userTeamIds]);

  // Fetch Work Items with Server-Side Keyset Cursor Pagination
  // Built strictly and exclusively from the single filter state object
  const {
    data: itemsPages,
    isLoading: isLoadingItems,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch: refetchItems,
    error: itemsError,
  } = useInfiniteQuery({
    queryKey: ['items', filters, search, currentUser?.id],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      fetchItems({
        team_id: filters.team_id || undefined,
        status: filters.status || undefined,
        priority: filters.priority || undefined,
        assignee: filters.assignee || undefined,
        exclude_status: filters.exclude_status || undefined,
        search: search.trim() || undefined,
        cursor: pageParam || undefined,
        limit: 10,
      }),
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? (lastPage.next_cursor ?? undefined) : undefined,
    enabled: !!currentUser,
    refetchInterval: 10000, // 10-second background polling
  });

  const allItems = itemsPages?.pages.flatMap((page) => page.items) || [];
  const totalCount = itemsPages?.pages[0]?.total_count ?? allItems.length;

  // Selected item detail query
  const {
    data: detailData,
    isLoading: isLoadingDetail,
    error: detailError,
    refetch: refetchDetail,
  } = useQuery({
    queryKey: ['item-detail', selectedItemId],
    queryFn: () => fetchItemDetail(selectedItemId!),
    enabled: !!selectedItemId && !!currentUser,
    refetchInterval: 10000, // 10-second background polling
  });

  const selectedItem = detailData?.item || allItems.find((i) => i.id === selectedItemId) || null;

  // Clear conflict errors when selection changes
  useEffect(() => {
    setConflictError(null);
  }, [selectedItemId]);

  // Global Keyboard listener: Esc closes detail panel or modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isNewItemModalOpen) {
          setIsNewItemModalOpen(false);
        } else if (selectedItemId) {
          setSelectedItemId(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isNewItemModalOpen, selectedItemId]);

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
      if (
        err.status === 409 ||
        err.code === 'OPTIMISTIC_LOCK_CONFLICT' ||
        err.code === 'INVALID_TRANSITION'
      ) {
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
    <div className="app-container">
      {/* Sidebar with Navigation and User Profile */}
      <Sidebar
        currentView={activeView}
        onSelectView={(view) => {
          setFilters(getViewFilters(view, currentUser?.id));
          setSearch('');
          setSelectedItemId(null);
        }}
        currentUser={currentUser}
        teams={teams}
        onLogout={handleLogout}
      />

      {/* Main Workspace Layout */}
      <div className="main-layout">
        {/* Top Bar with Search and New item button */}
        <TopNav
          search={search}
          onSearchChange={setSearch}
          onOpenNewItem={() => setIsNewItemModalOpen(true)}
        />

        {/* Filter Toolbar with Dropdowns and Removable Chips */}
        <FilterToolbar
          teams={availableTeams}
          users={availableUsers}
          currentUser={currentUser}
          filters={filters}
          onFilterChange={(newFilters) => setFilters((prev) => ({ ...prev, ...newFilters }))}
          onClearAll={() => {
            setFilters(DEFAULT_FILTERS);
            setSearch('');
          }}
        />

        {/* Table & Right Detail Panel Container */}
        <div className="workspace-layout">
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
            activeViewTitle={VIEW_TITLES[activeView]}
            isFiltered={
              activeView !== 'all' || !!search.trim() || Object.values(filters).some(Boolean)
            }
            onClearFilters={() => {
              setFilters(DEFAULT_FILTERS);
              setSearch('');
            }}
            error={itemsError as Error | null}
            onRetry={() => refetchItems()}
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
              conflictError={conflictError || (detailError ? (detailError as Error).message : null)}
              onReload={() => {
                setConflictError(null);
                refetchItems();
                refetchDetail();
              }}
              isActionPending={claimMutation.isPending || transitionMutation.isPending}
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
