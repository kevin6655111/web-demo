import '@/env.bootstrap';
import 'reflect-metadata';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { config } from '@/env.bootstrap';

/**
 * 退回 migration。
 *   yarn migrate:revert      退回上一版
 *   yarn migrate:revert all  全部退回
 */
(async () => {
  const db = config.database.postgres;

  const dataSource = new DataSource({
    type: 'postgres',
    host: db.host,
    port: db.port,
    username: db.user,
    password: db.pass,
    database: db.name,
    migrations: [join(__dirname, '../migrations/**/*{.ts,.js}')]
  });

  await dataSource.initialize();

  const all = process.argv[2] === 'all';
  do {
    await dataSource.undoLastMigration();
  } while (all && (await dataSource.showMigrations()) === false);

  await dataSource.destroy();
  process.exit(0);
})();
