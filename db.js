// db.js

import pkg from 'pg';
import { sleep } from './utils.js';
const { Pool } = pkg;

// ---------- Pool de Conexão ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (err, client) => {
  console.error('❌ Erro inesperado no pool de conexões com o DB:', err.message, err.stack);
});

// ---------- Funções de Conexão ----------
export async function esperarPostgres(retries = 10, delay = 2000) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query('SELECT 1');
      console.log('📦 PostgreSQL online');
      return;
    } catch (e) {
      console.log(`⏳ PostgreSQL iniciando... ${i}/${retries}`);
      await sleep(delay);
    }
  }
  console.error('❌ PostgreSQL não iniciou após várias tentativas. Saindo.');
  process.exit(1);
}

// ---------- Funções de Queries ----------
export async function salvarConfig(guildId, ip, porta, versao, nick, canais, cargos) {
  await pool.query(`
    INSERT INTO configs (guild_id, host, port, version, nick, canais, cargos)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (guild_id) DO UPDATE SET
      host = EXCLUDED.host,
      port = EXCLUDED.port,
      version = EXCLUDED.version,
      nick = EXCLUDED.nick,
      canais = EXCLUDED.canais,
      cargos = EXCLUDED.cargos
  `, [guildId, ip, porta, versao, nick, canais, cargos]);
}

export async function carregarConfig(guildId) {
  const r = await pool.query("SELECT * FROM configs WHERE guild_id=$1", [guildId]);
  return r.rows[0] || null;
}

export async function salvarChat(guildId, canais) {
  await pool.query(`INSERT INTO last_channels (guild_id, canais) VALUES ($1,$2) ON CONFLICT (guild_id) DO UPDATE SET canais = EXCLUDED.canais`, [guildId, canais]);
}

export async function carregarChat(guildId) {
  const r = await pool.query("SELECT canais FROM last_channels WHERE guild_id=$1", [guildId]);
  return r.rows[0]?.canais || [];
}