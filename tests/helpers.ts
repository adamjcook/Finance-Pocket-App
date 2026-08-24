import type { Account, Alias, Settings, Snapshot, SyncedState } from '../src/model/types';
import { emptyState } from '../src/model/types';

let counter = 0;
export function uid(prefix = 'id'): string {
  return `${prefix}-${String(++counter).padStart(4, '0')}`;
}

export function account(overrides: Partial<Account> = {}): Account {
  return {
    id: uid('acc'),
    name: 'Test account',
    institution: 'Test bank',
    kind: 'credit_card',
    owner: 'A',
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'device-a',
    ...overrides,
  };
}

export function alias(overrides: Partial<Alias> = {}): Alias {
  const accountId = overrides.accountId ?? uid('acc');
  return {
    id: uid('alias'),
    name: 'Main Savings',
    accountId,
    history: [{ accountId, from: '2026-01-01T00:00:00.000Z' }],
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'device-a',
    ...overrides,
  };
}

export function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    id: uid('snap'),
    accountId: 'acc-x',
    balance: 100_00,
    at: '2026-01-01T00:00:00.000Z',
    deviceId: 'device-a',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    id: 'settings',
    partnerAName: 'Sam',
    partnerBName: 'Alex',
    currency: 'GBP',
    debtBaselineMinor: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'device-a',
    ...overrides,
  };
}

export function state(overrides: Partial<SyncedState> = {}): SyncedState {
  return { ...emptyState(), settings: settings(), ...overrides };
}
