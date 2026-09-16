import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  applyTimeRuleUpdate,
  applyTimeRuleUpdatesAtomic,
  executeTimeRules
} from "../src/modules/configuration/event-code/event-time-rule.service.js";
import { timeRuleBulkExecuteSchema } from "../src/modules/configuration/event-code/event-time-rule.schema.js";

type RuleUpdate = { eventCodeId: string; input: { unitAmount: string; durationMonths: number; activeFlag: boolean; remark: string | null } };
type StoredRule = RuleUpdate["input"] & { eventCodeId: string };
type Runner = Parameters<typeof applyTimeRuleUpdatesAtomic>[0];
type ServiceClient = Parameters<typeof executeTimeRules>[2];

function ruleUpdate(eventCodeId: string, unitAmount: string, durationMonths = 1): RuleUpdate {
  return { eventCodeId, input: { unitAmount, durationMonths, activeFlag: true, remark: null } };
}

function harness(options: {
  events: Record<string, { code: string; eventType: string; activeFlag: boolean }>;
  unresolved?: string[];
  carry?: string[];
}) {
  let working: StoredRule[] = [];
  const committed: StoredRule[] = [];
  const tx = {
    eventCode: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const event = options.events[where.id];
        return event ? { id: where.id, ...event } : null;
      }
    },
    bankTransaction: {
      findFirst: async ({ where }: { where: { eventCodeId: string } }) =>
        (options.unresolved ?? []).includes(where.eventCodeId) ? { id: `tx-${where.eventCodeId}` } : null
    },
    memberEventBalanceLedger: {
      groupBy: async ({ where }: { where: { subscription: { eventCodeId: string } } }) =>
        (options.carry ?? []).includes(where.subscription.eventCodeId)
          ? [{ subscriptionId: `sub-${where.subscription.eventCodeId}`, _sum: { amountDelta: new Prisma.Decimal("25000.00") } }]
          : []
    },
    eventTimeRule: {
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        const write: StoredRule = {
          eventCodeId: String(create.eventCodeId),
          unitAmount: String(create.unitAmount),
          durationMonths: Number(create.durationMonths),
          activeFlag: Boolean(create.activeFlag),
          remark: (create.remark ?? null) as string | null
        };
        working.push(write);
        return write;
      }
    }
  } as unknown as Prisma.TransactionClient;
  const client = {
    $transaction: async <T,>(work: (transaction: Prisma.TransactionClient) => Promise<T>) => {
      working = [];
      const result = await work(tx);
      committed.push(...working);
      return result;
    },
    eventTimeRule: {
      findMany: async () => committed.map((rule) => {
        const event = options.events[rule.eventCodeId];
        return {
          eventCodeId: rule.eventCodeId,
          unitAmount: new Prisma.Decimal(rule.unitAmount),
          durationMonths: rule.durationMonths,
          activeFlag: rule.activeFlag,
          remark: rule.remark,
          updatedAt: new Date("2026-09-17T00:00:00.000Z"),
          eventCode: {
            id: rule.eventCodeId,
            code: event?.code ?? "000",
            eventName: event ? `Event ${event.code}` : "Unknown",
            eventType: event?.eventType ?? "TIME_BASED",
            activeFlag: event?.activeFlag ?? true
          }
        };
      })
    }
  };
  return { tx, client, committed };
}

test("bulk Time Rule schema accepts multiple updates and rejects empty or duplicate Event Codes", () => {
  const firstCode = "11111111-1111-4111-8111-111111111111";
  const secondCode = "22222222-2222-4222-8222-222222222222";
  const parsed = timeRuleBulkExecuteSchema.parse({ updates: [ruleUpdate(firstCode, "50000"), ruleUpdate(secondCode, "75000", 2)] });
  assert.equal(parsed.updates.length, 2);
  assert.throws(() => timeRuleBulkExecuteSchema.parse({ updates: [] }), /No Time Rule changes to Execute/);
  assert.throws(
    () => timeRuleBulkExecuteSchema.parse({ updates: [ruleUpdate(firstCode, "50000"), ruleUpdate(firstCode, "75000")] }),
    /one staged Time Rule/i
  );
});

test("multiple staged Time Rules commit together inside one atomic execute", async () => {
  const h = harness({
    events: {
      a: { code: "001", eventType: "TIME_BASED", activeFlag: true },
      b: { code: "002", eventType: "TIME_BASED", activeFlag: true }
    }
  });
  await applyTimeRuleUpdatesAtomic(h.client as unknown as Runner, {
    updates: [ruleUpdate("a", "50000"), ruleUpdate("b", "75000", 3)]
  }, "admin");
  assert.deepEqual(
    h.committed.map(rule => [rule.eventCodeId, Number(rule.unitAmount), rule.durationMonths, rule.activeFlag]),
    [["a", 50000, 1, true], ["b", 75000, 3, true]]
  );
});

test("a guard failure rolls back every staged Time Rule and identifies the affected Event Code", async () => {
  const h = harness({
    events: {
      a: { code: "001", eventType: "TIME_BASED", activeFlag: true },
      b: { code: "058", eventType: "TIME_BASED", activeFlag: true }
    },
    unresolved: ["b"]
  });
  await assert.rejects(
    () => applyTimeRuleUpdatesAtomic(h.client as unknown as Runner, {
      updates: [ruleUpdate("a", "50000"), ruleUpdate("b", "75000")]
    }, "admin"),
    /Event Code 058: Resolve or allocate pending TIME_BASED payments/
  );
  assert.equal(h.committed.length, 0);
});

test("bulk execute returns EventTimeRule summaries with string unit amounts after commit", async () => {
  const h = harness({ events: { a: { code: "091", eventType: "TIME_BASED", activeFlag: true } } });
  const result = await executeTimeRules(
    { updates: [ruleUpdate("a", "50000")] },
    "admin",
    h.client as unknown as ServiceClient
  );
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 1);
  assert.equal(result[0].eventCodeId, "a");
  assert.equal(result[0].unitAmount, "50000");
  assert.equal(result[0].eventCode.code, "091");
});

test("existing single-rule business guards remain intact", async () => {
  const notTimeBased = harness({ events: { x: { code: "010", eventType: "STANDARD", activeFlag: true } } });
  await assert.rejects(
    () => applyTimeRuleUpdate(notTimeBased.tx, ruleUpdate("x", "50000"), "admin"),
    /Event Code 010 must be a TIME_BASED Event Code/
  );

  const inactive = harness({ events: { x: { code: "010", eventType: "TIME_BASED", activeFlag: false } } });
  await assert.rejects(
    () => applyTimeRuleUpdate(inactive.tx, ruleUpdate("x", "50000"), "admin"),
    /Event Code 010 must be active/
  );

  const missing = harness({ events: {} });
  await assert.rejects(
    () => applyTimeRuleUpdate(missing.tx, ruleUpdate("x", "50000"), "admin"),
    /must be a TIME_BASED Event Code/
  );

  const unresolved = harness({ events: { x: { code: "058", eventType: "TIME_BASED", activeFlag: true } }, unresolved: ["x"] });
  await assert.rejects(
    () => applyTimeRuleUpdate(unresolved.tx, ruleUpdate("x", "50000"), "admin"),
    /Event Code 058: Resolve or allocate pending TIME_BASED payments/
  );

  const carry = harness({ events: { x: { code: "091", eventType: "TIME_BASED", activeFlag: true } }, carry: ["x"] });
  await assert.rejects(
    () => applyTimeRuleUpdate(carry.tx, ruleUpdate("x", "50000"), "admin"),
    /Event Code 091: Resolve outstanding TIME_BASED carry balances/
  );

  const ok = harness({ events: { x: { code: "091", eventType: "TIME_BASED", activeFlag: true } } });
  await applyTimeRuleUpdatesAtomic(ok.client as unknown as Runner, { updates: [ruleUpdate("x", "50000", 2)] }, "admin");
  assert.equal(ok.committed.length, 1);
  assert.equal(Number(ok.committed[0].unitAmount), 50000);
  assert.equal(ok.committed[0].durationMonths, 2);
  assert.equal(ok.committed[0].remark, null);
});

test("bulk execute keeps one transaction, the bulk schema, and the historical guard strings", () => {
  const service = readFileSync(new URL("../src/modules/configuration/event-code/event-time-rule.service.ts", import.meta.url), "utf8");
  const controller = readFileSync(new URL("../src/modules/configuration/event-code/event-code.controller.ts", import.meta.url), "utf8");
  assert.equal((service.match(/\$transaction\(/g) ?? []).length, 1);
  assert.match(service, /applyTimeRuleUpdatesAtomic\(client/);
  assert.match(service, /return getTimeRuleSummaries\(client\)/);
  assert.match(service, /must be a TIME_BASED Event Code/);
  assert.match(service, /must be active/);
  assert.match(service, /Resolve or allocate pending TIME_BASED payments/);
  assert.match(service, /status: "FINALIZED"[\s\S]*memberEventBalanceLedger/);
  assert.match(service, /assertNoOutstandingTimeBasedCarry\(balances\)/);
  assert.doesNotMatch(service, /executeTimeRuleChange\b/);
  assert.match(controller, /timeRuleBulkExecuteSchema\.parse\(req\.body\)/);
  assert.match(controller, /executeTimeRules\(/);
});
