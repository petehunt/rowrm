import connect, { sql } from "@databases/sqlite";
import { Db, codegenTypes, runScript } from ".";
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
    caption?: string;
  },
  users: {
    user_id: number;
    screen_name: string;
    bio?: string;
    age?: number;
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
    caption?: string;
  };
  users: {
    user_id: number;
    screen_name: string;
    bio?: string;
    age?: number;
  };
}

test("smoke test", async (t) => {
  const db = new Db<DbTables>(connect());
  await runScript(db.underlyingDb, SCHEMA);
  await db.insertOrThrow(
    "users",
    { user_id: 1, screen_name: "@alice", bio: "my name is alice", age: 100 },
    { user_id: 2, screen_name: "@bob" }
  );
  await db.insertOrThrow(
    "photos",
    {
      photo_id: 1,
      cdn_url: "cdn.com/1.jpg",
      owner_user_id: 1,
    },
    {
      photo_id: 2,
      cdn_url: "cdn.com/2.jpg",
      owner_user_id: 1,
      caption: "photo caption",
    }
  );

  const aliceByPkey = await db.getOne("users", { user_id: 1 });
  const aliceByScreenName = await db.getOne("users", {
    screen_name: "@alice",
  });
  const aliceBySql = await db.getOneBySql(
    "users",
    sql`bio=${"my name is alice"}`
  );
  t.deepEqual(aliceByPkey, {
    user_id: 1,
    screen_name: "@alice",
    bio: "my name is alice",
    age: 100,
  });
  t.deepEqual(aliceByPkey, aliceByScreenName);
  t.deepEqual(aliceByPkey, aliceBySql);

  // fetch many
  const aliceByMany = await db.getAllBySql("users", sql`screen_name='@alice'`);
  t.deepEqual(aliceByMany, [aliceByPkey]);

  const photosByAlice = await db.getAll("photos", { owner_user_id: 1 });
  t.deepEqual(photosByAlice, [
    { photo_id: 1, owner_user_id: 1, cdn_url: "cdn.com/1.jpg", caption: null },
    {
      photo_id: 2,
      owner_user_id: 1,
      cdn_url: "cdn.com/2.jpg",
      caption: "photo caption",
    },
  ]);

  const photosByBob = await db.getAll("photos", { owner_user_id: 2 });
  t.deepEqual(photosByBob, []);

  // inequality with ordering
  const ELDERLY_AGE = 100;
  const elderlyUsers = await db.getAllBySql(
    "users",
    sql`age >= ${ELDERLY_AGE} ORDER BY age DESC`
  );
  t.deepEqual(elderlyUsers, [
    { user_id: 1, screen_name: "@alice", bio: "my name is alice", age: 100 },
  ]);

  // raw untyped query
  const [{ maxAge }] = await db.underlyingDb.query(
    sql`select max(age) as maxAge from users`
  );
  t.equal(maxAge, 100);

  // update / delete
  await db.set("users", { user_id: 1 }, { bio: "bio deleted", age: 200 });
  t.deepEqual(await db.getOne("users", { user_id: 1 }), {
    user_id: 1,
    screen_name: "@alice",
    bio: "bio deleted",
    age: 200,
  });

  await db.del("photos", { owner_user_id: 1 });
  t.deepEqual(await db.getAll("photos", { owner_user_id: 1 }), []);
});
