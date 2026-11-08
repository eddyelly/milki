import { format, formatDistanceToNowStrict } from 'date-fns';

export const fmtDate = (iso: string | null | undefined): string => (iso ? format(new Date(iso), 'd MMM yyyy') : '-');
export const fmtDateTime = (iso: string | null | undefined): string => (iso ? format(new Date(iso), 'd MMM yyyy, HH:mm') : '-');
export const fmtAgo = (iso: string | null | undefined): string => (iso ? `${formatDistanceToNowStrict(new Date(iso))} ago` : '-');

export const fmtArea = (sqm: number): string =>
  sqm >= 10_000 ? `${(sqm / 10_000).toLocaleString('en', { maximumFractionDigits: 2 })} ha` : `${sqm.toLocaleString('en', { maximumFractionDigits: 1 })} m²`;

export const fmtMoney = (amount: number, currency = 'TZS'): string =>
  new Intl.NumberFormat('en-TZ', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);

/** "a1b2c3…f9e8" for hashes and txIds (always rendered in JetBrains Mono). */
export const shortHash = (h: string | null | undefined, head = 8, tail = 6): string => (!h ? '-' : h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`);

export const titleCase = (s: string): string =>
  s
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

export const ROLE_LABEL: Record<string, string> = {
  CITIZEN: 'Landowner',
  LAND_OFFICER: 'Land officer',
  REGISTRAR: 'Registrar',
  BANK_OFFICER: 'Bank officer',
  SUPPORT_AGENT: 'Support agent',
  SYSTEM_ADMIN: 'System admin',
};

export const MSP_LABEL: Record<string, string> = { Org1MSP: 'Ministry', Org2MSP: 'Land Office', Org3MSP: 'Banks' };
