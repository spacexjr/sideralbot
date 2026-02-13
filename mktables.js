// setup_db.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function createTables() {
    try {
        console.log("⏳ Criando tabelas no banco de dados...");

        // 1. Tabela de Configurações do Servidor
        await pool.query(`
            CREATE TABLE IF NOT EXISTS configs (
                guild_id TEXT PRIMARY KEY,
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                version TEXT NOT NULL,
                nick TEXT NOT NULL,
                canais TEXT,
                cargos TEXT
            );
        `);

        // 2. Tabela de Canais de Chat (DC <-> MC)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS chat_channels (
                guild_id TEXT PRIMARY KEY,
                channel_ids TEXT NOT NULL
            );
        `);

        // 3. Tabela de Vinculação de Nicks
        await pool.query(`
            CREATE TABLE IF NOT EXISTS nick_vincular (
                user_id TEXT PRIMARY KEY,
                mc_nick TEXT NOT NULL UNIQUE
            );
        `);

        // 4. Tabela de Economia (Moedas)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS economy (
                user_id TEXT,
                guild_id TEXT,
                balance INTEGER DEFAULT 0,
                PRIMARY KEY (user_id, guild_id)
            );
        `);

        console.log("✅ Todas as tabelas foram criadas/verificadas com sucesso!");
    } catch (err) {
        console.error("❌ Erro ao criar tabelas:", err);
    } finally {
        await pool.end();
    }
}

createTables();