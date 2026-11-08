'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { BadgeCheck, ChevronLeft, FilePlus2, Loader2, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { ConfirmAction } from '@/components/confirm-action';
import { EmptyState, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ledgerWrite } from '@/lib/actions';
import { get, toApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtArea, titleCase } from '@/lib/format';
import { REGIONS } from '@/lib/regions';
import { LAND_USES } from '@/lib/types';

const schema = z.object({
  regionCode: z.string().min(3, 'Choose a region.'),
  districtCode: z.string().trim().regex(/^[A-Za-z]{2,4}$/, '2–4 letters, e.g. KIN for Kinondoni.'),
  district: z.string().trim().min(2, 'Enter the district.').max(80),
  ward: z.string().trim().min(2, 'Enter the ward.').max(80),
  blockNumber: z.string().trim().regex(/^[0-9A-Za-z]{1,8}$/, '1–8 letters or digits.'),
  plotNumber: z.string().trim().regex(/^[0-9A-Za-z]{1,8}$/, '1–8 letters or digits.'),
  titleNumber: z.string().trim().regex(/^[A-Za-z0-9/-]{1,40}$/, 'Letters, digits, / and - only.'),
  area: z.number({ message: 'Enter the area in m².' }).positive('Area must be greater than zero.'),
  landUse: z.enum(LAND_USES),
  latitude: z.number({ message: 'Enter a latitude.' }).min(-12, 'Tanzania lies between −12° and −1° latitude.').max(-0.9, 'Tanzania lies between −12° and −1° latitude.'),
  longitude: z.number({ message: 'Enter a longitude.' }).min(29, 'Tanzania lies between 29° and 41° longitude.').max(41, 'Tanzania lies between 29° and 41° longitude.'),
  address: z.string().trim().max(200).optional(),
});
type FormValues = z.infer<typeof schema>;

interface OwnerMatch {
  userId: string;
  displayName: string;
}

export function RegisterParcelView() {
  const { hasRole } = useAuth();
  const router = useRouter();
  const doneRef = useRef<string | null>(null);
  const [owner, setOwner] = useState<OwnerMatch | null>(null);
  const [lookupBy, setLookupBy] = useState<'phone' | 'nida'>('phone');
  const [lookupValue, setLookupValue] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: { regionCode: 'DSM', districtCode: '', district: '', ward: '', blockNumber: '', plotNumber: '', titleNumber: '', landUse: 'RESIDENTIAL', address: '' },
  });
  const v = form.watch();
  const errors = form.formState.errors;
  const parcelId = [v.regionCode, v.districtCode, v.blockNumber, v.plotNumber].every(Boolean)
    ? `${v.regionCode}-${v.districtCode}-${v.blockNumber}-${v.plotNumber}`.toUpperCase()
    : null;
  const region = REGIONS.find((r) => r.code === v.regionCode)?.name ?? '';

  if (!hasRole('REGISTRAR')) {
    return <EmptyState title="Registrars only" description="Only a registrar can add parcels to the register." />;
  }

  const lookup = async () => {
    setLooking(true);
    setLookupError(null);
    setOwner(null);
    try {
      setOwner((await get<OwnerMatch>('/users/lookup', { [lookupBy]: lookupValue })).data);
    } catch (e) {
      setLookupError(toApiError(e).message);
    } finally {
      setLooking(false);
    }
  };

  const field = (name: keyof FormValues, label: string, props: Record<string, unknown> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        aria-invalid={Boolean(errors[name])}
        {...form.register(name, props.type === 'number' ? { setValueAs: (x: string) => (x === '' ? undefined : Number(x)) } : {})}
        {...props}
      />
      {errors[name] && <p className="text-sm text-destructive">{errors[name]?.message}</p>}
    </div>
  );

  return (
    <>
      <Link href="/parcels" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> Parcels
      </Link>
      <PageHeader title="Register a parcel" description="Adds the parcel to the land register on the ledger, in the name of an existing Milki landowner." />

      <form className="grid gap-4 lg:grid-cols-3" onSubmit={(e) => e.preventDefault()} noValidate>
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Location & identifiers</CardTitle>
              <CardDescription>The parcel ID is built from the region, district code, block and plot.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="regionCode">Region</Label>
                <Controller
                  control={form.control}
                  name="regionCode"
                  render={({ field: f }) => (
                    <Select value={f.value} onValueChange={f.onChange}>
                      <SelectTrigger id="regionCode" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REGIONS.map((r) => (
                          <SelectItem key={r.code} value={r.code}>
                            {r.name} ({r.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              {field('district', 'District', { placeholder: 'Kinondoni' })}
              {field('districtCode', 'District code', { placeholder: 'KIN', className: 'font-mono uppercase' })}
              {field('ward', 'Ward', { placeholder: 'Mikocheni' })}
              {field('blockNumber', 'Block', { placeholder: '12', className: 'font-mono' })}
              {field('plotNumber', 'Plot', { placeholder: '45', className: 'font-mono' })}
              {field('titleNumber', 'Title number', { placeholder: 'DSM/KIN/2026/0045', className: 'font-mono' })}
              <div className="space-y-1.5">
                <Label>Parcel ID</Label>
                <p className="flex h-9 items-center rounded-md border bg-muted/50 px-3 font-mono text-sm font-semibold" aria-live="polite">
                  {parcelId ?? '-'}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Land</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {field('area', 'Area (m²)', { type: 'number', min: 1, step: '0.01', placeholder: '650.5' })}
              <div className="space-y-1.5">
                <Label htmlFor="landUse">Land use</Label>
                <Controller
                  control={form.control}
                  name="landUse"
                  render={({ field: f }) => (
                    <Select value={f.value} onValueChange={f.onChange}>
                      <SelectTrigger id="landUse" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LAND_USES.map((u) => (
                          <SelectItem key={u} value={u}>
                            {titleCase(u)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              {field('latitude', 'Latitude', { type: 'number', step: '0.00001', placeholder: '-6.7631' })}
              {field('longitude', 'Longitude', { type: 'number', step: '0.00001', placeholder: '39.2462' })}
              <div className="sm:col-span-2">{field('address', 'Address / landmark (optional, no personal data)', { placeholder: 'Plot 45, Block 12, Mikocheni' })}</div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Registered owner</CardTitle>
              <CardDescription>The owner must already have a verified Milki account.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Tabs value={lookupBy} onValueChange={(x) => setLookupBy(x as 'phone' | 'nida')}>
                <TabsList className="w-full">
                  <TabsTrigger value="phone">Phone</TabsTrigger>
                  <TabsTrigger value="nida">NIDA number</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="flex gap-2">
                <Input
                  aria-label={lookupBy === 'phone' ? 'Owner phone number' : 'Owner NIDA number'}
                  value={lookupValue}
                  onChange={(e) => {
                    setLookupValue(e.target.value);
                    setOwner(null);
                  }}
                  placeholder={lookupBy === 'phone' ? '0712 345 678' : '19900101-12345-00001-01'}
                  className="font-mono"
                />
                <Button type="button" variant="outline" onClick={() => void lookup()} disabled={looking || lookupValue.trim().length < 6}>
                  {looking ? <Loader2 className="animate-spin" /> : <Search />} Find
                </Button>
              </div>
              {lookupError && <p className="text-sm text-destructive">{lookupError}</p>}
              {owner && (
                <p className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
                  <BadgeCheck className="size-4 text-primary" aria-hidden />
                  <span>
                    <strong>{owner.displayName}</strong> <span className="font-mono text-xs text-muted-foreground">{owner.userId}</span>
                  </span>
                </p>
              )}
            </CardContent>
          </Card>

          <ConfirmAction
            tier="T3"
            title="Register parcel"
            trigger={
              <Button type="button" className="w-full" size="lg" disabled={!form.formState.isValid || !owner || !parcelId}>
                <FilePlus2 /> Review and register
              </Button>
            }
            impactSentence={
              <>
                Parcel <span className="font-mono">{parcelId}</span> will be registered to <strong>{owner?.displayName}</strong>.
              </>
            }
            impact={[
              { label: 'Title number', value: v.titleNumber, mono: true },
              { label: 'Location', value: `${v.ward}, ${v.district}, ${region}` },
              { label: 'Area', value: v.area ? fmtArea(v.area) : '-' },
              { label: 'Land use', value: titleCase(v.landUse) },
            ]}
            successMessage={`${parcelId} registered.`}
            onConfirm={(ctx) => {
              const x = form.getValues();
              return ledgerWrite(
                'post',
                '/parcels',
                {
                  parcelId,
                  titleNumber: x.titleNumber,
                  region,
                  district: x.district,
                  ward: x.ward,
                  blockNumber: x.blockNumber,
                  plotNumber: x.plotNumber,
                  area: x.area,
                  landUse: x.landUse,
                  location: { latitude: x.latitude, longitude: x.longitude, address: x.address || null },
                  owner: { userId: owner?.userId },
                },
                ctx,
              );
            }}
            onSuccess={() => {
              doneRef.current = parcelId;
            }}
            onOpenChange={(open) => {
              if (!open && doneRef.current) router.push(`/parcels/${doneRef.current}`);
            }}
          />
        </div>
      </form>
    </>
  );
}
