import type { SyncPayload } from '../model/types';
import { DEFAULT_PARTNER_A_COLOR, DEFAULT_PARTNER_B_COLOR } from '../model/types';

/**
 * Realistic seed data for the dev deployment (see vite.config.ts /
 * .env.dev-pages) — only reachable when VITE_DEV_BUILD is set, so this
 * never ships as reachable UI in the real app. Loaded via the same
 * window.__syncTest.importPayload hook the e2e tests use.
 */

const day = (offset: number) => new Date(Date.now() - offset * 86400000).toISOString();
const meta = (offset: number) => ({ updatedAt: day(offset), updatedBy: 'mock-device' });

function account(
  id: string,
  name: string,
  institution: string,
  kind: 'credit_card' | 'loan' | 'savings' | 'investment',
  owner: 'A' | 'B' | 'joint',
  offset = 200,
) {
  return { id, name, institution, kind, owner, archived: false, createdAt: day(offset), ...meta(offset) };
}

function snapshot(accountId: string, balance: number, offset: number) {
  return { id: crypto.randomUUID(), accountId, balance, at: day(offset), deviceId: 'mock-device', createdAt: day(offset) };
}

export function buildMockPayload(): SyncPayload {
  return {
    v: 1,
    deviceId: 'mock-device',
    sentAt: day(0),
    settings: {
      id: 'settings',
      partnerAName: 'Adam',
      partnerBName: 'Sam',
      currency: 'GBP',
      debtBaselineMinor: null,
      debtTargetDate: '2027-06-01',
      loanTargetDate: '2027-10-01',
      savingsTargetMinor: 25000_00,
      savingsTargetDate: '2027-12-01',
      partnerAColor: DEFAULT_PARTNER_A_COLOR,
      partnerBColor: DEFAULT_PARTNER_B_COLOR,
      ...meta(0),
    },
    accounts: [
      account('mock-cc-1', 'Barclaycard', 'Barclays', 'credit_card', 'A'),
      account('mock-cc-2', 'Amex Gold', 'American Express', 'credit_card', 'B'),
      account('mock-ln-1', 'Car Loan', 'Santander', 'loan', 'joint'),
      account('mock-sv-1', 'Marcus Saver', 'Goldman Sachs', 'savings', 'joint'),
      account('mock-iv-1', 'Vanguard ISA', 'Vanguard', 'investment', 'joint'),
    ],
    aliases: [],
    snapshots: [
      snapshot('mock-ln-1', 11800_00, 180), snapshot('mock-ln-1', 10400_00, 120),
      snapshot('mock-ln-1', 9200_00, 60), snapshot('mock-ln-1', 8700_00, 14),
      snapshot('mock-cc-1', 4300_00, 180), snapshot('mock-cc-2', 2450_00, 180),
      snapshot('mock-cc-1', 3600_00, 120), snapshot('mock-cc-2', 2100_00, 120),
      snapshot('mock-cc-1', 2900_00, 60), snapshot('mock-cc-2', 1500_00, 60),
      snapshot('mock-cc-1', 2150_00, 14), snapshot('mock-cc-2', 900_00, 14),
      snapshot('mock-sv-1', 5200_00, 180), snapshot('mock-iv-1', 8100_00, 180),
      snapshot('mock-sv-1', 6400_00, 120), snapshot('mock-iv-1', 8900_00, 120),
      snapshot('mock-sv-1', 7900_00, 60), snapshot('mock-iv-1', 9800_00, 60),
      snapshot('mock-sv-1', 8750_00, 14), snapshot('mock-iv-1', 10900_00, 14),
    ],
    voids: [],
  };
}

export async function loadMockData(): Promise<void> {
  await window.__syncTest.importPayload(buildMockPayload());
}
