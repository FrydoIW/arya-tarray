import { Prisma } from "@prisma/client";
export async function loadAssetControlTotals(tx: Prisma.TransactionClient) {
  const register = await tx.$queryRaw<Array<{ role: string; accountId: string; amount: Prisma.Decimal }>>`
    WITH extra AS (SELECT d.fixed_asset_id AS asset,SUM(l.debit) AS amount FROM arya_accounting_journal_draft d
      JOIN arya_accounting_journal_line l ON l.accounting_journal_line_id=d.asset_source_line_id
      JOIN arya_accounting_journal j ON j.accounting_journal_id=l.accounting_journal_id
      WHERE d.status='APPLIED' AND JSON_UNQUOTE(JSON_EXTRACT(d.asset_metadata,'$.action'))='ADDITIONAL'
        AND NOT EXISTS(SELECT 1 FROM arya_accounting_journal r WHERE r.reversal_of_journal_id=j.accounting_journal_id) GROUP BY d.fixed_asset_id),
    dep AS (SELECT x.fixed_asset_id AS asset,SUM(l.credit-l.debit) AS amount FROM arya_accounting_depreciation_run_asset x
      JOIN arya_accounting_depreciation_run run USING(depreciation_run_id) JOIN arya_accounting_journal j ON j.accounting_journal_id=run.posting_journal_id
      JOIN arya_accounting_journal_line l ON l.accounting_journal_line_id=x.accumulated_journal_line_id
      WHERE NOT EXISTS(SELECT 1 FROM arya_accounting_journal r WHERE r.reversal_of_journal_id=j.accounting_journal_id) GROUP BY x.fixed_asset_id),
    imp AS (SELECT d.fixed_asset_id AS asset,SUM(l.credit-l.debit) AS amount FROM arya_accounting_journal_draft d
      JOIN arya_accounting_journal j ON j.accounting_journal_id=d.posted_journal_id JOIN arya_accounting_journal_line l USING(accounting_journal_id)
      JOIN arya_accounting_account acct ON acct.accounting_account_id=l.accounting_account_id
      WHERE JSON_UNQUOTE(JSON_EXTRACT(d.asset_metadata,'$.action'))='IMPAIRMENT' AND acct.contra_flag=1 AND acct.account_type='ASSET'
        AND NOT EXISTS(SELECT 1 FROM arya_accounting_journal r WHERE r.reversal_of_journal_id=j.accounting_journal_id) GROUP BY d.fixed_asset_id)
    SELECT 'COST' AS role,c.asset_account_id AS accountId,SUM(l.debit+COALESCE(e.amount,0)) AS amount FROM arya_accounting_fixed_asset a
      JOIN arya_accounting_asset_category c USING(asset_category_id) JOIN arya_accounting_journal_line l ON l.accounting_journal_line_id=a.acquisition_journal_line_id
      LEFT JOIN extra e ON e.asset=a.fixed_asset_id WHERE a.status='ACTIVE' GROUP BY c.asset_account_id
    UNION ALL SELECT 'ACCUMULATED',c.accumulated_depreciation_account_id,SUM(COALESCE(d.amount,0)) FROM arya_accounting_fixed_asset a
      JOIN arya_accounting_asset_category c USING(asset_category_id) LEFT JOIN dep d ON d.asset=a.fixed_asset_id WHERE a.status='ACTIVE' GROUP BY c.accumulated_depreciation_account_id
    UNION ALL SELECT 'IMPAIRMENT',c.impairment_allowance_account_id,SUM(COALESCE(i.amount,0)) FROM arya_accounting_fixed_asset a
      JOIN arya_accounting_asset_category c USING(asset_category_id) LEFT JOIN imp i ON i.asset=a.fixed_asset_id WHERE a.status='ACTIVE' AND c.impairment_allowance_account_id IS NOT NULL GROUP BY c.impairment_allowance_account_id
    UNION ALL SELECT 'EXPENSE',l.accounting_account_id,SUM(l.debit-l.credit) FROM arya_accounting_depreciation_run_asset x
      JOIN arya_accounting_depreciation_run run USING(depreciation_run_id) JOIN arya_accounting_journal j ON j.accounting_journal_id=run.posting_journal_id
      JOIN arya_accounting_journal_line l ON l.accounting_journal_line_id=x.expense_journal_line_id
      WHERE NOT EXISTS(SELECT 1 FROM arya_accounting_journal r WHERE r.reversal_of_journal_id=j.accounting_journal_id) GROUP BY l.accounting_account_id`;
  const ledger = await tx.$queryRaw<Array<{ role: string; accountId: string; amount: Prisma.Decimal }>>`
    WITH maps AS (SELECT DISTINCT 'COST' AS role,asset_account_id AS account FROM arya_accounting_asset_category
      UNION SELECT 'ACCUMULATED',accumulated_depreciation_account_id FROM arya_accounting_asset_category
      UNION SELECT 'IMPAIRMENT',impairment_allowance_account_id FROM arya_accounting_asset_category WHERE impairment_allowance_account_id IS NOT NULL
      UNION SELECT 'EXPENSE',depreciation_expense_account_id FROM arya_accounting_asset_category)
    SELECT m.role,m.account AS accountId,COALESCE(SUM(CASE WHEN m.role IN ('ACCUMULATED','IMPAIRMENT') THEN l.credit-l.debit ELSE l.debit-l.credit END),0) AS amount
      FROM maps m LEFT JOIN arya_accounting_journal_line l ON l.accounting_account_id=m.account
      LEFT JOIN arya_accounting_journal j ON j.accounting_journal_id=l.accounting_journal_id LEFT JOIN arya_accounting_journal orig ON orig.accounting_journal_id=j.reversal_of_journal_id
      WHERE m.role<>'EXPENSE' OR l.accounting_journal_line_id IS NULL OR (j.journal_type<>'CLOSING' AND COALESCE(orig.journal_type,'')<>'CLOSING') GROUP BY m.role,m.account`;
  return { register, ledger };
}
