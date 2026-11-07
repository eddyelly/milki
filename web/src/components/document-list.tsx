'use client';

import { Download, FileText, Loader2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { CopyButton } from '@/components/copy-button';
import { EmptyState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { downloadDocument } from '@/lib/actions';
import { toApiError } from '@/lib/api';
import { fmtDate, ROLE_LABEL, shortHash, titleCase } from '@/lib/format';
import type { DocumentRef } from '@/lib/types';

const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Documents attached on-chain (hash) with files in MinIO. Downloads are ledger-verified by the API. */
export function DocumentList({ documents }: { documents: DocumentRef[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (documents.length === 0) return <EmptyState icon={<FileText className="size-6" />} title="No documents attached" description="Uploaded files appear here once their fingerprint is recorded on the ledger." />;

  const download = async (d: DocumentRef) => {
    setBusy(d.documentId);
    try {
      const { verified } = await downloadDocument(d.documentId, d.file?.name ?? `${d.documentId}.pdf`);
      if (verified) toast.success('Downloaded — fingerprint matches the ledger.');
    } catch (e) {
      toast.error(toApiError(e).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className="divide-y rounded-xl border bg-card">
      {documents.map((d) => (
        <li key={d.documentId} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <FileText className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="flex flex-wrap items-center gap-2 font-medium">
              {titleCase(d.documentType)}
              {d.version > 1 && <Badge variant="secondary">v{d.version}</Badge>}
              {d.status === 'SUPERSEDED' && <Badge variant="outline">Superseded</Badge>}
            </p>
            <p className="truncate text-sm text-muted-foreground">
              {d.file?.name ?? 'File'}
              {d.file ? ` · ${size(d.file.size)}` : ''} · {fmtDate(d.createdAt)} · {ROLE_LABEL[d.createdBy.role ?? ''] ?? 'Unknown'}
            </p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              SHA-256 <span className="font-mono">{shortHash(d.sha256, 10, 8)}</span>
              <CopyButton value={d.sha256} label="Copy SHA-256" />
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void download(d)} disabled={!d.file || busy === d.documentId}>
            {busy === d.documentId ? <Loader2 className="animate-spin" /> : <Download />}
            Download
            <ShieldCheck className="text-primary" aria-label="verified against the ledger" />
          </Button>
        </li>
      ))}
    </ul>
  );
}
