'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Logo, TopoBackground } from '@/components/brand';
import { OtpInput } from '@/components/otp-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { OtpChallenge } from '@/lib/types';

const credentialsSchema = z.object({
  identifier: z.string().trim().min(3, 'Enter your work email or phone number.'),
  password: z.string().min(1, 'Enter your password.'),
});
type Credentials = z.infer<typeof credentialsSchema>;

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

function Login() {
  const { status, startLogin, completeLogin, resendCode } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get('next') ?? '/dashboard';
  const reduce = useReducedMotion();
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const form = useForm<Credentials>({ resolver: zodResolver(credentialsSchema), defaultValues: { identifier: '', password: '' } });

  useEffect(() => {
    if (status === 'authenticated') router.replace(next);
  }, [status, next, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submitCredentials = form.handleSubmit(async (values) => {
    setBusy(true);
    setError(null);
    try {
      setChallenge(await startLogin(values.identifier, values.password));
      setCode('');
      setCooldown(30);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  });

  const verify = async (value = code) => {
    if (!challenge || value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await completeLogin(challenge.challengeId, value);
      router.replace(next);
    } catch (e) {
      setError(toApiError(e).message);
      setCode('');
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!challenge) return;
    setError(null);
    try {
      setChallenge(await resendCode(challenge.challengeId));
      setCode('');
      setCooldown(30);
    } catch (e) {
      setError(toApiError(e).message);
    }
  };

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-primary-deep text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <TopoBackground className="[--contour:rgba(242,201,96,0.16)]" />
        <Logo inverted className="relative text-white" />
        <div className="relative max-w-md space-y-4">
          <p className="text-3xl leading-tight font-bold">Ardhi yako, kumbukumbu ya kudumu.</p>
          <p className="text-lg text-white/80">Your land, a permanent record — every registration, transfer and mortgage sealed on a shared ledger.</p>
          <ul className="space-y-2 pt-2 text-sm text-white/75">
            <li className="flex items-center gap-2"><ShieldCheck className="size-4 text-gold" aria-hidden /> Ministry, Land Office and banks sign every change together</li>
            <li className="flex items-center gap-2"><LockKeyhole className="size-4 text-gold" aria-hidden /> Sale prices and NIDA numbers never touch the public ledger</li>
          </ul>
        </div>
        <p className="relative text-xs text-white/60">Ministry of Lands, Housing and Human Settlements Development</p>
      </section>

      <section className="relative flex items-center justify-center overflow-hidden p-6">
        <TopoBackground className="lg:hidden" />
        <Card className="relative w-full max-w-md shadow-[var(--shadow-raised)]">
          <CardHeader className="space-y-3">
            <Logo className="lg:hidden" />
            <CardTitle className="text-xl">{challenge ? 'Enter your code' : 'Sign in to the portal'}</CardTitle>
            <CardDescription>
              {challenge ? `We sent a 6-digit code to ${challenge.sentTo}. It expires in 5 minutes.` : 'For land officers, registrars, bank officers and support staff.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AnimatePresence mode="wait" initial={false}>
              {!challenge ? (
                <motion.form
                  key="credentials"
                  onSubmit={submitCredentials}
                  className="space-y-4"
                  initial={reduce ? false : { opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduce ? undefined : { opacity: 0, x: -16 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  noValidate
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="identifier">Email or phone number</Label>
                    <Input id="identifier" autoComplete="username" autoFocus placeholder="name@lands.go.tz" aria-invalid={Boolean(form.formState.errors.identifier)} {...form.register('identifier')} />
                    {form.formState.errors.identifier && <p className="text-sm text-destructive">{form.formState.errors.identifier.message}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password">Password</Label>
                    <Input id="password" type="password" autoComplete="current-password" aria-invalid={Boolean(form.formState.errors.password)} {...form.register('password')} />
                    {form.formState.errors.password && <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>}
                  </div>
                  {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p>}
                  <Button type="submit" className="w-full" disabled={busy || status === 'loading'}>
                    {busy && <Loader2 className="animate-spin" />} Continue
                  </Button>
                  {process.env.NODE_ENV === 'development' && (
                    <p className="text-center text-xs text-muted-foreground">
                      Dev: registrar@milki.dev · Milki@2026 — codes arrive in Mailpit (localhost:8126)
                    </p>
                  )}
                </motion.form>
              ) : (
                <motion.div
                  key="otp"
                  className="space-y-5"
                  initial={reduce ? false : { opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduce ? undefined : { opacity: 0, x: 16 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  <OtpInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} disabled={busy} invalid={Boolean(error)} autoFocus />
                  {error && <p role="alert" className="text-center text-sm font-medium text-destructive">{error}</p>}
                  <Button className="w-full" onClick={() => void verify()} disabled={busy || code.length !== 6}>
                    {busy && <Loader2 className="animate-spin" />} Verify and sign in
                  </Button>
                  <div className="flex items-center justify-between text-sm">
                    <button type="button" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => { setChallenge(null); setError(null); }}>
                      <ArrowLeft className="size-4" /> Back
                    </button>
                    <button type="button" className="font-medium text-primary disabled:text-muted-foreground" disabled={cooldown > 0} onClick={() => void resend()}>
                      {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
