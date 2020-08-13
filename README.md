# rowrm

`rowrm` is a single-table [ORM](https://en.wikipedia.org/wiki/Object-relational_mapping) built on top of [@databases](https://www.atdatabases.org/) in TypeScript.

more specifically, `rowrm` is a library for really convenient, typesafe access to databases where you only need to `insert`, `delete`, `update`, and `select * from one_table where ...`. a lot of apps fit into this category!

## cool features

- can codegen TypeScript interfaces for your SQL schema; just copy and paste them into your project!
- fully type-safe, with full autocompletion
- lots of escape hatches to drop into raw SQL when you need it

## credit

thanks to josh yudaken for the original idea, and the first production implementation.

## limitations

- not used much in production (but there's very little code so it's probably safe)
- only tested extensively with SQLite. it probably needs minor modifications for Postgres and MySQL.

## example: generating TypeScript interfaces for your SQL schema

```ts
console.log(
  await codegenTypes(`
    create table users (
      user_id integer primary key,
      screen_name varchar(128) unique not null,
      bio text,
      age integer
    );

    create table photos (
      photo_id integer primary key,
      owner_user_id integer not null,
      cdn_url varchar(128) not null,
      caption text
    );
  `)
);
```

emits:

```ts
interface DbTables {
  photos: {
    photo_id: number;
    owner_user_id: number;
    cdn_url: string;
    caption: string | null;
  },
  users: {
    user_id: number;
    screen_name: string;
    bio: string | null;
    age: number | null;
  },
}
```

## example: insert some data

```ts
const connection = connect();
const { users, photos } = tables<DbTables>(connection);
// the rows below are typechecked based on the table schema
await users.insertOrThrow(
  { user_id: 1, screen_name: "@alice", bio: "my name is alice", age: 100 },
  { user_id: 2, screen_name: "@bob", bio: null, age: 99 }
);
```

## example: concisely select some data

```ts
// aliceByPkey is of type DbTables["users"] | null
const aliceByPkey = await users.getOne({ user_id: 1 });

// photosByAlice is of type DbTables["photos"][]
const photosByAlice = await photos.getAll({ owner_user_id: 1 });

// you can add sorting criteria as well. all typesafe!
// you can provide an array of `orderBy` columns if you want to sort by multiple columns
const oldestUser = await users.getAll(
  {},
  { orderBy: "age", limit: 1, direction: "desc" }
);
```

## example: drop into raw SQL for WHERE clauses

```ts
const ELDERLY_AGE = 100;
// elderlyUsers is of type DbTables["users"][]
const elderlyUsers = await users.getAllBySql(sql`age >= ${ELDERLY_AGE} ORDER BY age DESC`);
```

## example: issue untyped raw queries

```ts
// maxAge is of type any
const [{ maxAge }] = await connection.query(sql`select max(age) as maxAge from users`)
```

## example: update / delete

```ts
await users.set({ user_id: 1 }, { bio: "bio deleted", age: 200 });
await photos.del({ owner_user_id: 1 });
// you can also call setBySql() and delBySql(), similar to `getOneBySql()` and `getAllBySql()`
```

## FAQ

### why can't i do joins?

in-database joins add a ton of both interface and implementation complexity. with `rowrm`, you should do your joins "in the app" by beginning a transaction, fetching the rows in the first table, and then looping through and querying for the rows in the joined table.

this pattern isn't actually that crazy; keith adams, chief architect at slack and former tech lead at FB explains why in [this podcast](https://softwareengineeringdaily.com/2019/07/15/facebook-php-with-keith-adams/). but long story short, "in-app joins" are often the right call because:

- as your application logic gets more complicated, you will often have to move your joins into the app to manage the complexity. a great example is access control based on the currently logged in user, or other complex business logic.
- if you want to add a caching layer to your app or horizontal sharding, you will need to move your joins into the app.

it's true that sometimes there are cases when you really need to do joins and can't do it in the app, but it's pretty rare. for those situations, issue a raw query using `db.query()`.

### why can't i do complex queries without dropping into sql?

i've found that `rowrm` does solve the common case quite effectively, and for more complex cases, dropping into raw SQL is pretty painless. re-implementing a DSL for all of SQL would add a lot of complexity, would be hard to use, and wouldn't add that much value on top of SQL.

### how do i select a subset of columns?

this isn't supported yet, but i'd like to in the future.
