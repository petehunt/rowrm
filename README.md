# st-orm: the Single Table Object-Relational Mapper

`st-orm` is a library for really convenient, typesafe access to databases where you only need to `insert`, `delete`, `update`, and `select * from one_table where ...`. a lot of apps fit into this category!

## cool features

- can codegen TypeScript interfaces for your SQL schema, just copy and paste them into your project!
- fully type-safe, with full autocompletion
- lots of escape hatches to drop into raw SQL when you need it

## limitations

- not used much in production (but there's very little code so it's probably safe)
- only tested extensively with SQLite, probably needs minor modifications for Postgres and MySQL

## example: generating TypeScript interfaces for your SQL schema

```
console.log(await codegenTypes(`

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

`));
```

emits:

```
interface DbTables {
  photos: {
    photo_id: number;
    owner_user_id: number;
    cdn_url: string;
    caption?: string;
  },
  users: {
    user_id: number;
    screen_name: string;
    bio?: string;
    age?: number;
  },
}
```

## example: insert some data

```
const db = new Db<DbTables>(connect());
// the rows below are typechecked based on the name of the table
await db.insertOrThrow(
  "users",
  { user_id: 1, screen_name: "@alice", bio: "my name is alice", age: 100 },
  { user_id: 2, screen_name: "@bob", bio: null, age: 99 }
);
```

## example: concisely select some data

```
// aliceByPkey is of type DbTables["users"] | null
const aliceByPkey = await db.getOne("users", { user_id: 1 });

// photosByAlice is of type DbTables["photos"][]
const photosByAlice = await db.getAll("photos", { owner_user_id: 1 });

// you can add sorting criteria as well. all typesafe!
// you can provide an array of `orderBy` columns if you want to sort by multiple columns
const oldestUser = await db.getAll(
  "users",
  {},
  { orderBy: "age", limit: 1, direction: "desc" }
);
```

## example: drop into raw SQL for WHERE clauses

```
const ELDERLY_AGE = 100;
// elderlyUsers is of type DbTables["users"][]
const elderlyUsers = await db.getAllBySql("users", sql`age >= ${ELDERLY_AGE} ORDER BY age DESC`);
```

## example: issue untyped raw queries

```
// maxAge is of type any
const [{ maxAge }] = await db.query(sql`select max(age) as maxAge from users`)
```

## example: update / delete

```
await db.set("users", { user_id: 1 }, { bio: "bio deleted", age: 200 });
await db.del("photos", { owner_user_id: 1 });
// you can also call setBySql() and delBySql(), similar to `getOneBySql()` and `getAllBySql()`
```
