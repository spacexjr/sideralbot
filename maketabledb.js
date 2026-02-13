import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

// ───── Conexão PostgreSQL ─────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ───── Script para criar/atualizar tabelas ─────
const schema = `
CREATE TABLE IF NOT EXISTS configs (
    guild_id BIGINT PRIMARY KEY,
    host TEXT NOT NULL,
    port INT NOT NULL,
    version TEXT NOT NULL,
    nick TEXT NOT NULL,
    canais BIGINT[],
    cargos BIGINT[],
    canal_aviso BIGINT
);

CREATE TABLE IF NOT EXISTS last_channels (
    guild_id BIGINT PRIMARY KEY,
    canais BIGINT[]
);
`;

async function initDB() {
  try {
    await pool.query(schema);
    console.log("✅ Tabelas criadas/verificadas com sucesso!");

    // Caso já exista a tabela antiga, adiciona a coluna nova se faltar
    await pool.query(`
      ALTER TABLE configs
      ADD COLUMN IF NOT EXISTS canal_aviso BIGINT;
    `);

    console.log("✅ Coluna 'canal_aviso' verificada/adicionada!");
  } catch (err) {
    console.error("❌ Erro ao criar tabelas:", err);
  } finally {
    await pool.end();
  }
}

initDB();
