// mktables.js
import 'dotenv/config';
import mysql from 'mysql2/promise';

async function createTables() {
    const pool = mysql.createPool({
        uri: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log("⏳ Criando tabelas no MySQL...");

        // 1. Configurações (canais/cargos como LONGTEXT ou JSON para simular arrays)
        await pool.query(`
        CREATE TABLE IF NOT EXISTS configs (
            guild_id VARCHAR(50) PRIMARY KEY,
                                            host TEXT NOT NULL,
                                            port INTEGER NOT NULL,
                                            version TEXT NOT NULL,
                                            nick TEXT NOT NULL,
                                            canais JSON,
                                            cargos JSON
        );
        `);

        // 2. Canais de Chat
        await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_channels (
            guild_id VARCHAR(50) PRIMARY KEY,
                                                  channel_ids JSON NOT NULL
        );
        `);

        // 3. Vinculação de Nicks
        await pool.query(`
        CREATE TABLE IF NOT EXISTS nick_vincular (
            user_id VARCHAR(50) PRIMARY KEY,
                                                  mc_nick VARCHAR(100) NOT NULL UNIQUE
        );
        `);

        // 4. Playtime
        await pool.query(`
        CREATE TABLE IF NOT EXISTS playtime (
            user_id VARCHAR(50),
                                             guild_id VARCHAR(50),
                                             minutes_played INTEGER DEFAULT 0,
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
