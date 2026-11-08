'use client';

import { FileSearch, ShieldCheck, ShieldX, Upload } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { type DragEvent, useRef, useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { sha256Hex } from '@/lib/actions';
import { http, toApiError } from '@/lib/api';
import { shortHash, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Verification {
  documentId: string;
  match: boolean;
  status: 'ACTIVE' | 'SUPERSEDED';
  version: number;
  latestDocumentId: string | null;
  parcelId: string;
  documentType: string;
  sha256: string;
}

/**
 * Verify a document against the ledger (CLAUDE.md §10.4): a scanline sweeps while it checks; a match flips in
 * the gold "Verified on Milki" badge, a mismatch shakes with an earth-coloured warning.
 */
export function VerifyView() {
  const reduce = useReducedMotion() ?? false;
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [localHash, setLocalHash] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Verification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setResult(null);
    setError(null);
    setLocalHash(await sha256Hex(f));
  };

  const check = async () => {
    if (!file) return;
    setChecking(true);
    setResult(null);
    setError(null);
    const started = Date.now();
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await http.post<{ data: Verification }>(`/documents/${documentId.trim().toUpperCase()}/verify`, form);
      // Let the scan read as a scan (≥700 ms), the answer itself comes straight from the ledger.
      await new Promise((res) => setTimeout(res, Math.max(0, (reduce ? 0 : 700) - (Date.now() - started))));
      setResult(r.data.data);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setChecking(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void pick(e.dataTransfer.files[0]);
  };

  const idOk = /^DOC-[A-Fa-f0-9]{16}$/.test(documentId.trim());

  return (
    <>
      <PageHeader title="Verify a document" description="Check that a copy you hold is exactly the file recorded on the ledger. The file is fingerprinted in your browser; only the fingerprint check touches the ledger." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>1 · The file</CardTitle>
            <CardDescription>PDF, JPEG or PNG up to 10 MB.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                'relative flex h-48 w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed bg-muted/30 text-center transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                dragging && 'border-primary bg-primary/5',
              )}
              aria-label="Choose a file to verify"
            >
              {checking && !reduce && (
                <motion.span
                  aria-hidden
                  className="absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-gold/45 to-transparent"
                  initial={{ top: '-20%' }}
                  animate={{ top: ['-20%', '100%'] }}
                  transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
              {file ? <FileSearch className="size-8 text-primary" aria-hidden /> : <Upload className="size-8 text-muted-foreground" aria-hidden />}
              <span className="font-medium">{file ? file.name : 'Drop a file here or click to choose'}</span>
              {localHash && (
                <span className="font-mono text-xs text-muted-foreground" title={localHash}>
                  SHA-256 {shortHash(localHash, 10, 8)}
                </span>
              )}
            </button>
            <input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} />
            <div className="space-y-1.5">
              <Label htmlFor="docid">2 · Document ID (printed on the certificate / QR)</Label>
              <Input id="docid" className="font-mono uppercase" placeholder="DOC-0A1B2C3D4E5F6789" value={documentId} onChange={(e) => setDocumentId(e.target.value)} />
            </div>
            <Button className="w-full" disabled={!file || !idOk || checking} onClick={() => void check()}>
              <ShieldCheck /> {checking ? 'Checking the ledger…' : 'Verify against the ledger'}
            </Button>
          </CardContent>
        </Card>

        <div className="flex items-center justify-center rounded-xl border bg-card p-6" aria-live="polite" style={{ perspective: 800 }}>
          <AnimatePresence mode="wait">
            {!result && !error && (
              <motion.p key="idle" exit={{ opacity: 0 }} className="max-w-xs text-center text-muted-foreground">
                The result appears here. Nothing is stored. This is a read-only check.
              </motion.p>
            )}
            {error && (
              <motion.p key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="alert" className="max-w-sm text-center font-medium text-destructive">
                {error}
              </motion.p>
            )}
            {result?.match && (
              <motion.div
                key="match"
                initial={reduce ? false : { rotateY: 90, opacity: 0 }}
                animate={{ rotateY: 0, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                className="w-full max-w-sm space-y-4 text-center"
              >
                <div
                  className="mx-auto grid size-28 place-items-center rounded-full"
                  style={{ background: 'radial-gradient(circle at 35% 30%, #F7DB8C, var(--gold) 55%, #C99A2E)', boxShadow: '0 10px 30px -10px rgba(201,154,46,0.65)' }}
                >
                  <ShieldCheck className="size-12 text-[#4A3608]" aria-hidden />
                </div>
                <div>
                  <p className="text-xl font-bold">Verified on Milki</p>
                  <p className="text-sm text-muted-foreground">This file’s fingerprint matches the ledger record exactly.</p>
                </div>
                <ResultFields r={result} />
                {result.status === 'SUPERSEDED' && result.latestDocumentId && (
                  <p className="rounded-md bg-warning/10 px-3 py-2 text-sm">
                    Note: this is an older version. The current one is <span className="font-mono">{result.latestDocumentId}</span>.
                  </p>
                )}
              </motion.div>
            )}
            {result && !result.match && (
              <motion.div
                key="mismatch"
                initial={reduce ? false : { opacity: 0, scale: 0.96 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, x: [0, -10, 10, -6, 6, -2, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                className="w-full max-w-sm space-y-4 rounded-xl border-2 p-5 text-center"
                style={{ borderColor: 'var(--earth)', background: 'color-mix(in oklab, var(--earth) 7%, transparent)' }}
              >
                <ShieldX className="mx-auto size-12" style={{ color: 'var(--earth)' }} aria-hidden />
                <div>
                  <p className="text-xl font-bold" style={{ color: 'var(--earth)' }}>
                    Does not match
                  </p>
                  <p className="text-sm text-muted-foreground">This file is different from the one recorded for {result.documentId}. Do not rely on it.</p>
                </div>
                <ResultFields r={result} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}

function ResultFields({ r }: { r: Verification }) {
  return (
    <dl className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-3 text-left text-sm">
      <dt className="text-muted-foreground">Document</dt>
      <dd className="font-mono text-xs">{r.documentId}</dd>
      <dt className="text-muted-foreground">Type</dt>
      <dd>
        {titleCase(r.documentType)} v{r.version}
      </dd>
      <dt className="text-muted-foreground">Parcel</dt>
      <dd>
        <Link href={`/parcels/${r.parcelId}`} className="font-mono text-xs text-primary hover:underline">
          {r.parcelId}
        </Link>
      </dd>
      <dt className="text-muted-foreground">Your file</dt>
      <dd className="flex items-center gap-1 font-mono text-xs">
        {shortHash(r.sha256)} <CopyButton value={r.sha256} label="Copy SHA-256" />
      </dd>
    </dl>
  );
}
