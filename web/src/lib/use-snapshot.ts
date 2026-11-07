'use client';

import { useCallback, useState } from 'react';

/**
 * Keeps showing the value as it was when a dialog opened. A ledger commit refreshes the record mid-dialog
 * (e.g. a transfer becomes COMPLETED), which would otherwise unmount the very action whose seal animation
 * is still playing. Pass `onOpenChange` to the actions' ConfirmAction.
 */
export function useSnapshotWhileOpen<T>(live: T): readonly [T, (open: boolean) => void] {
  const [snapshot, setSnapshot] = useState<{ value: T } | null>(null);
  const onOpenChange = useCallback((open: boolean) => setSnapshot(open ? { value: live } : null), [live]);
  return [snapshot ? snapshot.value : live, onOpenChange] as const;
}
