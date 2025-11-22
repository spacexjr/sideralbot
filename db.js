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

// ----------------------------------------------------------------------
// ---------- Funções de Queries (Configuração) ----------
// ----------------------------------------------------------------------

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

// ----------------------------------------------------------------------
// ---------- Funções de Queries (Chat - Tabela 'chat') ----------
// ----------------------------------------------------------------------

/**
 * Cria a tabela de canais de chat se não existir.
 */
export async function setupChatTable() {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS chat (
      guild_id VARCHAR(20) PRIMARY KEY,
      canais VARCHAR(20)[]
    );
    `);
}

export async function salvarChat(guildId, canais) {
    await pool.query(`INSERT INTO chat (guild_id, canais) VALUES ($1,$2) ON CONFLICT (guild_id) DO UPDATE SET canais = EXCLUDED.canais`, [guildId, canais]);
}

export async function carregarChat(guildId) {
    const r = await pool.query("SELECT canais FROM chat WHERE guild_id=$1", [guildId]);
    return r.rows[0]?.canais || [];
}

// ----------------------------------------------------------------------
// ---------- Funções de Queries (Economia) ----------
// ----------------------------------------------------------------------

/**
 * Cria a tabela de saldos (economy) se não existir.
 */
export async function setupEconomyTable() {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS economy (
      user_id VARCHAR(20) PRIMARY KEY,
      guild_id VARCHAR(20) NOT NULL,
      balance BIGINT DEFAULT 0
    );
    `);
}

/**
 * Obtém o saldo de um usuário.
 * @param {string} userId 
 * @returns {number}
 */
export async function getBalance(userId) {
    const r = await pool.query("SELECT balance FROM economy WHERE user_id=$1", [userId]);
    return parseInt(r.rows[0]?.balance) || 0; 
}

/**
 * Adiciona/remove moedas do saldo de um usuário.
 * Cria o registro se não existir e o atualiza.
 * @param {string} userId 
 * @param {string} guildId 
 * @param {number} amount
 */
export async function updateBalance(userId, guildId, amount) {
    await pool.query(`
    INSERT INTO economy (user_id, guild_id, balance)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id) DO UPDATE SET
      balance = economy.balance + EXCLUDED.balance
    `, [userId, guildId, amount]);
}

/**
 * Obtém o ranking de saldos para uma guilda.
 * @param {string} guildId 
 * @param {number} limit 
 * @returns {{user_id: string, balance: number}[]}
 */
export async function getTopBalances(guildId, limit = 10) {
    const r = await pool.query("SELECT user_id, balance FROM economy WHERE guild_id=$1 ORDER BY balance DESC LIMIT $2", [guildId, limit]);
    return r.rows.map(row => ({ user_id: row.user_id, balance: parseInt(row.balance) }));
}


// ----------------------------------------------------------------------
// ---------- Funções de Queries (Vinculação Nick MC) ----------
// ----------------------------------------------------------------------

/**
 * Cria a tabela de vinculação de nicks MC se não existir.
 */
export async function setupNickTable() {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS nick_vincular (
      user_id VARCHAR(20) PRIMARY KEY,
      mc_nick TEXT UNIQUE NOT NULL
    );
    `);
}

/**
 * Vincula um ID do Discord a um Nick do Minecraft.
 * @param {string} userId 
 * @param {string} mcNick 
 */
export async function vincularNick(userId, mcNick) {
    await pool.query(`
    INSERT INTO nick_vincular (user_id, mc_nick)
    VALUES ($1, $2)
    ON CONFLICT (user_id) DO UPDATE SET
      mc_nick = EXCLUDED.mc_nick
    `, [userId, mcNick.toLowerCase()]); // Salva em minúsculas para consistência
}

/**
 * Obtém o Nick MC vinculado a um ID do Discord.
 * @param {string} userId 
 * @returns {string | null}
 */
export async function getNickVinculado(userId) {
    const r = await pool.query("SELECT mc_nick FROM nick_vincular WHERE user_id=$1", [userId]);
    return r.rows[0]?.mc_nick || null;
}

/**
 * Obtém o ID do Discord vinculado a um Nick MC (para transações MC -> DC).
 * @param {string} mcNick 
 * @returns {string | null}
 */
export async function getUserIdByNick(mcNick) {
    const r = await pool.query("SELECT user_id FROM nick_vincular WHERE mc_nick=$1", [mcNick.toLowerCase()]);
    return r.rows[0]?.user_id || null;
} // <-- ✅ CHAVE DE FECHAMENTO ADICIONADA AQUI

// ----------------------------------------------------------------------
// ---------- Funções de Conexão/Manutenção (Keep-Alive) ----------
// ----------------------------------------------------------------------

/**
 * Executa uma consulta simples para manter a conexão ativa (Keep-Alive) no Pool.
 */
export async function checkDbConnection() {
    // A consulta 'SELECT 1' é a maneira mais leve e eficiente de testar/manter a conexão.
    await pool.query('SELECT 1');
}