import type {
  Account,
  AccountKind,
  Alias,
  ISOTime,
  Owner,
  Settings,
  Snapshot,
  SyncedState,
  UUID,
} from './types';
import { combinedDailySeries, effectiveSnapshots, toDay, type SeriesPoint } from '../logic/progress';

/**
 * Domain mutations. Each takes the current state and returns a new state;
 * persistence and re-render happen in the store. All LWW records are stamped
 * with { updatedAt: now, updatedBy: deviceId } so merges resolve correctly.
 */

export interface Ctx {
  deviceId: string;
  now?: ISOTime;
}

function stamp(ctx: Ctx) {
  return { updatedAt: ctx.now ?? new Date().toISOString(), updatedBy: ctx.deviceId };
}

export interface NewAccount {
  name: string;
  institution: string;
  kind: AccountKind;
  owner: Owner;
  openingBalance: number | null; // minor units; creates the first snapshot
}

export function addAccount(state: SyncedState, ctx: Ctx, input: NewAccount): { state: SyncedState; account: Account } {
  const meta = stamp(ctx);
  const account: Account = {
    id: crypto.randomUUID(),
    name: input.name,
    institution: input.institution,
    kind: input.kind,
    owner: input.owner,
    archived: false,
    createdAt: meta.updatedAt,
    ...meta,
  };
  let snapshots = state.snapshots;
  if (input.openingBalance !== null) {
    snapshots = [
      ...snapshots,
      {
        id: crypto.randomUUID(),
        accountId: account.id,
        balance: input.openingBalance,
        at: meta.updatedAt,
        deviceId: ctx.deviceId,
        createdAt: meta.updatedAt,
      },
    ];
  }
  return { state: { ...state, accounts: [...state.accounts, account], snapshots }, account };
}

export function updateAccount(
  state: SyncedState,
  ctx: Ctx,
  id: UUID,
  changes: Partial<Pick<Account, 'name' | 'institution' | 'kind' | 'owner' | 'archived'>>,
): SyncedState {
  return {
    ...state,
    accounts: state.accounts.map((a) => (a.id === id ? { ...a, ...changes, ...stamp(ctx) } : a)),
  };
}

export function addSnapshots(
  state: SyncedState,
  ctx: Ctx,
  entries: { accountId: UUID; balance: number; at?: ISOTime }[],
): SyncedState {
  const now = ctx.now ?? new Date().toISOString();
  const snapshots: Snapshot[] = entries.map((e) => ({
    id: crypto.randomUUID(),
    accountId: e.accountId,
    balance: e.balance,
    at: e.at ?? now,
    deviceId: ctx.deviceId,
    createdAt: now,
  }));
  return { ...state, snapshots: [...state.snapshots, ...snapshots] };
}

export function voidSnapshot(state: SyncedState, ctx: Ctx, snapshotId: UUID): SyncedState {
  if (state.voids.some((v) => v.snapshotId === snapshotId)) return state;
  const now = ctx.now ?? new Date().toISOString();
  return {
    ...state,
    voids: [...state.voids, { snapshotId, at: now, deviceId: ctx.deviceId }],
  };
}

export function addAlias(state: SyncedState, ctx: Ctx, name: string, accountId: UUID): SyncedState {
  const meta = stamp(ctx);
  const alias: Alias = {
    id: crypto.randomUUID(),
    name,
    accountId,
    history: [{ accountId, from: meta.updatedAt }],
    archived: false,
    createdAt: meta.updatedAt,
    ...meta,
  };
  return { ...state, aliases: [...state.aliases, alias] };
}

export function updateAlias(
  state: SyncedState,
  ctx: Ctx,
  id: UUID,
  changes: Partial<Pick<Alias, 'name' | 'archived'>>,
): SyncedState {
  return {
    ...state,
    aliases: state.aliases.map((a) => (a.id === id ? { ...a, ...changes, ...stamp(ctx) } : a)),
  };
}

/** Re-point an alias at a different account, preserving its history. */
export function repointAlias(state: SyncedState, ctx: Ctx, id: UUID, accountId: UUID): SyncedState {
  const meta = stamp(ctx);
  return {
    ...state,
    aliases: state.aliases.map((a) =>
      a.id === id
        ? {
            ...a,
            accountId,
            history: [...a.history, { accountId, from: meta.updatedAt }],
            ...meta,
          }
        : a,
    ),
  };
}

export function updateSettings(
  state: SyncedState,
  ctx: Ctx,
  changes: Partial<Omit<Settings, 'id' | 'updatedAt' | 'updatedBy'>>,
): SyncedState {
  return { ...state, settings: { ...state.settings, ...changes, ...stamp(ctx) } };
}

// ---- queries ----

/** Latest effective balance per account id. */
export function latestBalances(state: SyncedState): Map<UUID, Snapshot> {
  const out = new Map<UUID, Snapshot>();
  for (const s of effectiveSnapshots(state.snapshots, state.voids)) {
    out.set(s.accountId, s); // effective order: later readings overwrite
  }
  return out;
}

export function aliasForAccount(state: SyncedState, accountId: UUID): Alias | undefined {
  return state.aliases.find((al) => !al.archived && al.accountId === accountId);
}

/**
 * An alias's balance series stitches together the snapshots of whichever
 * account it pointed to during each interval of its history, so switching
 * banks continues the chart with no reset.
 */
export function aliasSeries(state: SyncedState, alias: Alias, today: string): SeriesPoint[] {
  const epochs = [...alias.history].sort((a, b) => a.from.localeCompare(b.from));
  const effective = effectiveSnapshots(state.snapshots, state.voids);
  const stitched: Snapshot[] = [];
  for (let i = 0; i < epochs.length; i++) {
    const from = toDay(epochs[i].from);
    const until = i + 1 < epochs.length ? toDay(epochs[i + 1].from) : null;
    for (const s of effective) {
      if (s.accountId !== epochs[i].accountId) continue;
      const day = toDay(s.at);
      // First epoch also claims the account's earlier history (pre-alias).
      if (i > 0 && day < from) continue;
      if (until !== null && day >= until) continue;
      stitched.push(s);
    }
  }
  // Treat the stitched readings as one virtual account for carry-forward.
  const virtual = stitched
    .map((s) => ({ ...s, accountId: alias.id }))
    .sort((a, b) => a.at.localeCompare(b.at) || a.createdAt.localeCompare(b.createdAt));
  return combinedDailySeries(virtual, today);
}
