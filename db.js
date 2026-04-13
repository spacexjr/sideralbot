// db.js
import mysql from 'mysql2/promise';
import { sleep } from './utils.js';

// ---------- Pool de Conexão ----------
// Configurado para MySQL (Shockbyte)
const pool = mysql.createPool({
    uri: process.env.DATABASE_URL,
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    ssl: { rejectUnauthorized: false } // Necessário para a maioria das hospedagens como Shockbyte
});

// ---------- Funções de Conexão ----------
export async function esperarPostgres(retries = 10, delay = 2000) {
    for (let i = 1; i <= retries; i++) {
        try {
            await pool.query('SELECT 1');
            console.log('📦 MySQL online');
            return;
        } catch (e) {
            console.log(`⏳ MySQL iniciando... ${i}/${retries}`);
            await sleep(delay);
        }
    }
    console.error('❌ MySQL não iniciou após várias tentativas. Saindo.');
    process.exit(1);
}

// ---------- Funções de Queries (Configuração) ----------

export async function salvarConfig(guildId, ip, porta, versao, nick, canais, cargos) {
    await pool.query(`
    INSERT INTO configs (guild_id, host, port, version, nick, canais, cargos)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
    host = VALUES(host),
                     port = VALUES(port),
                     version = VALUES(version),
                     nick = VALUES(nick),
                     canais = VALUES(canais),
                     cargos = VALUES(cargos)
                     `, [guildId, ip, porta, versao, nick, JSON.stringify(canais), JSON.stringify(cargos)]);
}

export async function carregarConfig(guildId) {
    const [rows] = await pool.query("SELECT * FROM configs WHERE guild_id=?", [guildId]);
    if (!rows[0]) return null;

    const res = rows[0];

    // Tratamento robusto para evitar o erro "Unexpected non-whitespace character"
    const safeParse = (data) => {
        if (!data) return [];
        if (typeof data !== 'string') return data; // Se o driver já converter para objeto
        try {
            return JSON.parse(data);
        } catch (e) {
            console.warn(`⚠️ Dados inválidos na coluna de config para a guilda ${guildId}. Resetando para [].`);
            return [];
        }
    };

    return {
        ...res,
        canais: safeParse(res.canais),
        cargos: safeParse(res.cargos)
    };
}

// ---------- Funções de Queries (Chat) ----------

export async function setupChatTable() {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS chat (
        guild_id VARCHAR(50) PRIMARY KEY,
                                     canais JSON
    );
    `);
}

export async function salvarChat(guildId, canais) {
    await pool.query(`
    INSERT INTO chat (guild_id, canais) VALUES (?, ?)
    ON DUPLICATE KEY UPDATE canais = VALUES(canais)
    `, [guildId, JSON.stringify(canais)]);
}

export async function carregarChat(guildId) {
    const [rows] = await pool.query("SELECT canais FROM chat WHERE guild_id=?", [guildId]);
    if (!rows[0]) return [];

    // O MySQL com driver mysql2 já costuma fazer o parse automático de colunas tipo JSON
    const data = rows[0].canais;
    return typeof data === 'string' ? JSON.parse(data) : (data || []);
}

// ---------- Funções de Queries (Playtime) ----------

export async function setupPlaytimeTable() {
    await pool.query(`DROP TABLE IF EXISTS economy;`);
    await pool.query(`
    CREATE TABLE IF NOT EXISTS playtime (
        user_id VARCHAR(50) NOT NULL,
                                         guild_id VARCHAR(50) NOT NULL,
                                         minutes_played INTEGER DEFAULT 0,
                                         PRIMARY KEY (user_id, guild_id)
    );
    `);
}

export async function addPlaytime(userId, guildId, minutes) {
    await pool.query(`
    INSERT INTO playtime (user_id, guild_id, minutes_played)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE
    minutes_played = minutes_played + VALUES(minutes_played)
    `, [userId, guildId, minutes]);
}

export async function getPlaytime(userId, guildId) {
    const [rows] = await pool.query(
        "SELECT minutes_played FROM playtime WHERE user_id=? AND guild_id=?",
        [userId, guildId]
    );
    return parseInt(rows[0]?.minutes_played) || 0;
}

export async function getTopPlaytime(guildId) {
    const [rows] = await pool.query(
        "SELECT user_id, minutes_played FROM playtime WHERE guild_id=? ORDER BY minutes_played DESC LIMIT 10",
        [guildId]
    );
    return rows.map(row => ({
        user_id: row.user_id,
        minutes_played: parseInt(row.minutes_played)
    }));
}

// ---------- Funções de Queries (Vinculação Nick MC) ----------

export async function setupNickTable() {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS nick_vincular (
        user_id VARCHAR(50) PRIMARY KEY,
                                              mc_nick VARCHAR(100) UNIQUE NOT NULL
    );
    `);
}

export async function vincularNick(userId, mcNick) {
    await pool.query(`
    INSERT INTO nick_vincular (user_id, mc_nick)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE
    mc_nick = VALUES(mc_nick)
    `, [userId, mcNick.toLowerCase()]);
}

export async function getNickVinculado(userId) {
    const [rows] = await pool.query("SELECT mc_nick FROM nick_vincular WHERE user_id=?", [userId]);
    return rows[0]?.mc_nick || null;
}

export async function getUserIdByNick(mcNick) {
    const [rows] = await pool.query("SELECT user_id FROM nick_vincular WHERE mc_nick=?", [mcNick.toLowerCase()]);
    return rows[0]?.user_id || null;
}

// ---------- Manutenção ----------

export async function checkDbConnection() {
    await pool.query('SELECT 1');
}
