import { Suspense } from 'react';
import { PortalShell, PortalSkeleton } from '@/components/shell/portal-shell';

/**
 * Server layout: the skeleton is the static App Shell; the client shell (auth guard, sidebar, URL-aware nav)
 * streams in behind Suspense, as Next 16 Partial Prefetching requires for URL data.
 */
/**
 * Portal pages render only after the client restores the session (access token in memory, refresh via the
 * API's httpOnly cookie), so navigations are allowed to wait on that; opt out of instant-navigation checks.
 */
export const instant = false;

export default function PortalLayout({ children }: LayoutProps<'/'>) {
  return (
    <Suspense fallback={<PortalSkeleton />}>
      <PortalShell>{children}</PortalShell>
    </Suspense>
  );
}
