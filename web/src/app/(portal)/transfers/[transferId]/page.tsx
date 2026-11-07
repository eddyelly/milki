import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { TransferPageClient } from './transfer-view';

/** Client view; renders after the session is restored, so navigations may wait (instant = false). */
export const instant = false;

/** URL data (transferId) is read behind Suspense so the route's App Shell stays URL-independent (Next 16). */
export default function Page({ params }: PageProps<'/transfers/[transferId]'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
      <TransferPageClient params={params} />
    </Suspense>
  );
}
