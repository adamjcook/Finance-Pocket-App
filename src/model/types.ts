export type UUID = string;
export type ISOTime = string;

/** Stamped on every last-write-wins-merged record. */
export interface Meta {
  updatedAt: ISOTime;
  updatedBy: string; // deviceId that made the change
}

export type AccountKind = 'credit_card' | 'loan' | 'savings' | 'investment' | 'checking' | 'other';
export type Owner = 'A' | 'B' | 'joint';

export interface Account extends Meta {
  id: UUID;
  name: string;
  institution: string;
  kind: AccountKind;
  owner: Owner;
  archived: boolean; // soft delete AND sync tombstone — never hard-delete
  createdAt: ISOTime;
}

export interface AliasEpoch {
  accountId: UUID;
  from: ISOTime;
}

export interface Alias extends Meta {
  id: UUID;
  name: string;
  accountId: UUID | null; // currently pointed account
  history: AliasEpoch[]; // append-only repoint log, travels inside the LWW record
  archived: boolean;
  createdAt: ISOTime;
}

/** Append-only, immutable balance reading. Union-merged by id, never edited. */
export interface Snapshot {
  id: UUID;
  accountId: UUID;
  /** Minor units (pence). Credit cards store the amount OWED as a positive number. */
  balance: number;
  at: ISOTime; // effective time (user can backdate)
  deviceId: string;
  createdAt: ISOTime;
}

/** Undo for a mistyped snapshot without breaking append-only semantics. */
export interface SnapshotVoid {
  snapshotId: UUID;
  at: ISOTime;
  deviceId: string;
}

export interface Settings extends Meta {
  id: 'settings';
  partnerAName: string;
  partnerBName: string;
  currency: string; // ISO 4217, display-only
  /** Manual debt baseline override in minor units; null = auto (peak recorded debt). */
  debtBaselineMinor: number | null;
  /**
   * Goal fields were added after v1 shipped, so records synced from an older
   * app may lack them — read sites treat undefined as null.
   */
  /** Date (YYYY-MM-DD) by which the credit cards should be cleared; null = no goal. */
  debtTargetDate?: string | null;
  /** Date (YYYY-MM-DD) by which the loans should be cleared; null = no goal. */
  loanTargetDate?: string | null;
  /** Savings & investments target in minor units; null = no goal. */
  savingsTargetMinor?: number | null;
  /** Optional date (YYYY-MM-DD) to reach the savings target by. */
  savingsTargetDate?: string | null;
  /**
   * Partner identity colours (CSS hex), used for names, owner dots, and
   * section markers. Added after v1 shipped — undefined reads as the
   * default teal/amber.
   */
  partnerAColor?: string;
  partnerBColor?: string;
}

export const DEFAULT_PARTNER_A_COLOR = '#4fd1a5';
export const DEFAULT_PARTNER_B_COLOR = '#f2a65a';

/** Local-only device identity and sync bookkeeping. NEVER synced. */
export interface DeviceState {
  id: 'device';
  deviceId: UUID;
  lastSyncAt: ISOTime | null;
  lastSyncStateHash: string | null;
}

/** Everything that syncs between the two phones. */
export interface SyncedState {
  settings: Settings;
  accounts: Account[];
  aliases: Alias[];
  snapshots: Snapshot[];
  voids: SnapshotVoid[];
}

export interface SyncPayload extends SyncedState {
  v: 1;
  deviceId: string;
  sentAt: ISOTime;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  partnerAName: 'Partner A',
  partnerBName: 'Partner B',
  currency: 'GBP',
  debtBaselineMinor: null,
  debtTargetDate: null,
  loanTargetDate: null,
  savingsTargetMinor: null,
  savingsTargetDate: null,
  partnerAColor: DEFAULT_PARTNER_A_COLOR,
  partnerBColor: DEFAULT_PARTNER_B_COLOR,
  updatedAt: new Date(0).toISOString(),
  updatedBy: '',
};

export function emptyState(): SyncedState {
  return {
    settings: { ...DEFAULT_SETTINGS },
    accounts: [],
    aliases: [],
    snapshots: [],
    voids: [],
  };
}

export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  credit_card: 'Credit card',
  loan: 'Loan',
  savings: 'Savings',
  investment: 'Investment',
  checking: 'Current account',
  other: 'Other',
};

/** Kinds counted in the card-payoff headline and goal. Loans stay separate. */
export const DEBT_KINDS: AccountKind[] = ['credit_card'];
/** Kinds shown in the dashboard Loans card. */
export const LOAN_KINDS: AccountKind[] = ['loan'];
/** Kinds counted in the combined savings + investments headline. */
export const GROWTH_KINDS: AccountKind[] = ['savings', 'investment'];
/** Kinds where the balance is money owed, not money held. */
export const OWED_KINDS: AccountKind[] = ['credit_card', 'loan'];
