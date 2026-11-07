'use client';

import { KeyRound, Landmark, Loader2, MessageSquareText, ShieldAlert, TriangleAlert } from 'lucide-react';
import { type ReactElement, type ReactNode, useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { OtpInput } from '@/components/otp-input';
import { type SealStage, SealedOnLedger } from '@/components/sealed-on-ledger';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { send, toApiError } from '@/lib/api';
import { useLedgerSocket } from '@/lib/socket';
import type { OtpChallenge, Submitted } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * T1 Standard: summary → Confirm → toast.
 * T2 Destructive: red; type the identifier to enable; consequences stated.
 * T3 Ledger: impact summary → "permanent and publicly auditable" → re-authentication → sealed-on-ledger animation.
 * (CLAUDE.md §8 — every mutation in the portal goes through this component.)
 */
export type Tier = 'T1' | 'T2' | 'T3';

export interface ImpactRow {
  label: string;
  value: ReactNode;
  mono?: boolean;
}

export interface ConfirmContext {
  /** Stable for this dialog session, so a retry never writes twice. */
  idempotencyKey: string;
  /** T3 only: single-use token from POST /auth/reauth. */
  reauthToken?: string;
}

export interface ConfirmActionProps<R> {
  tier: Tier;
  trigger: ReactElement;
  title: string;
  description?: ReactNode;
  /** T3 headline, e.g. "Ownership of DSM-KIN-12-45 will move from Asha M. to Juma H." */
  impactSentence?: ReactNode;
  impact?: ImpactRow[];
  consequences?: string[];
  /** Typed confirmation (T2, and T3 cancel/reject which are also destructive). */
  typeToConfirm?: string;
  /** Extra inputs on the review step (reason, notes…). */
  children?: ReactNode;
  /** Parent-controlled validity of `children` inputs. */
  canConfirm?: boolean;
  confirmLabel?: string;
  successMessage?: string;
  onConfirm: (ctx: ConfirmContext) => Promise<R>;
  onSuccess?: (result: R) => void;
  onOpenChange?: (open: boolean) => void;
}

type Step = 'review' | 'reauth' | 'sealing';

export function ConfirmAction<R>(props: ConfirmActionProps<R>) {
  const { tier, title, typeToConfirm } = props;
  const { waitForCommit } = useLedgerSocket();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('review');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [seal, setSeal] = useState<{ stage: SealStage; txId?: string; blockNumber?: number; error?: string }>({ stage: 'submitting' });
  const keyRef = useRef<string>('');

  // re-auth state
  const [mode, setMode] = useState<'password' | 'otp'>('password');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [code, setCode] = useState('');

  const destructive = tier === 'T2' || Boolean(typeToConfirm);
  const typedOk = !typeToConfirm || typed.trim() === typeToConfirm;
  const reviewOk = typedOk && props.canConfirm !== false;

  const reset = () => {
    setStep('review');
    setPending(false);
    setError(null);
    setTyped('');
    setPassword('');
    setChallenge(null);
    setCode('');
    setMode('password');
    setSeal({ stage: 'submitting' });
  };

  const changeOpen = (next: boolean) => {
    if (pending && !next) return; // never close mid-request
    if (next) {
      reset();
      keyRef.current = crypto.randomUUID();
    }
    setOpen(next);
    props.onOpenChange?.(next);
  };

  const finish = useCallback(
    (result: R) => {
      if (props.successMessage) toast.success(props.successMessage);
      props.onSuccess?.(result);
    },
    [props],
  );

  /** T1/T2: run immediately. */
  const runDirect = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await props.onConfirm({ idempotencyKey: keyRef.current });
      setPending(false);
      setOpen(false);
      finish(result);
    } catch (e) {
      setPending(false);
      setError(toApiError(e).message);
    }
  };

  /** T3: re-authenticate, submit, then wait for the commit. */
  const runLedger = async () => {
    setPending(true);
    setError(null);
    let reauthToken: string;
    try {
      const body = mode === 'password' ? { password } : { challengeId: challenge?.challengeId, code };
      reauthToken = (await send<{ reauthToken: string }>('post', '/auth/reauth', body)).reauthToken;
    } catch (e) {
      setPending(false);
      setError(toApiError(e).message);
      return;
    }
    setStep('sealing');
    setSeal({ stage: 'submitting' });
    let result: R;
    try {
      result = await props.onConfirm({ idempotencyKey: keyRef.current, reauthToken });
    } catch (e) {
      // Endorsement refused (a chaincode guard) — nothing was written. Back to review with the reason.
      setPending(false);
      setStep('review');
      setError(toApiError(e).message);
      return;
    }
    const txId = (result as Partial<Submitted> | undefined)?.txId;
    if (!txId) {
      setPending(false);
      setSeal({ stage: 'committed' });
      finish(result);
      return;
    }
    setSeal({ stage: 'endorsing', txId });
    try {
      const status = await waitForCommit(txId);
      setSeal({ stage: 'committed', txId, blockNumber: status.blockNumber });
      finish(result);
    } catch (e) {
      setSeal({ stage: 'failed', txId, error: (e as Error).message });
    } finally {
      setPending(false);
    }
  };

  const sendCode = async () => {
    setPending(true);
    setError(null);
    try {
      setChallenge(await send<OtpChallenge>('post', '/auth/reauth/otp', {}));
      setCode('');
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setPending(false);
    }
  };

  const reauthReady = mode === 'password' ? password.length > 0 : Boolean(challenge) && code.length === 6;

  return (
    <AlertDialog open={open} onOpenChange={changeOpen}>
      <AlertDialogTrigger asChild>{props.trigger}</AlertDialogTrigger>
      <AlertDialogContent
        data-tier={tier}
        className={cn('sm:max-w-lg', destructive && step === 'review' && 'border-destructive/40')}
        onEscapeKeyDown={(e) => pending && e.preventDefault()}
      >
        {step !== 'sealing' && (
          <AlertDialogHeader>
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  'grid size-10 shrink-0 place-items-center rounded-full',
                  destructive ? 'bg-destructive/12 text-destructive' : tier === 'T3' ? 'bg-gold/20 text-gold-ink' : 'bg-primary/12 text-primary',
                )}
                aria-hidden
              >
                {destructive ? <TriangleAlert className="size-5" /> : tier === 'T3' ? <Landmark className="size-5" /> : <MessageSquareText className="size-5" />}
              </span>
              <div className="text-left">
                <AlertDialogTitle>{step === 'reauth' ? 'Confirm it’s you' : title}</AlertDialogTitle>
                {tier === 'T3' && (
                  <p className="text-xs font-medium text-muted-foreground">
                    Ledger action · step {step === 'review' ? 1 : 2} of 2
                  </p>
                )}
              </div>
            </div>
            {step === 'review' && props.description && <AlertDialogDescription className="text-left">{props.description}</AlertDialogDescription>}
            {step === 'reauth' && (
              <AlertDialogDescription className="text-left">Writing to the land register needs a fresh confirmation of your identity.</AlertDialogDescription>
            )}
          </AlertDialogHeader>
        )}

        {step === 'review' && (
          <div className="space-y-4">
            {props.impactSentence && (
              <p className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2.5 text-sm font-medium" data-testid="impact-sentence">
                {props.impactSentence}
              </p>
            )}
            {props.impact && props.impact.length > 0 && (
              <dl className="divide-y rounded-lg border bg-muted/40 text-sm">
                {props.impact.map((row) => (
                  <div key={row.label} className="flex justify-between gap-4 px-3 py-2">
                    <dt className="text-muted-foreground">{row.label}</dt>
                    <dd className={cn('text-right font-medium', row.mono && 'font-mono text-xs')}>{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {props.consequences && props.consequences.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {props.consequences.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
            {props.children}
            {tier === 'T3' && (
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-gold-ink" aria-hidden />
                This is permanent and publicly auditable. It will be signed with your ledger identity and recorded on the Milki blockchain.
              </p>
            )}
            {typeToConfirm && (
              <div className="space-y-1.5">
                <Label htmlFor="type-to-confirm">
                  Type <span className="font-mono font-semibold">{typeToConfirm}</span> to confirm
                </Label>
                <Input
                  id="type-to-confirm"
                  autoComplete="off"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  aria-invalid={typed.length > 0 && !typedOk}
                  className="font-mono"
                />
              </div>
            )}
          </div>
        )}

        {step === 'reauth' && (
          <div className="space-y-4">
            {mode === 'password' ? (
              <div className="space-y-1.5">
                <Label htmlFor="reauth-password">Password</Label>
                <Input
                  id="reauth-password"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && reauthReady && !pending && void runLedger()}
                />
              </div>
            ) : challenge ? (
              <div className="space-y-2 text-center">
                <p className="text-sm text-muted-foreground">Enter the code sent to {challenge.sentTo}</p>
                <OtpInput value={code} onChange={setCode} autoFocus disabled={pending} />
              </div>
            ) : (
              <Button type="button" variant="outline" className="w-full" onClick={() => void sendCode()} disabled={pending}>
                <MessageSquareText /> Send a code to my phone
              </Button>
            )}
            <button
              type="button"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              onClick={() => {
                setError(null);
                setMode(mode === 'password' ? 'otp' : 'password');
              }}
            >
              {mode === 'password' ? 'Use a code sent to my phone instead' : 'Use my password instead'}
            </button>
          </div>
        )}

        {step === 'sealing' && (
          <>
            <AlertDialogTitle className="sr-only">{title}</AlertDialogTitle>
            <SealedOnLedger stage={seal.stage} txId={seal.txId} blockNumber={seal.blockNumber} error={seal.error} />
          </>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
            {error}
          </p>
        )}

        <AlertDialogFooter>
          {step === 'sealing' ? (
            <Button className="press" onClick={() => changeOpen(false)} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              {pending ? 'Waiting for the ledger…' : 'Done'}
            </Button>
          ) : (
            <>
              <Button variant="outline" className="press" onClick={() => (step === 'reauth' ? setStep('review') : changeOpen(false))} disabled={pending}>
                {step === 'reauth' ? 'Back' : 'Cancel'}
              </Button>
              {step === 'review' && tier !== 'T3' && (
                <Button variant={destructive ? 'destructive' : 'default'} className="press" disabled={!reviewOk || pending} onClick={() => void runDirect()}>
                  {pending && <Loader2 className="animate-spin" />}
                  {props.confirmLabel ?? 'Confirm'}
                </Button>
              )}
              {step === 'review' && tier === 'T3' && (
                <Button
                  variant={destructive ? 'destructive' : 'default'}
                  className="press"
                  disabled={!reviewOk}
                  onClick={() => {
                    setError(null);
                    setStep('reauth');
                  }}
                >
                  <KeyRound /> Continue
                </Button>
              )}
              {step === 'reauth' && (
                <Button variant={destructive ? 'destructive' : 'default'} className="press" disabled={!reauthReady || pending} onClick={() => void runLedger()}>
                  {pending && <Loader2 className="animate-spin" />}
                  {props.confirmLabel ?? 'Sign and record'}
                </Button>
              )}
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
