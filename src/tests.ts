import connect, { sql } from "@databases/sqlite";
import { tables, codegenTypes, runScript } from ".";
import test from "tape-async";

const SCHEMA = `
  create table users (user_id integer primary key, screen_name varchar(128) unique not null, bio text, age integer);
  create table photos (photo_id integer primary key, owner_user_id integer not null, cdn_url varchar(128) not null, caption text);
`;

test("codegenTypes", async (t) => {
  t.equal(
    (await codegenTypes(SCHEMA)).trim(),
    `
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
  `.trim()
  );
});

interface DbTables {
  photos: {
    photo_id: number;
    owner_user_id: number;
    cdn_url: string;
    caption: string | null;
  };
  users: {
    user_id: number;
    screen_name: string;
    bio: string | null;
    age: number | null;
  };
}

test("smoke test", async (t) => {
  const connection = connect();
  await runScript(connection, SCHEMA);
  const { users, photos } = tables<DbTables>(connection);

  await users.insertOrThrow(
    { user_id: 1, screen_name: "@alice", bio: "my name is alice", age: 100 },
    { user_id: 2, screen_name: "@bob", age: 99, bio: null }
  );

  await photos.insertOrThrow(
    {
      photo_id: 1,
      cdn_url: "cdn.com/1.jpg",
      owner_user_id: 1,
      caption: null,
    },
    {
      photo_id: 2,
      cdn_url: "cdn.com/2.jpg",
      owner_user_id: 1,
      caption: "photo caption",
    }
  );

  const aliceByPkey = await users.getOne({ user_id: 1 });
  const aliceByScreenName = await users.getOne({
    screen_name: "@alice",
  });
  const aliceBySql = await users.getOneBySql(sql`bio=${"my name is alice"}`);
  t.deepEqual(aliceByPkey, {
    user_id: 1,
    screen_name: "@alice",
    bio: "my name is alice",
    age: 100,
  });
  t.deepEqual(aliceByPkey, aliceByScreenName);
  t.deepEqual(aliceByPkey, aliceBySql);

  // fetch many
  const aliceByMany = await users.getAllBySql(sql`screen_name='@alice'`);
  t.deepEqual(aliceByMany, [aliceByPkey]);

  const photosByAlice = await photos.getAll({ owner_user_id: 1 });
  t.deepEqual(photosByAlice, [
    { photo_id: 1, owner_user_id: 1, cdn_url: "cdn.com/1.jpg", caption: null },
    {
      photo_id: 2,
      owner_user_id: 1,
      cdn_url: "cdn.com/2.jpg",
      caption: "photo caption",
    },
  ]);

  const photosByBob = await photos.getAll({ owner_user_id: 2 });
  t.deepEqual(photosByBob, []);

  // inequality with ordering
  const ELDERLY_AGE = 100;
  const elderlyUsers = await users.getAllBySql(
    sql`age >= ${ELDERLY_AGE} ORDER BY age DESC`
  );
  t.deepEqual(elderlyUsers, [
    { user_id: 1, screen_name: "@alice", bio: "my name is alice", age: 100 },
  ]);

  // raw untyped query
  const [{ maxAge }] = await connection.query(
    sql`select max(age) as maxAge from users`
  );
  t.equal(maxAge, 100);

  // order by / limit
  const usersOrderedByAgeAsc = await users.getAll({}, { orderBy: "age" });
  t.deepEqual(
    usersOrderedByAgeAsc.map((user) => user.screen_name),
    ["@bob", "@alice"]
  );
  const usersOrderedByAgeDesc = await users.getAll(
    {},
    { orderBy: "age", direction: "desc" }
  );
  t.deepEqual(
    usersOrderedByAgeDesc.map((user) => user.screen_name),
    ["@alice", "@bob"]
  );
  const oldestUser = await users.getAll(
    {},
    { orderBy: ["age"], limit: 1, direction: "desc" }
  );
  t.equal(oldestUser.length, 1);
  t.equal(oldestUser[0].screen_name, "@alice");

  // update / delete
  await users.set({ user_id: 1 }, { bio: "bio deleted", age: 200 });
  t.deepEqual(await users.getOne({ user_id: 1 }), {
    user_id: 1,
    screen_name: "@alice",
    bio: "bio deleted",
    age: 200,
  });

  await photos.del({ owner_user_id: 1 });
  t.deepEqual(await photos.getAll({ owner_user_id: 1 }), []);

  t.equal(await users.getOne({ user_id: 4 }), null);
  try {
    await users.getOneOrThrow({ user_id: 4 });
    t.fail();
  } catch (e) {
    t.equal(
      e.toString(),
      "Error: Invariant failed: less than one row matched this query"
    );
  }

  await users.getOneOrThrow({ user_id: 1 });
  t.pass();
});
