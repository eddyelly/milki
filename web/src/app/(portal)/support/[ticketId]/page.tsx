import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { TicketPageClient } from './ticket-view';

/** Client view; renders after the session is restored, so navigations may wait (instant = false). */
export const instant = false;

export default function Page({ params }: PageProps<'/support/[ticketId]'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
      <TicketPageClient params={params} />
    </Suspense>
  );
}
