'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { type ReactNode, useState } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ApiError } from '@/lib/api';
import { AuthProvider } from '@/lib/auth';
import { SocketProvider } from '@/lib/socket';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            // Client errors (403/404/400) won't fix themselves; only retry network/server trouble.
            retry: (count, err) => count < 2 && ((err as ApiError).status ?? 0) >= 500,
          },
        },
      }),
  );
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <SocketProvider>
            <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
            <Toaster richColors closeButton position="top-right" />
          </SocketProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
