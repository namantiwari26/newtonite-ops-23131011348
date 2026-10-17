export interface FilterState {
  status: string;
  priority: string;
  team_id: string;
  assignee: string;
  exclude_status: string;
}

export const DEFAULT_FILTERS: FilterState = {
  status: '',
  priority: '',
  team_id: '',
  assignee: '',
  exclude_status: '',
};

export type NavView = 'all' | 'my_work' | 'needs_approval' | 'unassigned_urgent' | 'custom';

export function getViewFilters(view: NavView, currentUserId?: string): FilterState {
  switch (view) {
    case 'my_work':
      return {
        status: '',
        priority: '',
        team_id: '',
        assignee: currentUserId || 'me',
        exclude_status: '',
      };
    case 'needs_approval':
      return {
        status: 'awaiting_approval',
        priority: '',
        team_id: '',
        assignee: '',
        exclude_status: '',
      };
    case 'unassigned_urgent':
      return {
        status: '',
        priority: 'critical,high',
        team_id: '',
        assignee: 'unassigned',
        exclude_status: 'resolved,closed',
      };
    case 'all':
    default:
      return { ...DEFAULT_FILTERS };
  }
}

export const VIEW_TITLES: Record<NavView, string> = {
  all: 'All Items',
  my_work: 'My Work',
  needs_approval: 'Needs Approval',
  unassigned_urgent: 'Unassigned Urgent',
  custom: 'Custom Filter',
};

/**
 * Derives the active navigation view from the current filter state and search term.
 */
export function detectActiveView(
  filters: FilterState,
  search?: string,
  currentUserId?: string
): NavView {
  if (search && search.trim()) {
    return 'custom';
  }

  // Check unassigned_urgent: unassigned, critical & high priority, exclude resolved & closed
  if (
    filters.assignee === 'unassigned' &&
    filters.priority === 'critical,high' &&
    filters.exclude_status === 'resolved,closed' &&
    !filters.status &&
    !filters.team_id
  ) {
    return 'unassigned_urgent';
  }

  // Check needs_approval: status awaiting_approval
  if (
    filters.status === 'awaiting_approval' &&
    !filters.priority &&
    !filters.team_id &&
    !filters.assignee &&
    !filters.exclude_status
  ) {
    return 'needs_approval';
  }

  // Check my_work: assignee matches me or currentUserId
  if (
    (filters.assignee === 'me' || (currentUserId && filters.assignee === currentUserId)) &&
    !filters.status &&
    !filters.priority &&
    !filters.team_id &&
    !filters.exclude_status
  ) {
    return 'my_work';
  }

  // Check all: everything empty
  if (
    !filters.status &&
    !filters.priority &&
    !filters.team_id &&
    !filters.assignee &&
    !filters.exclude_status
  ) {
    return 'all';
  }

  return 'custom';
}

/**
 * Builds standard query parameter object from FilterState and search.
 */
export function buildFilterQueryParams(
  filters: FilterState,
  search?: string
): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.team_id) params.team_id = filters.team_id;
  if (filters.status) params.status = filters.status;
  if (filters.priority) params.priority = filters.priority;
  if (filters.assignee) params.assignee = filters.assignee;
  if (filters.exclude_status) params.exclude_status = filters.exclude_status;
  if (search && search.trim()) params.search = search.trim();
  return params;
}

/**
 * Builds URL query string from FilterState.
 */
export function buildQueryString(filters: FilterState, search?: string): string {
  const params = buildFilterQueryParams(filters, search);
  return new URLSearchParams(params).toString();
}

export interface FilterChipData {
  key: string;
  label: string;
  paramKey: keyof FilterState;
  nextValue: string;
}

/**
 * Generates visible chips that exactly match active filter parameters.
 */
export function getFilterChips(
  filters: FilterState,
  teams: Array<{ id: string; name: string }> = [],
  users: Array<{ id: string; name: string }> = [],
  currentUserId?: string
): FilterChipData[] {
  const chips: FilterChipData[] = [];

  // 1. Status chip
  if (filters.status) {
    const formatted = filters.status
      .split(',')
      .map((s) => s.trim().replace(/_/g, ' '))
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(', ');
    chips.push({
      key: 'status',
      label: `Status: ${formatted}`,
      paramKey: 'status',
      nextValue: '',
    });
  }

  // 2. Exclude status chip
  if (filters.exclude_status) {
    const formatted = filters.exclude_status
      .split(',')
      .map((s) => s.trim().replace(/_/g, ' '))
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(', ');
    chips.push({
      key: 'exclude_status',
      label: `Exclude: ${formatted}`,
      paramKey: 'exclude_status',
      nextValue: '',
    });
  }

  // 3. Priority chips (split into individual chips for multiple priorities)
  if (filters.priority) {
    const priorities = filters.priority
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (priorities.length > 1) {
      for (const p of priorities) {
        chips.push({
          key: `priority-${p}`,
          label: `Priority: ${p.charAt(0).toUpperCase() + p.slice(1)}`,
          paramKey: 'priority',
          nextValue: priorities.filter((x) => x !== p).join(','),
        });
      }
    } else {
      chips.push({
        key: 'priority',
        label: `Priority: ${filters.priority.charAt(0).toUpperCase() + filters.priority.slice(1)}`,
        paramKey: 'priority',
        nextValue: '',
      });
    }
  }

  // 4. Team chip
  if (filters.team_id) {
    const teamName = teams.find((t) => t.id === filters.team_id)?.name || filters.team_id;
    chips.push({
      key: 'team_id',
      label: `Team: ${teamName}`,
      paramKey: 'team_id',
      nextValue: '',
    });
  }

  // 5. Assignee chip
  if (filters.assignee) {
    const assigneeName =
      filters.assignee === 'me' || (currentUserId && filters.assignee === currentUserId)
        ? 'Assigned to me'
        : filters.assignee === 'unassigned'
          ? 'Unassigned'
          : users.find((u) => u.id === filters.assignee)?.name || filters.assignee;
    chips.push({
      key: 'assignee',
      label: `Assignee: ${assigneeName}`,
      paramKey: 'assignee',
      nextValue: '',
    });
  }

  return chips;
}
