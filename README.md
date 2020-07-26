# rowrm

- `rowrm` is a library for really convenient, typesafe access to databases where you only need to `insert`, `delete`, `update`, and `select * from one_table where ...`.
- a lot of apps fit into this category!
- see `src/tests.ts` for how to use it.
- note that this is only tested with `sqlite` right now, but could be made to work with other DBs easily.

## cool features

- can codegen TypeScript interfaces for your SQL schema, just copy and paste them into your project!
- fully type-safe, with full autocompletion
