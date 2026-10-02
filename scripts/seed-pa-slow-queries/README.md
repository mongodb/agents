# Performance Advisor slow-query seeder

Use this to create data and run slow queries for MongoDB Atlas Performance Advisor. It loads four collections that force large collection scans, then runs unindexed finds against them so Performance Advisor has high-impact examples to recommend indexes for.

> **Warning: this script drops the `highImpact` database.**
> Every run starts with `dropDatabase()` on `highImpact` and recreates it. Anything already in a database with that name on the target cluster is deleted without a prompt. Point it only at a cluster you are happy to load with several hundred MB of throwaway data, and never at a database named `highImpact` that holds data you need.

Requires `mongosh` on PATH. The script runs `mongosh` with `--apiVersion 1`.

## Usage

Run it from this directory. `./seed.sh --help` prints the usage text (it exits with status 1).

There are three ways to point it at a cluster.

### Connection string

```bash
./seed.sh "mongodb+srv://USERNAME:PASSWORD@cluster0.xxxxx.mongodb.net/"
```

A URI that already contains credentials works as is. Do not pass a second argument in that case. Credentials in the URI are visible in process listings and shell history.

### Cluster and username

```bash
./seed.sh <cluster> <username>
# for example
./seed.sh cluster0.xxxxx.mongodb.net myDbUser
```

`<cluster>` is the cluster's hostname. The script turns it into `mongodb+srv://<cluster>/`, so it must be an SRV hostname. You can also pass a full `mongodb://` or `mongodb+srv://` URI without credentials as the first argument, followed by the username.

`mongosh` prompts for the password unless `MONGODB_PASSWORD` is set. When it is set, the script passes it to `mongosh` as `--password`, so it is visible in process listings while the script runs.

```bash
MONGODB_PASSWORD='...' ./seed.sh cluster0.xxxxx.mongodb.net myDbUser
```

### Environment or `.env`

Copy `.env.example` to `.env`, set `MONGODB_URI`, then run `./seed.sh` with no arguments. The script loads `.env` from this directory, so `MONGODB_PASSWORD` can go there too. With no arguments and no `MONGODB_URI`, or with more than two arguments, the script prints the usage text and exits with status 1.

## What it creates

The script recreates the `highImpact` database with four collections. Each query runs 20 times with no supporting index, so it scans its whole collection.

| Collection | Documents | Query |
| --- | --- | --- |
| `dbA` | 2,000 `status: "active"` plus 5 `"archived"`, about 85 KB each | `find({ status: "archived" })` |
| `dbB` | 15,000 `type: "bulk"` plus 10 `"premium"`, about 9.5 KB each | `find({ type: "premium" })` |
| `dbC` | 600 `priority: 1` plus 3 `priority: 10`, about 200 KB each | `find({ priority: 10 })` |
| `dbD` | 3,000 `category: "standard"` plus 5 `"special"` | `find({ category: "special" })` |
