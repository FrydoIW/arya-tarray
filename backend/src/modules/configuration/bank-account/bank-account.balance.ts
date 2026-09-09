export type MoneyValue = { toString(): string } | string | null | undefined;

export type BankBalanceMovement = {
  bankAccountId: string;
  finalizedIncoming: MoneyValue;
  finalizedOutgoing: MoneyValue;
  pendingMovement: MoneyValue;
};

function moneyToCents(value: MoneyValue) {
  const normalized = value?.toString() ?? "0";
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) throw new Error(`Invalid database monetary value: ${normalized}`);
  const cents = BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  return match[1] === "-" ? -cents : cents;
}

function centsToMoney(cents: bigint) {
  const sign = cents < 0n ? "-" : "";
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

export function calculateBankBalance(input: {
  openingBalance: MoneyValue;
  openingBalanceDate: Date | string | null | undefined;
  finalizedIncoming?: MoneyValue;
  finalizedOutgoing?: MoneyValue;
  pendingMovement?: MoneyValue;
}) {
  if (input.openingBalance == null || input.openingBalanceDate == null) {
    return {
      configured: false as const,
      finalizedIncoming: null,
      finalizedOutgoing: null,
      reconciledBalance: null,
      pendingMovement: null
    };
  }

  const openingCents = moneyToCents(input.openingBalance);
  const incomingCents = moneyToCents(input.finalizedIncoming);
  const outgoingCents = moneyToCents(input.finalizedOutgoing);
  const pendingCents = moneyToCents(input.pendingMovement);

  return {
    configured: true as const,
    finalizedIncoming: centsToMoney(incomingCents),
    finalizedOutgoing: centsToMoney(outgoingCents),
    reconciledBalance: centsToMoney(openingCents + incomingCents - outgoingCents),
    pendingMovement: centsToMoney(pendingCents)
  };
}

export function openingBalanceCanBeChanged(input: {
  openingBalanceLockedAt: Date | null;
  statementCount: number;
}) {
  return input.openingBalanceLockedAt == null && input.statementCount === 0;
}
