'use client';

import { Smartphone } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { Logo, TopoBackground } from '@/components/brand';
import { AppSidebar } from '@/components/shell/app-sidebar';
import { Topbar } from '@/components/shell/topbar';
import { Button } from '@/components/ui/button';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';

/** Signed-in staff shell: collapsible sidebar + top bar with ⌘K (CLAUDE.md §9.3). */
export function PortalShell({ children }: { children: ReactNode }) {
  const { status, user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, router, pathname]);

  if (status !== 'authenticated' || !user) return <PortalSkeleton />;

  // Landowners use the mobile app (CLAUDE.md §2).
  if (user.role === 'CITIZEN') {
    return (
      <main className="relative grid min-h-dvh place-items-center overflow-hidden p-6">
        <TopoBackground />
        <div className="relative max-w-md space-y-5 rounded-xl border bg-card p-8 text-center shadow-[var(--shadow-raised)]">
          <Logo className="justify-center" />
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-primary/10 text-primary">
            <Smartphone className="size-7" aria-hidden />
          </span>
          <h1 className="text-xl font-bold">Milki for landowners is on your phone</h1>
          <p className="text-muted-foreground">
            View your parcels, transfer land and verify documents in the Milki mobile app. This portal is for land officials, banks and support staff.
          </p>
          <p className="text-sm text-muted-foreground">Programu ya Milki kwa wamiliki wa ardhi inapatikana kwenye simu yako.</p>
          <Button variant="outline" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </main>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <Topbar />
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

export function PortalSkeleton() {
  return (
    <div className="flex min-h-dvh" aria-busy="true" aria-label="Loading">
      <div className="hidden w-64 bg-primary-deep md:block" />
      <div className="flex-1 space-y-4 p-6">
        <Skeleton className="h-9 w-72" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}
