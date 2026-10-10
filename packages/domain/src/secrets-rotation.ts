import type { Database } from '@leadora/database';
import { sql } from 'drizzle-orm';
import { decryptSecret, encryptSecret } from './secrets';

/**
 * Re-encrypts every secret sealed with DATA_ENCRYPTION_KEY (see docs/RUNBOOK.md, "Rotate DATA_ENCRYPTION_KEY").
 *
 * Sealed values live in text columns named `*_enc` (found from the catalog, so new ones are covered) and in
 * `*Enc` keys of `inboxes.config` (channel credentials). Everything happens in one transaction: if any value does
 * not open with `oldKey`, nothing is changed. Run it with the API and worker stopped.
 */
export async function rotateSecrets(db: Database, oldKey: string, newKey: string): Promise<{ columns: number; values: number }> {
  if (oldKey === newKey) throw new Error('The new key must differ from the old key');
  if (newKey.length < 32) throw new Error('The new key must be at least 32 characters');

  return db.transaction(async (tx) => {
    const reseal = (sealed: string, where: string) => {
      try {
        return encryptSecret(decryptSecret(sealed, oldKey), newKey);
      } catch {
        throw new Error(`${where} does not open with the old key; nothing was changed`);
      }
    };

    const { rows: cols } = await tx.execute<{ table_name: string; column_name: string }>(sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public' and data_type = 'text' and column_name like '%\_enc'
      order by table_name, column_name`);

    let values = 0;
    for (const { table_name: table, column_name: column } of cols) {
      const t = sql.identifier(table);
      const c = sql.identifier(column);
      // ctid addresses a row whatever the table's key is; rows are locked and each is updated once.
      const { rows } = await tx.execute<{ ctid: string; v: string }>(sql`select ctid::text, ${c} as v from ${t} where ${c} is not null for update`);
      for (const row of rows) {
        await tx.execute(sql`update ${t} set ${c} = ${reseal(row.v, `${table}.${column}`)} where ctid = ${row.ctid}::tid`);
        values++;
      }
    }

    const { rows: inboxes } = await tx.execute<{ id: string; config: Record<string, unknown> | null }>(
      sql`select id, config from inboxes where config is not null for update`,
    );
    for (const inbox of inboxes) {
      const config = { ...inbox.config };
      let changed = false;
      for (const [k, v] of Object.entries(config)) {
        if (!k.endsWith('Enc') || typeof v !== 'string') continue;
        config[k] = reseal(v, `inboxes.config.${k} (${inbox.id})`);
        changed = true;
        values++;
      }
      if (changed) await tx.execute(sql`update inboxes set config = ${JSON.stringify(config)}::jsonb where id = ${inbox.id}`);
    }

    return { columns: cols.length, values };
  });
}
