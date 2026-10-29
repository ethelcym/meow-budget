# Legacy app import — design proposal (no production import)

User request: preserve or import old app historical transactions into Meow Budget while starting a clean November 2026 ledger. Legacy app previously referenced as Shareroo; confirm source and export format before coding an importer.

## Safety rules
- Do not import before receiving and inspecting an actual user-provided CSV/JSON export. Never guess its schema or treat it as Meow-native JSON.
- Preserve historical original dates, currency, amounts, type, payer, group, and notes when present. Mark unknown payer/split as unknown; never silently assume 50/50.
- Import to an isolated preview first, show mapping and a dry-run report: row counts, date range, duplicates, invalid rows, unknown categories, amounts, and resulting totals.
- Stable source transaction IDs or canonical fingerprints must prevent repeated import duplicating entries.
- Preserve existing categories and budgets. Create category mappings only with user approval.
- November fresh start must remain separate from historical import: filter dashboard/settlements to November onward if user chooses archive history. Existing analytics currently include historical transactions by date and could affect views; do not claim isolation until implemented and tested.
- Never use importBackup() for migration: it replaces the entire state, including settings.
- Back up source export and destination state securely before any real import; do not upload financial data to GitHub.
- Ask whether the goal is (a) full historical transaction import with pre-November archived views or (b) summary-only historical balances. Default proposal is (a), pending confirmation.

## Pending information
- Which old app (Shareroo or another)?
- Which export formats are available (CSV, Excel, JSON)?
- Does source export include per-person split, settlements and reimbursements?
- Should historic entries be read-only, or editable?

Status: planning only; no legacy records imported and no production data changed.
