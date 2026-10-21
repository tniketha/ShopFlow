# Moving ShopFlow to a laptop

The independent local copy has no `.git` directory. The GitHub source copy has its own history and remote; no automatic synchronization is configured.

## Move source only

Close the website and database windows. Copy or cut the project folder to the laptop. Install Node.js 22.14+ (22.x) and run Setup.cmd. This installs the laptop's dependencies and PostgreSQL binaries, creates a private `.env` when needed and asks for your owner account details.

Dependencies (`node_modules`), generated Prisma code, `.next` and compiled `dist` files can be regenerated. Moving between Windows PCs is easier when using the same Node and PostgreSQL versions. Do not copy another computer's installed dependencies across operating systems or processor architectures.

## Preserve the local database

With the app closed and the database cleanly stopped, move `.env` and `work/database` along with the source. Keep them private. The launcher finds the database relative to the project directory, so it does not depend on the original Desktop path. Do not run Setup against a database that is already open in another launcher.

For a dependable long-term backup or a PostgreSQL version change, prefer a logical backup. Install PostgreSQL's command-line client tools matching the source server's major version and add their `bin` folder to PATH.

Start the source database, set the values from your private `.env` as process environment variables, and run:

```powershell
$env:PGHOST = '127.0.0.1'
$env:PGPORT = '54329'
$env:PGUSER = 'shopflow'
$env:PGDATABASE = 'shopflow'
# Set PGPASSWORD privately to the database password from .env.
pg_dump --format=custom --file=shopflow-backup.dump
Remove-Item Env:PGPASSWORD
```

Store the backup on private or encrypted storage. It contains user password hashes, session records and store data. Keep it out of GitHub.

On the laptop, prepare a fresh PostgreSQL database and corresponding `.env`. With the target database running and the app stopped:

```powershell
# Set PGHOST, PGPORT, PGUSER, PGDATABASE and PGPASSWORD for the target.
# Restore into an EMPTY database. Do not run the initial migrations first.
pg_restore --no-owner --no-privileges --dbname=shopflow shopflow-backup.dump
psql --dbname=shopflow --command='DELETE FROM "Session";'
npm run db:generate
npm run db:migrate
Remove-Item Env:PGPASSWORD
```

The backup includes Prisma's migration history; `db:migrate` applies only newer migrations. Deleting restored sessions makes users sign in again. Check product counts, stock, a recent invoice and a sales report before using the restored app. Keep the original backup until that check succeeds.

## Update GitHub separately

Use a separate clone of `https://github.com/tniketha/ShopFlow.git`. Copy reviewed source changes into that clone, run the verification commands, and commit/push from there. Never copy `.env`, `work/`, backups or installed dependencies into the source repository. Moving the independent local folder does not affect that clone.
