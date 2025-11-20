// mc_client.js

import { createClient } from 'bedrock-protocol';
import { ChannelType } from 'discord.js';
import { carregarConfig, carregarChat } from './db.js';
import { attachMcHandlers } from './mc_handlers.js';

// Variável exportada de index.js para evitar dependência circular direta
export let USUARIO_AUTORIZADO_ID;
export function setAuthUserId(id) { USUARIO_AUTORIZADO_ID = id; }


// ---------- In-memory maps ----------
export const mcClients = new Map();
export const jogadoresOnline = new Map();
export const tentativasReconexao = new Map();
export const conectando = new Set();

/**
 * Obtém ou cria o thread de logs.
 */
export async function getOrCreateLogThread(guildId, client) {
    try {
        const canais = await carregarChat(guildId);
        if (!canais || canais.length === 0) return null;
        const canal = client.channels.cache.get(canais[0]);
        if (!canal || canal.type !== ChannelType.GuildText || !canal.threads) return null;

        const threadName = '「🔗」logs-mine';

        // Tenta threads ativas e arquivadas
        try {
            const active = await canal.threads.fetchActive().catch(() => ({ threads: new Map() }));
            const foundActive = active.threads.find(t => t.name === threadName);
            if (foundActive) return foundActive;
        } catch (e) { /* ignore */ }
        
        try {
            const archived = await canal.threads.fetchArchived().catch(() => ({ threads: new Map() }));
            const foundArchived = archived.threads.find(t => t.name === threadName);
            if (foundArchived) return foundArchived;
        } catch (e) { /* ignore */ }

        // Cria thread se não encontrada
        return await canal.threads.create({ name: threadName, reason: 'Log de conexão com o MC' });
    } catch (e) {
        console.error(`Erro ao obter/criar log thread para guilda ${guildId}:`, e);
        return null;
    }
}

/**
 * Função de log que envia mensagens para o thread de logs.
 */
async function sendLogMessage(guildId, client, message) {
    const thread = await getOrCreateLogThread(guildId, client);
    if (thread) {
        thread.send(message).catch(e => console.error('Erro ao enviar log para thread:', e));
    }
}

/**
 * Tenta reconectar a um servidor.
 */
async function tentarReconectar(guildId, client) {
    const MAX_TENTATIVAS = 10;
    const DELAY_MS = 10000;
    
    if (conectando.has(guildId)) return;
    conectando.add(guildId);

    const config = await carregarConfig(guildId);
    if (!config) return console.log(`[RECONNECT] Configuração da guilda ${guildId} não encontrada. Abortando.`);

    let attempts = tentativasReconexao.get(guildId) || 0;
    attempts++;
    tentativasReconexao.set(guildId, attempts);

    if (attempts > MAX_TENTATIVAS) {
        sendLogMessage(guildId, client, `❌ Abortando reconexão após ${MAX_TENTATIVAS} tentativas.`);
        conectando.delete(guildId);
        return;
    }

    sendLogMessage(guildId, client, `⏳ Tentando reconectar (Tentativa ${attempts}/${MAX_TENTATIVAS}) em ${DELAY_MS / 1000}s...`);
    
    setTimeout(async () => {
        // Tenta a conexão, sem a interação do Discord.
        await conectarMinecraft(guildId, client, config, null); 
        conectando.delete(guildId);
    }, DELAY_MS);
}

/**
 * Conecta o bot ao servidor Minecraft.
 * @param {string} guildId 
 * @param {import('discord.js').Client} client 
 * @param {*} config 
 * @param {import('discord.js').ChatInputCommandInteraction | null} interaction 
 */
export async function conectarMinecraft(guildId, client, config, interaction = null) {
    const sendLog = (message) => sendLogMessage(guildId, client, message);
    
    // Marca como conectando para evitar múltiplas chamadas
    conectando.add(guildId);

    // ✅ CORREÇÃO CRÍTICA: createClient é síncrona. Remove .then() e usa try/catch.
    try {
        const mc = createClient({
            host: config.host,
            port: config.port,
            username: config.nick,
            version: config.version,
            skipPing: true,
            offline: true,
            // Se o seu servidor Bedrock é Java via Geyser, adicione:
            // protocol: 'java',
        });

        mcClients.set(guildId, mc);
        
        // Log de sucesso de conexão
        mc.on('spawn', () => {
            tentativasReconexao.set(guildId, 0);
            
            // Garante que a interação existe e foi deferida (respondida)
            if (interaction && interaction.deferred) { 
                interaction.editReply(`✅ Conectado em \`${config.host}:${config.port}\` como \`${config.nick}\``)
                    .catch(e => console.error("Erro ao dar feedback no Discord após conectar:", e.message));
            }

            sendLog(`🟩 Conectado em ${config.host}:${config.port} como ${config.nick}`);
        });

        // Anexa os handlers de eventos
        attachMcHandlers(mc, guildId, client, config, sendLog);

        mc.on('disconnect', packet => {
            mcClients.delete(guildId);
            conectando.delete(guildId);
            sendLog(`🟥 **Desconectado:** ${packet?.reason || packet?.message || 'Sem mensagem'}`);
            
            // Tenta reconectar, exceto se for desconexão manual
            if (packet?.reason !== 'Comando /sair') {
                tentarReconectar(guildId, client); 
            }
        });

        mc.on('error', err => {
            console.error(`MC (${guildId}) error:`, err?.message || err);
            sendLog(`❌ **Erro de conexão:** ${err?.message || String(err)}`);
            conectando.delete(guildId);
            
            // Tenta reconectar
            tentarReconectar(guildId, client);
        });

    } catch (err) { // Captura erros síncronos de createClient
        console.error('conectarMinecraft catch (Síncrono):', err);
        conectando.delete(guildId);

        // Envia a resposta de erro para a interação do Discord
        if (interaction && interaction.deferred) {
             interaction.editReply(`❌ Erro ao iniciar a conexão ao servidor ${config.host}:${config.port}: ${err.message}`)
                 .catch(e => console.error("Erro ao dar feedback de falha de conexão:", e.message));
        }
        
        // Lógica de reconexão
        tentarReconectar(guildId, client);
    }
}