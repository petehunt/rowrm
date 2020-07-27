import sql from "@databases/sql";
import invariant from "tiny-invariant";

export { sql };

/**
 * SQL query fragment
 */
type Sql = ReturnType<typeof sql>;

/**
 * A DB-independent DatabaseTransaction or DatabaseConnection
 */
interface Queryable {
  query(sql: Sql): Promise<any[]>;
}

class DbError extends Error {}

export class Db<TTables> {
  constructor(public readonly underlyingDb: Queryable) {}

  /**
   * Issues a query directly to the underlying data store
   */
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

  /**
   * REPLACE INTO
   */
  insertOrReplace<TTableName extends keyof TTables>(
    tableName: TTableName,
    ...rows: TTables[TTableName][]
  ): Promise<void> {
    return this.insert(sql`replace into`, tableName, ...rows);
  }

  /**
   * INSERT OR IGNORE INTO
   */
  insertOrIgnore<TTableName extends keyof TTables>(
    tableName: TTableName,
    ...rows: TTables[TTableName][]
  ): Promise<void> {
    return this.insert(sql`insert or ignore into`, tableName, ...rows);
  }

  /**
   * INSERT INTO
   */
  insertOrThrow<TTableName extends keyof TTables>(
    tableName: TTableName,
    ...rows: TTables[TTableName][]
  ): Promise<void> {
    return this.insert(sql`insert into`, tableName, ...rows);
  }

  /**
   * UPDATE with a SQL predicate
   */
  async setBySql<TTableName extends keyof TTables>(
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

  /**
   * UPDATE with a partial object predicate
   */
  set<TTableName extends keyof TTables>(
    tableName: TTableName,
    whereValues: Partial<TTables[TTableName]>,
    updateValues: Partial<TTables[TTableName]>
  ) {
    return this.setBySql(tableName, this.rowToWhere(whereValues), updateValues);
  }

  /**
   * DELETE FROM with a SQL predicate
   */
  async delBySql<TTableName extends keyof TTables>(
    tableName: TTableName,
    where: Sql
  ) {
    await this.query(sql`delete from ${sql.ident(tableName)} where ${where}`);
  }

  /**
   * DELETE FROM with a partial object predicate
   */
  async del<TTableName extends keyof TTables>(
    tableName: TTableName,
    values: Partial<TTables[TTableName]>
  ) {
    await this.delBySql(tableName, this.rowToWhere(values));
  }

  /**
   * SELECT * with a SQL predicate
   */
  async getAllBySql<TTableName extends keyof TTables>(
    tableName: TTableName,
    where: Sql = sql`1`
  ): Promise<TTables[TTableName][]> {
    const rows = await this.query(
      sql`select * from ${sql.ident(tableName)} where ${where}`
    );
    return rows;
  }

  /**
   * SELECT * with a SQL predicate, throws if > 1 row matches
   */
  async getOneBySql<TTableName extends keyof TTables>(
    tableName: TTableName,
    where: Sql = sql`1`
  ): Promise<TTables[TTableName] | null> {
    const rows = await this.getAllBySql(tableName, sql`${where} limit 2`);
    invariant(rows.length < 2, "more than one row matched this query");
    if (rows.length !== 1) {
      return null;
    }
    return rows[0];
  }

  /**
   * SELECT * with a SQL predicate, throws if < 1 or > 1 row matches
   */
  async getOneBySqlOrThrow<TTableName extends keyof TTables>(
    tableName: TTableName,
    where: Sql = sql`1`
  ): Promise<TTables[TTableName]> {
    const rv = await this.getOneBySql(tableName, where);
    invariant(rv, "less than one row matched this query");
    return rv;
  }

  private rowToWhere(row: object) {
    const entries = Object.entries(row);
    if (entries.length === 0) {
      return sql`1`;
    }
    return sql.join(
      entries.map(
        ([columnName, value]) => sql`${sql.ident(columnName)} = ${value}`
      ),
      sql` and `
    );
  }

  /**
   * SELECT * with a partial object predicate
   */
  async getAll<TTableName extends keyof TTables>(
    tableName: TTableName,
    values: Partial<TTables[TTableName]>,
    options?: {
      orderBy: keyof TTables[TTableName] | Array<keyof TTables[TTableName]>;
      direction?: "asc" | "desc";
      limit?: number;
    }
  ): Promise<TTables[TTableName][]> {
    const where = this.rowToWhere(values);
    let query = where;
    if (options) {
      invariant(
        !Array.isArray(options.orderBy) || options.orderBy.length > 0,
        "must have at least 1 element in orderBy array"
      );
      const orderByColumns = Array.isArray(options.orderBy)
        ? sql.join(
            options.orderBy.map((columnName) => sql.ident(columnName)),
            sql`,`
          )
        : sql.ident(options.orderBy);
      invariant(
        !options.direction ||
          options.direction === "asc" ||
          options.direction === "desc",
        `direction must be 'asc' or 'desc'; got ${options.direction}`
      );
      const direction =
        options.direction === "asc"
          ? sql`asc`
          : options.direction === "desc"
          ? sql`desc`
          : sql`asc`;

      query = sql`${query} order by ${orderByColumns} ${direction}`;

      if (typeof options.limit !== "undefined") {
        invariant(
          typeof options.limit === "number",
          `limit must be a number; got ${options.limit}`
        );
        query = sql`${query} limit ${options.limit}`;
      }
    }
    const rows = this.getAllBySql(tableName, query);
    return rows;
  }

  /**
   * SELECT * with a partial object predicate, throws if > 1 row matches
   */
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

  /**
   * SELECT * with a partial object predicate, throws if < 1 or > 1 row matches
   */
  async getOneOrThrow<TTableName extends keyof TTables>(
    tableName: TTableName,
    values: Partial<TTables[TTableName]>
  ): Promise<TTables[TTableName]> {
    const rv = await this.getOne(tableName, values);
    invariant(rv, "less than one row matched this query");
    return rv;
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
      // TODO: allow optional fields
      // for now, don't allow nullable primary keys. seems like a bad practice.
      const nullable = column.notnull || column.pk ? "" : " | null";
      accum.push(`    ${column.name}: ${baseType}${nullable};`);
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
