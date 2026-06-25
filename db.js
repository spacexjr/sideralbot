// db.js
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { sleep } from './utils.js';

// ---------- Configuração do Lowdb ----------
const __dirname = dirname(fileURLToPath(import.meta.url));
const file = join(__dirname, 'db.json');

// Define a estrutura padrão do seu banco de dados JSON
const defaultData = { 
    configs: [], 
    chat: [], 
    playtime: [], 
    nick_vincular: [] 
};

const adapter = new JSONFile(file);
const db = new Low(adapter, defaultData);

// Inicializa o banco de dados e garante que ele tenha a estrutura correta
export async function esperarPostgres(retries = 5, delay = 1000) {
    // Mantive o nome da função para não quebrar seus imports no index.js, 
    // mas agora ela apenas lê o arquivo JSON local.
    for (let i = 1; i <= retries; i++) {
        try {
            await db.read();
            // Garante que se o arquivo estiver vazio, ele use a estrutura padrão
            db.data ||= defaultData;
            await db.write();
            console.log('📦 Lowdb (JSON) online e pronto!');
            return;
        } catch (e) {
            console.log(`⏳ Inicializando Lowdb... ${i}/${retries}`);
            await sleep(delay);
        }
    }
    console.error('❌ Não foi possível carregar o arquivo do Lowdb.');
    process.exit(1);
}

// ---------- Funções de Tabelas (Simuladas) ----------
// No Lowdb não precisamos criar tabelas, basta garantir que os arrays existam.
export async function setupChatTable() { db.data.chat ||= []; await db.write(); }
export async function setupPlaytimeTable() { db.data.playtime = []; await db.write(); } // Drop economy/playtime simulado
export async function setupNickTable() { db.data.nick_vincular ||= []; await db.write(); }

// ---------- Funções de Queries (Configuração) ----------

export async function salvarConfig(guildId, ip, porta, versao, nick, canais, cargos) {
    await db.read();
    const index = db.data.configs.findIndex(c => c.guild_id === guildId);

    const novaConfig = {
        guild_id: guildId,
        host: ip,
        port: porta,
        version: versao,
        nick: nick,
        canais: canais, // Salva como objeto/array direto, sem precisar de JSON.stringify
        cargos: cargos
    };

    if (index !== -1) {
        db.data.configs[index] = novaConfig; // ON DUPLICATE KEY UPDATE
    } else {
        db.data.configs.push(novaConfig);
    }
    await db.write();
}

export async function carregarConfig(guildId) {
    await db.read();
    const config = db.data.configs.find(c => c.guild_id === guildId);
    if (!config) return null;

    // Como salvamos direto em JSON, não há risco de problemas de parse que o driver do MySQL causava
    return {
        ...config,
        canais: config.canais || [],
        cargos: config.cargos || []
    };
}

// ---------- Funções de Queries (Chat) ----------

export async function salvarChat(guildId, canais) {
    await db.read();
    const index = db.data.chat.findIndex(c => c.guild_id === guildId);

    if (index !== -1) {
        db.data.chat[index].canais = canais;
    } else {
        db.data.chat.push({ guild_id: guildId, canais: canais });
    }
    await db.write();
}

export async function carregarChat(guildId) {
    await db.read();
    const chat = db.data.chat.find(c => c.guild_id === guildId);
    return chat ? chat.canais : [];
}

// ---------- Funções de Queries (Playtime) ----------

export async function addPlaytime(userId, guildId, minutes) {
    await db.read();
    const registro = db.data.playtime.find(p => p.user_id === userId && p.guild_id === guildId);

    if (registro) {
        registro.minutes_played += minutes;
    } else {
        db.data.playtime.push({
            user_id: userId,
            guild_id: guildId,
            minutes_played: minutes
        });
    }
    await db.write();
}

export async function getPlaytime(userId, guildId) {
    await db.read();
    const registro = db.data.playtime.find(p => p.user_id === userId && p.guild_id === guildId);
    return registro ? parseInt(registro.minutes_played) : 0;
}

export async function getTopPlaytime(guildId) {
    await db.read();
    return db.data.playtime
        .filter(p => p.guild_id === guildId)
        .sort((a, b) => b.minutes_played - a.minutes_played)
        .slice(0, 10)
        .map(row => ({
            user_id: row.user_id,
            minutes_played: parseInt(row.minutes_played)
        }));
}

// ---------- Funções de Queries (Vinculação Nick MC) ----------

export async function vincularNick(userId, mcNick) {
    await db.read();
    const nickLower = mcNick.toLowerCase();
    
    // Simula a restrição UNIQUE do banco de dados (remover vínculos antigos com esse mesmo nick, se houver)
    db.data.nick_vincular = db.data.nick_vincular.filter(n => n.mc_nick !== nickLower);

    const index = db.data.nick_vincular.findIndex(n => n.user_id === userId);
    if (index !== -1) {
        db.data.nick_vincular[index].mc_nick = nickLower;
    } else {
        db.data.nick_vincular.push({ user_id: userId, mc_nick: nickLower });
    }
    await db.write();
}

export async function getNickVinculado(userId) {
    await db.read();
    const registro = db.data.nick_vincular.find(n => n.user_id === userId);
    return registro ? registro.mc_nick : null;
}

export async function getUserIdByNick(mcNick) {
    await db.read();
    const registro = db.data.nick_vincular.find(n => n.mc_nick === mcNick.toLowerCase());
    return registro ? registro.user_id : null;
}

// ---------- Manutenção ----------

export async function checkDbConnection() {
    // Apenas garante que o arquivo é legível para validar o "healthcheck"
    await db.read();
}