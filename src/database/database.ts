import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { resolve } from 'node:path';
import pg from 'pg';
import * as schema from './schema.js';

export type Schema = typeof schema;
/** Drizzle sobre Postgres, seja `pg` (Supabase) ou PGlite (testes e dev). */
export type Database = PgDatabase<PgQueryResultHKT, Schema>;

export interface DatabaseConnection {
  db: Database;
  kind: 'postgres' | 'pglite';
  close(): Promise<void>;
}

/** Pasta das migrations geradas pelo drizzle-kit. */
export const MIGRATIONS_FOLDER = resolve(process.cwd(), 'drizzle');

/**
 * Com `url`, conecta no Postgres (Supabase). As migrations rodam à parte, com
 * `npm run db:migrate`, para a subida nunca alterar o banco real sozinha.
 *
 * Sem `url`, cria um PGlite em memória já migrado: dados somem ao reiniciar.
 *
 * O logger do Drizzle fica desligado: os parâmetros das queries têm
 * telefone, endereço e texto das mensagens.
 */
export async function connectDatabase(
  url?: string,
): Promise<DatabaseConnection> {
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    return {
      db: drizzlePg(pool, { schema, logger: false }),
      kind: 'postgres',
      close: () => pool.end(),
    };
  }

  const client = new PGlite();
  const db = drizzlePglite(client, { schema, logger: false });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, kind: 'pglite', close: () => client.close() };
}
