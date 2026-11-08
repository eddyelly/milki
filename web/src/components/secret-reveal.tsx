'use client';

import { KeyRound, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/**
 * Shows a secret exactly once (API keys, one-time passwords): the server keeps only a hash, so closing this dialog
 * is the last chance to copy it. The Done button stays disabled until the admin confirms they stored it.
 */
export function SecretReveal({ open, title, label, secret, note, onClose }: { open: boolean; title: string; label: string; secret: string | null; note?: string; onClose: () => void }) {
  const [stored, setStored] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && stored) {
          setStored(false);
          onClose();
        }
      }}
    >
      <DialogContent onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => !stored && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-gold-ink" aria-hidden /> {title}
          </DialogTitle>
          <DialogDescription>{note ?? 'Copy it now and send it securely. It will not be shown again.'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <div className="flex items-center gap-2 rounded-lg border border-gold/50 bg-gold/10 px-3 py-2">
            <code data-testid="secret-value" className="flex-1 font-mono text-sm break-all select-all">
              {secret}
            </code>
            {secret && <CopyButton value={secret} label={`Copy ${label.toLowerCase()}`} />}
          </div>
        </div>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          Milki stores only a hash. If it is lost, rotate or reset it.
        </p>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={stored} onChange={(e) => setStored(e.target.checked)} className="size-4 accent-[var(--primary)]" />
          I have copied and stored it safely
        </label>
        <DialogFooter>
          <Button
            disabled={!stored}
            onClick={() => {
              setStored(false);
              onClose();
            }}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
