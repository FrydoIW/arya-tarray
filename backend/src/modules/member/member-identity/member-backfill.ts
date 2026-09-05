import { collectIdentityObservations, type DiscoveryTransaction } from "./member-identity.service.js";
import { observedIdentity } from "./member-identity.utils.js";
import { storedTransactionRequiresClassification } from "../../reconciliation/reconciliation-classification.js";

export type BackfillMode = "dry-run" | "apply" | "help";
export type BackfillOptions = { mode: BackfillMode; batchSize: number; limit?: number };
export type BackfillIdentityState = { identityKey: string; verificationStatus: string; memberId: string | null };

export type BackfillDryRunCounts = {
  scannedTransactions: number;
  eligibleIncomingTransactions: number;
  alreadyLinkedTransactions: number;
  skippedNonIncomingTransactions: number;
  skippedUnusableSenderIdentities: number;
  distinctIdentityKeys: number;
  identitiesWouldBeReused: number;
  identitiesWouldBeCreated: number;
  transactionsWouldBeLinked: number;
  verifiedIdentitiesWithMembers: number;
  unverifiedIdentities: number;
  conflicts: number;
  errors: number;
};

const integerOption = (value: string, name: string, minimum: number, maximum: number) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  return number;
};

export function parseBackfillOptions(args: string[]): BackfillOptions {
  let mode: BackfillMode | undefined;
  let batchSize = 500;
  let limit: number | undefined;
  for (const arg of args) {
    if (arg === "--dry-run" || arg === "--apply" || arg === "--help") {
      const next = arg.slice(2) as BackfillMode;
      if (mode && mode !== next) throw new Error("Choose exactly one of --dry-run, --apply, or --help");
      mode = next;
    } else if (arg.startsWith("--batch-size=")) batchSize = integerOption(arg.slice(13), "--batch-size", 1, 5000);
    else if (arg.startsWith("--limit=")) limit = integerOption(arg.slice(8), "--limit", 1, 10_000_000);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!mode) throw new Error("A safe explicit mode is required: --dry-run or --apply");
  if (mode === "help" && args.length > 1) throw new Error("--help cannot be combined with other options");
  return { mode, batchSize, ...(limit ? { limit } : {}) };
}

export class BackfillDryRunAnalyzer {
  private readonly distinctKeys = new Set<string>();
  private readonly projectedNewKeys = new Set<string>();
  private readonly countedExistingKeys = new Set<string>();
  readonly counts: BackfillDryRunCounts = {
    scannedTransactions: 0, eligibleIncomingTransactions: 0, alreadyLinkedTransactions: 0,
    skippedNonIncomingTransactions: 0, skippedUnusableSenderIdentities: 0, distinctIdentityKeys: 0,
    identitiesWouldBeReused: 0, identitiesWouldBeCreated: 0, transactionsWouldBeLinked: 0,
    verifiedIdentitiesWithMembers: 0, unverifiedIdentities: 0, conflicts: 0, errors: 0
  };

  async analyzeBatch(rows: DiscoveryTransaction[], findByKeys: (keys: string[]) => Promise<BackfillIdentityState[]>) {
    this.counts.scannedTransactions += rows.length;
    for (const row of rows) {
      if (row.memberIdentityId) this.counts.alreadyLinkedTransactions++;
      if (!storedTransactionRequiresClassification(row)) {
        this.counts.skippedNonIncomingTransactions++;
        continue;
      }
      this.counts.eligibleIncomingTransactions++;
      if (row.memberIdentityId) continue;
      if (!observedIdentity(row)) {
        this.counts.skippedUnusableSenderIdentities++;
        continue;
      }
      this.counts.transactionsWouldBeLinked++;
    }

    const { observations } = collectIdentityObservations(rows);
    const keys = observations.map(item => item.identityKey);
    keys.forEach(key => this.distinctKeys.add(key));
    const existing = keys.length ? await findByKeys(keys) : [];
    const existingByKey = new Map(existing.map(identity => [identity.identityKey, identity]));
    for (const observation of observations) {
      const identity = existingByKey.get(observation.identityKey);
      if (identity) {
        if (this.countedExistingKeys.has(identity.identityKey)) continue;
        this.countedExistingKeys.add(identity.identityKey);
        this.counts.identitiesWouldBeReused++;
        if (identity.verificationStatus === "VERIFIED" && identity.memberId) this.counts.verifiedIdentitiesWithMembers++;
        else if (identity.verificationStatus === "UNVERIFIED" && !identity.memberId) this.counts.unverifiedIdentities++;
        else if (identity.verificationStatus === "IGNORED" && !identity.memberId) {
          // IGNORED is an intentional terminal review state; reuse/link semantics remain identical to live Execute.
        } else this.counts.conflicts++;
      } else if (!this.projectedNewKeys.has(observation.identityKey)) {
        this.projectedNewKeys.add(observation.identityKey);
        this.counts.identitiesWouldBeCreated++;
      }
    }
    this.counts.distinctIdentityKeys = this.distinctKeys.size;
    return { ...this.counts };
  }
}
