import sql from "@databases/sql";
import invariant from "tiny-invariant";

type Sql = ReturnType<typeof sql>;

interface Queryable {
  query(sql: Sql): Promise<any[]>;
}

class DbError extends Error {}

export class Db<TTables> {
  constructor(public readonly underlyingDb: Queryable) {}

  async query(query: Sql): Promise<any[]> {
    try {
      const rows = await this.underlyingDb.query(query);
      return rows;
    } catch (e) {
      // atdatabases eats errors
      throw new DbError(e);
    }
  }

  private async insert<TTableName extends keyof TTables>(
    command: Sql,
    tableName: TTableName,
    ...rows: TTables[TTableName][]
  ): Promise<void> {
    await Promise.all(
      rows.map((row) => {
        const entries = Object.entries(row);
        const columnNames = sql.join(
          entries.map((entry) => sql.ident(entry[0])),
          sql`, `
        );
        const values = sql.join(
          entries.map((entry) => sql.value(entry[1])),
          sql`, `
        );
        return this.query(
          sql`${command} ${sql.ident(
            tableName
          )} (${columnNames}) values (${values})`
        );
      })
    );
  }

  insertOrReplace<TTableName extends keyof TTables>(
    tableName: TTableName,
    ...rows: TTables[TTableName][]
  ): Promise<void> {
    return this.insert(sql`replace into`, tableName, ...rows);
  }

  insertOrIgnore<TTableName extends keyof TTables>(
    tableName: TTableName,
    ...rows: TTables[TTableName][]
  ): Promise<void> {
    return this.insert(sql`insert or ignore into`, tableName, ...rows);
  }

  insertOrError<TTableName extends keyof TTables>(
    tableName: TTableName,
    ...rows: TTables[TTableName][]
  ): Promise<void> {
    return this.insert(sql`insert into`, tableName, ...rows);
  }

  async update<TTableName extends keyof TTables>(
    tableName: TTableName,
    where: Sql,
    row: Partial<TTables[TTableName]>
  ): Promise<TTables[TTableName][]> {
    const setClause = sql.join(
      Object.entries(row).map(([columnName, value]) => {
        return sql`${sql.ident(columnName)} = ${value}`;
      }),
      sql`, `
    );
    const rows = await this.query(
      sql`update ${sql.ident(tableName)} set ${setClause} where ${where}`
    );
    return rows;
  }

  set<TTableName extends keyof TTables>(
    tableName: TTableName,
    whereValues: Partial<TTables[TTableName]>,
    updateValues: Partial<TTables[TTableName]>
  ) {
    return this.update(tableName, this.rowToWhere(whereValues), updateValues);
  }

  async deleteFrom<TTableName extends keyof TTables>(
    tableName: TTableName,
    where: Sql
  ) {
    await this.query(sql`delete from ${sql.ident(tableName)} where ${where}`);
  }

  async del<TTableName extends keyof TTables>(
    tableName: TTableName,
    values: Partial<TTables[TTableName]>
  ) {
    await this.deleteFrom(tableName, this.rowToWhere(values));
  }

  async selectAll<TTableName extends keyof TTables>(
    tableName: TTableName,
    where: Sql = sql`1`
  ): Promise<TTables[TTableName][]> {
    const rows = await this.query(
      sql`select * from ${sql.ident(tableName)} where ${where}`
    );
    return rows;
  }

  async selectOne<TTableName extends keyof TTables>(
    tableName: TTableName,
    where: Sql = sql`1`
  ): Promise<TTables[TTableName] | null> {
    const rows = await this.selectAll(tableName, where);
    invariant(rows.length < 2, "more than one row matched this query");
    if (rows.length !== 1) {
      return null;
    }
    return rows[0];
  }

  private rowToWhere(row: object) {
    return sql.join(
      Object.entries(row).map(
        ([columnName, value]) => sql`${sql.ident(columnName)} = ${value}`
      ),
      sql` and `
    );
  }

  async getAll<TTableName extends keyof TTables>(
    tableName: TTableName,
    values: Partial<TTables[TTableName]>
  ): Promise<TTables[TTableName][]> {
    const where = this.rowToWhere(values);
    const rows = this.selectAll(tableName, where);
    return rows;
  }

  async getOne<TTableName extends keyof TTables>(
    tableName: TTableName,
    values: Partial<TTables[TTableName]>
  ): Promise<TTables[TTableName] | null> {
    const rows = await this.getAll(tableName, values);
    invariant(rows.length < 2, "more than one row matched this query");
    if (rows.length !== 1) {
      return null;
    }
    return rows[0];
  }
}

interface Column {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  pk: number;
  dflt_value: any;
}

/**
 * Run the provided script in sqlite, and do our best to generate TypeScript
 * code that can be dropped into your project.
 *
 * Note: this requires the optional @databases/sqlite dependency to be installed.
 *
 * Also, this relies on `runScript()` which has some limitations. See below.
 */
export async function codegenTypes(
  script: string,
  tableNames?: string[],
  tsTypeName: string = "DbTables"
) {
  const { default: connect } = await import("@databases/sqlite");

  const db = connect();

  await runScript(db, script);

  if (!tableNames) {
    const rows = await db.query(
      sql`select name from sqlite_master where type='table' order by name`
    );
    tableNames = rows.map((row) => row.name);
  }
  const accum: string[] = [];

  accum.push(`interface ${tsTypeName} {`);
  for (const tableName of tableNames) {
    const columns: Column[] = await db.query(
      sql`pragma table_info(${sql.ident(tableName)})`
    );

    accum.push(`  ${tableName}: {`);
    for (const column of columns) {
      const columnType = column.type.toLowerCase();
      let baseType = "string";
      if (
        columnType.includes("int") ||
        columnType.includes("real") ||
        columnType.includes("double") ||
        columnType.includes("float")
      ) {
        baseType = "number";
      } else if (columnType.includes("bool") || columnType.includes("bit")) {
        baseType = "number";
      }
      // while technically primary keys could be null, let's not allow that
      const optional = !column.notnull && !column.dflt_value && !column.pk;
      accum.push(`    ${column.name}${optional ? "?" : ""}: ${baseType};`);
    }
    accum.push(`  },`);
  }
  accum.push("}");
  return accum.join("\n") + "\n";
}

/**
 * @databases/sqlite has a limitation where it can't run multiple statements.
 * This function naively splits on `;`.
 */
export async function runScript(db: Queryable, script: string) {
  // Work around a bug in @databases where sql.file() doesn't support
  // more than 1 statement.
  for (const statement of script.split(";")) {
    if (statement.trim().length === 0) {
      continue;
    }
    await db.query(sql.__dangerous__rawValue(statement));
  }
}
