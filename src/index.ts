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

class Table<TRow> {
  constructor(
    public readonly underlyingDb: Queryable,
    private tableName: string
  ) {}

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

  private async insert(
    command: Sql,

    ...rows: TRow[]
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
            this.tableName
          )} (${columnNames}) values (${values})`
        );
      })
    );
  }

  /**
   * REPLACE INTO
   */
  insertOrReplace(...rows: TRow[]): Promise<void> {
    return this.insert(sql`replace into`, ...rows);
  }

  /**
   * INSERT OR IGNORE INTO
   */
  insertOrIgnore(...rows: TRow[]): Promise<void> {
    return this.insert(sql`insert or ignore into`, ...rows);
  }

  /**
   * INSERT INTO
   */
  insertOrThrow(...rows: TRow[]): Promise<void> {
    return this.insert(sql`insert into`, ...rows);
  }

  /**
   * UPDATE with a SQL predicate
   */
  async setBySql(where: Sql, row: Partial<TRow>): Promise<TRow[]> {
    const setClause = sql.join(
      Object.entries(row).map(([columnName, value]) => {
        return sql`${sql.ident(columnName)} = ${value}`;
      }),
      sql`, `
    );
    const rows = await this.query(
      sql`update ${sql.ident(this.tableName)} set ${setClause} where ${where}`
    );
    return rows;
  }

  /**
   * UPDATE with a partial object predicate
   */
  set(whereValues: Partial<TRow>, updateValues: Partial<TRow>) {
    return this.setBySql(this.rowToWhere(whereValues), updateValues);
  }

  /**
   * DELETE FROM with a SQL predicate
   */
  async delBySql(where: Sql) {
    await this.query(
      sql`delete from ${sql.ident(this.tableName)} where ${where}`
    );
  }

  /**
   * DELETE FROM with a partial object predicate
   */
  async del(values: Partial<TRow>) {
    await this.delBySql(this.rowToWhere(values));
  }

  /**
   * SELECT * with a SQL predicate
   */
  async getAllBySql(where: Sql = sql`1`): Promise<TRow[]> {
    const rows = await this.query(
      sql`select * from ${sql.ident(this.tableName)} where ${where}`
    );
    return rows;
  }

  /**
   * SELECT * with a SQL predicate, throws if > 1 row matches
   */
  async getOneBySql(where: Sql = sql`1`): Promise<TRow | null> {
    const rows = await this.getAllBySql(sql`${where} limit 2`);
    invariant(rows.length < 2, "more than one row matched this query");
    if (rows.length !== 1) {
      return null;
    }
    return rows[0];
  }

  /**
   * SELECT * with a SQL predicate, throws if < 1 or > 1 row matches
   */
  async getOneBySqlOrThrow(where: Sql = sql`1`): Promise<TRow> {
    const rv = await this.getOneBySql(where);
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
  async getAll(
    values: Partial<TRow>,
    options?: {
      orderBy: keyof TRow | Array<keyof TRow>;
      direction?: "asc" | "desc";
      limit?: number;
    }
  ): Promise<TRow[]> {
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
    const rows = this.getAllBySql(query);
    return rows;
  }

  /**
   * SELECT * with a partial object predicate, throws if > 1 row matches
   */
  async getOne(values: Partial<TRow>): Promise<TRow | null> {
    const rows = await this.getAll(values);
    invariant(rows.length < 2, "more than one row matched this query");
    if (rows.length !== 1) {
      return null;
    }
    return rows[0];
  }

  /**
   * SELECT * with a partial object predicate, throws if < 1 or > 1 row matches
   */
  async getOneOrThrow(values: Partial<TRow>): Promise<TRow> {
    const rv = await this.getOne(values);
    invariant(rv, "less than one row matched this query");
    return rv;
  }
}

export function tables<TTables>(
  connectionOrTransaction: Queryable
): {
  [TTableName in keyof TTables]: Table<TTables[TTableName]>;
} {
  return new Proxy(
    {},
    {
      get: (target, prop, receiver) => {
        if (prop === "then") {
          return undefined;
        }
        return new Table(connectionOrTransaction, prop as string);
      },
    }
  ) as any;
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
