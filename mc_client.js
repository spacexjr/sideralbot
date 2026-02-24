// mc_client.js

import { createClient } from 'bedrock-protocol';
import { ChannelType } from 'discord.js';
import { carregarConfig, carregarChat } from './db.js';
import { attachMcHandlers } from './mc_handlers.js';

// Variável exportada de index.js para evitar dependência circular direta
export let USUARIO_AUTORIZADO_ID;
export function setAuthUserId(id) { USUARIO_AUTORIZADO_ID = id; }


// ---------- In-memory maps ----------
export const mcClients = new Map(); // Map<guildId, mcClient>
export const jogadoresOnline = new Map(); // Map<guildId, Map<uuid, username>>
export const tentativasReconexao = new Map(); // Map<guildId, number>
export const conectando = new Set(); // Set<guildId>
export const reconexaoBloqueada = new Set(); // Set<guildId>

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
    
    if (reconexaoBloqueada.has(guildId)) return;
    if (conectando.has(guildId)) return;
    conectando.add(guildId);

    const config = await carregarConfig(guildId);
    if (!config) {
        console.log(`[RECONNECT] Configuração da guilda ${guildId} não encontrada. Abortando.`);
        conectando.delete(guildId);
        return;
    }

    let attempts = tentativasReconexao.get(guildId) || 0;
    attempts++;
    tentativasReconexao.set(guildId, attempts);

    if (attempts > MAX_TENTATIVAS) {
        reconexaoBloqueada.add(guildId);
        sendLogMessage(guildId, client, `❌ Reconexão automática abortada após ${MAX_TENTATIVAS} tentativas. Use /entrar para tentar novamente.`);
        conectando.delete(guildId);
        tentativasReconexao.set(guildId, MAX_TENTATIVAS);
        return;
    }

    sendLogMessage(guildId, client, `⏳ Tentando reconectar (Tentativa ${attempts}/${MAX_TENTATIVAS}) em ${DELAY_MS / 1000}s...`);
    
    setTimeout(async () => {
        await conectarMinecraft(guildId, client, config, null); 
        conectando.delete(guildId);
    }, DELAY_MS);
}

/**
 * Conecta o bot ao servidor Minecraft.
 */
export async function conectarMinecraft(guildId, client, config = null, interaction = null) {
    const sendLog = (message) => sendLogMessage(guildId, client, message);
    let interactionResponded = false;
    const CONNECT_TIMEOUT_MS = 25000;
    const respondInteraction = (content) => {
        if (!interaction || !interaction.deferred || interactionResponded) return;
        interactionResponded = true;
        interaction.editReply(content).catch(e => console.error('Erro ao responder interação:', e.message));
    };
    const normalizeVersion = (v) => {
        if (!v) return undefined;
        const s = String(v).trim().toLowerCase();
        if (!s || s === 'auto' || s === 'latest') return undefined;
        return String(v).trim();
    };
    let timeoutId = null;
    const clearConnectTimeout = () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
    };
    
    if (!config) {
        config = await carregarConfig(guildId);
        if (!config) {
            console.error(`[MC] Configuração não encontrada para guild ${guildId}`);
            respondInteraction('⚠️ Use `/setup` primeiro.');
            return;
        }
    }
    
    if (!config.host || !config.port || !config.nick) {
        console.error(`[MC] Configuração inválida para guild ${guildId}:`, config);
        respondInteraction('⚠️ Configuração incompleta. Use `/setup` novamente.');
        return;
    }
    if (interaction) {
        reconexaoBloqueada.delete(guildId);
        tentativasReconexao.set(guildId, 0);
    }
    
    if (mcClients.has(guildId)) {
        const existingClient = mcClients.get(guildId);
        if (existingClient && !existingClient.closed) {
            console.log(`[MC] Guild ${guildId} já possui conexão ativa.`);
            respondInteraction('⚠️ O bot já está conectado ao servidor.');
            return;
        } else {
            mcClients.delete(guildId);
        }
    }
    
    conectando.add(guildId);
    jogadoresOnline.set(guildId, new Map());

    try {
        console.log(`[MC] Conectando à ${config.host}:${config.port} como ${config.nick}...`);
        
        const version = normalizeVersion(config.version);
        const mc = createClient({
            host: config.host,
            port: config.port,
            username: config.nick,
            version,
            skipPing: !version ? false : true,
            offline: true,
        });

        mcClients.set(guildId, mc);
        timeoutId = setTimeout(() => {
            if (mcClients.get(guildId) !== mc) return;
            const msg = `Timeout ao conectar em ${config.host}:${config.port} (${CONNECT_TIMEOUT_MS / 1000}s sem spawn)`;
            console.error(`[MC] ${msg}`);
            sendLog(`❌ ${msg}`);
            respondInteraction(`❌ ${msg}. Verifique IP/porta/versão e se o servidor Bedrock está online.`);
            try { mc.close(msg); } catch (e) { /* ignore */ }
            mcClients.delete(guildId);
            conectando.delete(guildId);
            tentarReconectar(guildId, client);
        }, CONNECT_TIMEOUT_MS);
        
        mc.once('spawn', () => {
            clearConnectTimeout();
            console.log(`[MC] Guild ${guildId} spawnou no servidor.`);
            
            // ✅ LOG DE MÉTODOS DISPONÍVEIS
            const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(mc));
            console.log('[MC METHODS]', proto);

            tentativasReconexao.set(guildId, 0);
            reconexaoBloqueada.delete(guildId);
            conectando.delete(guildId);
            
            respondInteraction(`✅ Conectado em \`${config.host}:${config.port}\` como \`${config.nick}\``);

            sendLog(`🟩 Conectado em ${config.host}:${config.port} como ${config.nick}`);
        });

        attachMcHandlers(mc, guildId, client, config, sendLog);

        mc.on('disconnect', packet => {
            clearConnectTimeout();
            console.log(`[DISCONNECT FULL]`, JSON.stringify(packet));
            console.log(`[MC] Guild ${guildId} desconectou:`, packet?.reason || packet?.message || 'Sem mensagem');
            mcClients.delete(guildId);
            conectando.delete(guildId);
            
            const reason = packet?.reason || packet?.message || 'Desconectado';
            sendLog(`🟥 **Desconectado:** ${reason}`);
            respondInteraction(`❌ Falha ao conectar/desconectado: ${reason}`);
            
            if (reason !== 'Comando /sair' && !reason.includes('disconnect.kicked')) {
                tentarReconectar(guildId, client); 
            } else {
                tentativasReconexao.set(guildId, 0);
            }
        });

        mc.on('error', err => {
            clearConnectTimeout();
            console.error(`[MC] Guild ${guildId} error:`, err?.message || err);
            sendLog(`❌ **Erro de conexão:** ${err?.message || String(err)}`);
            respondInteraction(`❌ Erro de conexão: ${err?.message || String(err)}`);
            
            if (mcClients.get(guildId) === mc) {
                mcClients.delete(guildId);
            }
            conectando.delete(guildId);
            
            tentarReconectar(guildId, client);
        });

        mc.on('close', () => {
            clearConnectTimeout();
            console.log(`[MC] Guild ${guildId} conexão fechada.`);
            if (mcClients.get(guildId) === mc) {
                mcClients.delete(guildId);
            }
        });

    } catch (err) { 
        clearConnectTimeout();
        console.error('[MC] conectarMinecraft catch (Síncrono):', err);
        mcClients.delete(guildId);
        conectando.delete(guildId);

        if (interaction && interaction.deferred) {
             respondInteraction(`❌ Erro ao iniciar a conexão ao servidor ${config.host}:${config.port}: ${err.message}`);
        }
        
        sendLog(`❌ Erro crítico ao conectar: ${err.message}`);
        tentarReconectar(guildId, client);
    }
}
