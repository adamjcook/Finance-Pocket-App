import type { PaydayRule } from '../../worker/src/payday';
export type UUID = string;
export type ISOTime = string;

/** Stamped on every last-write-wins-merged record. */
export interface Meta {
  updatedAt: ISOTime;
  updatedBy: string; // deviceId that made the change
}

export type AccountKind =
  | 'credit_card'
  | 'loan'
  | 'savings'
  | 'investment'
  | 'checking'
  | 'other'
  /** Locked away until retirement: its own card, never counted in net worth. */
  | 'pension'
  /** A child's Junior ISA: their money, so its own card and never in net worth. */
  | 'junior_isa';
export type Owner = 'A' | 'B' | 'joint';

export interface Account extends Meta {
  id: UUID;
  name: string;
  institution: string;
  kind: AccountKind;
  owner: Owner;
  archived: boolean; // soft delete AND sync tombstone — never hard-delete
  /**
   * When it was archived; null/absent while active. Totals count an archived
   * account's history up to this moment and nothing after. Records archived
   * before this field existed lack it — read sites fall back to updatedAt.
   */
  archivedAt?: ISOTime | null;
  createdAt: ISOTime;
  /**
   * Fields added after v1 shipped — records from older app versions lack
   * them, so read sites treat undefined as null.
   */
  /** Savings/investment pot goal in minor units; null = no goal. */
  goalMinor?: number | null;
  /**
   * Savings/investment pots: optional date (YYYY-MM-DD) to reach goalMinor by.
   * Credit cards and loans: the date to pay the account off by.
   */
  goalDate?: string | null;
  /** Credit cards: date (YYYY-MM-DD) the 0% deal ends; null = none. */
  promoEndsOn?: string | null;
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
  /**
   * Which partner typed it in (from the saving phone's "whose phone is
   * this?"), so the other phone can say who did an update. Absent on older
   * records, automatic readings and phones that haven't said whose they are.
   */
  by?: 'A' | 'B' | null;
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
   * Retired whole-household goals, replaced by per-account goals (see
   * Account.goalMinor / goalDate). Still read once to migrate older data
   * (migrateSettingsGoals in repo.ts), then cleared.
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
   * Retired: partner colours once chosen at setup for owner bars on the
   * Accounts page. No longer shown or set; kept so older records still type.
   */
  partnerAColor?: string;
  partnerBColor?: string;
  /**
   * Trading 212 daily-value link (see worker/ and src/integrations/t212.ts).
   * Synced so both phones import the same readings into the same account.
   * Added after v1 shipped — undefined reads as "not linked".
   */
  t212?: T212Link | null;
  /**
   * Each partner's payday (see worker/src/payday.ts). Shared, so both phones
   * work out the same payday window. Absent = the default rule.
   */
  paydayA?: PaydayRule | null;
  paydayB?: PaydayRule | null;
}

export interface T212Link {
  /** The FinPair account the daily readings are recorded against. */
  accountId: UUID;
  /** Base URL of the finpair-t212 Worker, e.g. https://finpair-t212.<you>.workers.dev */
  endpoint: string;
  /** The Worker's FINPAIR_TOKEN. Only unlocks reading the daily totals. */
  token: string;
}

/** The latest Trading 212 reading this phone has seen (amounts in minor units). */
export interface T212Reading {
  day: string;
  at: ISOTime;
  currency: string;
  totalMinor: number;
  costMinor: number;
  unrealisedMinor: number;
  final: boolean;
}

/** This phone's view of the Trading 212 link: when it last checked and what it found. */
export interface T212DeviceStatus {
  checkedAt: ISOTime;
  /** Problem from this phone's last check, or from the Worker's last scheduled reading. */
  error: string | null;
  latest: T212Reading | null;
}

/** Currencies offered at setup and in Settings (display-only; amounts aren't converted). */
export const CURRENCIES = ['GBP', 'EUR', 'USD'];

/** 'system' follows the phone's own light/dark setting; dark stays the default. */
export type Theme = 'dark' | 'light' | 'system';

/**
 * Home's cards. Savings goals live inside the savings card; pensions and
 * Junior ISAs share one compact 'held' card. (Phones that stored the older
 * 'goals', 'pension' or 'junior' keys have them dropped on load.)
 */
export type DashboardSectionKey = 'growth' | 'debt' | 'loans' | 'held';
// Clearing the card debt is the first job, so it leads on a new phone.
export const DEFAULT_DASHBOARD_ORDER: DashboardSectionKey[] = ['debt', 'growth', 'loans', 'held'];

/** Which reminders this phone wants (Settings → Reminders). */
export interface ReminderPrefs {
  monthly: boolean; // payday: update balances
  promo: boolean; // a card's 0% deal is ending
  drop: boolean; // the Trading 212 account fell 5%+ in a week
  /** Your partner saved a payday update (automatic sync). Absent on older phones = on. */
  partner?: boolean;
}

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = { monthly: true, promo: true, drop: true, partner: true };

/** This phone's push-notification registration with the Worker. */
export interface PushDeviceState {
  enabled: boolean;
  prefs: ReminderPrefs;
  /** Fingerprint of what was last sent to the Worker, to resend only on change. */
  sentHash: string | null;
}

/** Local-only device identity, sync bookkeeping, and display prefs. NEVER synced. */
export interface DeviceState {
  id: 'device';
  deviceId: UUID;
  lastSyncAt: ISOTime | null;
  lastSyncStateHash: string | null;
  /** Appearance preference for this phone only — not shared with the partner's. */
  theme: Theme;
  /** Dashboard card order for this phone only — drag-to-reorder, not shared with the partner's. */
  dashboardOrder: DashboardSectionKey[];
  /** Last Trading 212 check on this phone (added later — absent until the first one). */
  t212?: T212DeviceStatus | null;
  /** Reminder notifications on this phone (added later — absent until turned on). */
  push?: PushDeviceState | null;
  /**
   * Which of the two partners this phone belongs to, so Settings can say
   * "You" and "Your partner". Absent on phones set up before it existed.
   */
  me?: 'A' | 'B' | null;
  /** What Home's news line has shown or been told to drop, on this phone. */
  news?: import('../logic/news').NewsMemory | null;
  /** Automatic sync through the Worker (see sync/relay.ts). Never synced itself. */
  relay?: RelayDeviceState | null;
  /** This phone's view of the latest payday update's card: celebrated yet, dismissed. */
  checkIn?: { key: string; celebrated: boolean; dismissed: boolean } | null;
}

/** This phone's side of automatic sync. */
export interface RelayDeviceState {
  /**
   * The key both phones encrypt with (AES-256, base64url). Made on a phone
   * and handed to the other inside the QR codes only — never in backup
   * files, never sent to the Worker.
   */
  key: string;
  /** The pair's channel on the Worker: a fingerprint of `key` (see relayChannel). */
  channel?: string;
  /** Absent = on: automatic sync runs once the phones share a key and a Worker. */
  enabled?: boolean;
  /** Fingerprint of the data last uploaded, so unchanged data isn't re-sent. */
  pushedHash?: string | null;
  /** The partner copy last merged, per phone (its upload time). */
  seen?: Record<string, string>;
  /**
   * Fingerprint (check code) of the partner's latest copy, so Home can say
   * whether the two phones hold the same data without asking the other one.
   */
  partnerHash?: string | null;
  /** Last time the partner's copy was checked, and any problem doing so. */
  checkedAt?: string | null;
  error?: string | null;
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
  /** Only in QR transfers: the automatic-sync key, so the two phones share it. */
  relayKey?: string;
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
  t212: null,
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
  pension: 'Pension',
  junior_isa: 'Junior ISA',
};

/** Kinds counted in the card-payoff headline and goal. Loans stay separate. */
export const DEBT_KINDS: AccountKind[] = ['credit_card'];
/** Kinds shown in the dashboard Loans card. */
export const LOAN_KINDS: AccountKind[] = ['loan'];
/** Kinds counted in the combined savings + investments headline. */
export const GROWTH_KINDS: AccountKind[] = ['savings', 'investment'];
/** Kinds where the balance is money owed, not money held. */
export const OWED_KINDS: AccountKind[] = ['credit_card', 'loan'];
/** Pensions: their own card, left out of net worth (the money isn't usable). */
export const PENSION_KINDS: AccountKind[] = ['pension'];
/** Children's accounts: their own card, left out of net worth (it's their money). */
export const JUNIOR_KINDS: AccountKind[] = ['junior_isa'];
/** Kinds that can have a target to save up to (a "pot" goal). */
export const POT_KINDS: AccountKind[] = [...GROWTH_KINDS, ...PENSION_KINDS, ...JUNIOR_KINDS];
/** Every kind that's money held rather than owed, with its own Home card. */
export const HELD_KINDS: AccountKind[] = POT_KINDS;
