import { spawn } from 'node:child_process';
import { mkdir, writeFile, unlink, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
// Use pg_ctl for graceful shutdown on Windows as well as Linux.
export class LocalPostgres {
  options;
  running = false;
  constructor(options) {
    this.options = options;
  }
  async binaries() {
    const platform = process.platform === 'win32' ? 'windows' : process.platform;
    return import(`@embedded-postgres/${platform}-${process.arch}`);
  }
  async run(binary, args) {
    const logPath = resolve(dirname(this.options.databaseDir), 'postgres-commands.log');
    const log = await open(logPath, 'a');
    try {
      await new Promise((done, reject) => {
        const child = spawn(binary, args, {
          windowsHide: true,
          // File descriptors avoid inherited pipe handles keeping Windows launchers open.
          stdio: ['ignore', log.fd, log.fd],
          env: { ...process.env, LC_MESSAGES: 'C' },
        });
        const timeout = setTimeout(() => {
          child.kill();
          reject(new Error('PostgreSQL command timed out. Check work/postgres.log.'));
        }, 60000);
        child.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.on('exit', (code) => {
          clearTimeout(timeout);
          code === 0
            ? done()
            : reject(
                new Error(
                  `PostgreSQL command failed (${code}). Check work/postgres.log and whether the port is already in use.`,
                ),
              );
        });
      });
    } catch (error) {
      const details = (await readFile(logPath, 'utf8').catch(() => '')).slice(-6000);
      const server = (
        await readFile(resolve(dirname(this.options.databaseDir), 'postgres.log'), 'utf8').catch(
          () => '',
        )
      ).slice(-3000);
      throw new Error(`${error.message}\n${details}\n${server}`);
    } finally {
      await log.close();
    }
  }
  async initialise() {
    const { initdb } = await this.binaries();
    const parent = dirname(this.options.databaseDir);
    await mkdir(parent, { recursive: true });
    const passwordFile = resolve(parent, `.pg-password-${randomUUID()}`);
    try {
      await writeFile(passwordFile, this.options.password + '\n', { mode: 0o600, flag: 'wx' });
      await this.run(initdb, [
        '-D',
        this.options.databaseDir,
        '--auth=scram-sha-256',
        '--username=' + this.options.user,
        '--pwfile=' + passwordFile,
        '--lc-messages=C',
        '--encoding=UTF8',
      ]);
    } finally {
      await unlink(passwordFile).catch(() => {});
    }
  }
  async start() {
    const { pg_ctl } = await this.binaries();
    await this.run(pg_ctl, [
      '-D',
      this.options.databaseDir,
      '-l',
      resolve(dirname(this.options.databaseDir), 'postgres.log'),
      '-o',
      `-p ${this.options.port} -h 127.0.0.1`,
      '-w',
      'start',
    ]);
    this.running = true;
  }
  async stop() {
    if (this.running) {
      const { pg_ctl } = await this.binaries();
      await this.run(pg_ctl, ['-D', this.options.databaseDir, '-m', 'fast', '-w', 'stop']);
      this.running = false;
    }
  }
  getPgClient(database = 'postgres', host = '127.0.0.1') {
    return new Client({
      host,
      port: this.options.port,
      user: this.options.user,
      password: this.options.password,
      database,
    });
  }
  async createDatabase(name) {
    if (!/^[a-z_]+$/.test(name)) throw new Error('Invalid local database name');
    const client = this.getPgClient();
    await client.connect();
    try {
      await client.query(`CREATE DATABASE "${name}"`);
    } finally {
      await client.end();
    }
  }
}
