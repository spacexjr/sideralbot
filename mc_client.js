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
            const archived = await canal.threads.fetchArchived({ limit: 100 }).catch(() => ({ threads: new Map() }));
            const foundArchived = archived.threads.find(t => t.name === threadName);
            if (foundArchived) {
                if (foundArchived.archived) {
                    await foundArchived.setArchived(false).catch(err => { console.error('Falha ao reabrir thread arquivada:', err.message); });
                }
                return foundArchived;
            }
        } catch (e) { /* ignore */ }

        // Cria nova
        const created = await canal.threads.create({
            name: threadName,
            autoArchiveDuration: 1440,
            reason: 'Tópico automático de logs do servidor Minecraft'
        });
        return created;
    } catch (err) {
        console.error('getOrCreateLogThread error:', err);
        return null;
    }
}

/**
 * Tenta reconectar o bot Minecraft após um atraso.
 * (Chama conectarMinecraft)
 */
export function tentarReconectar(guildId, client) {
    const t = (tentativasReconexao.get(guildId) || 0) + 1;
    tentativasReconexao.set(guildId, t);
    if (t > 10) return;
    setTimeout(() => { 
        if (!mcClients.has(guildId)) conectarMinecraft(guildId, client); 
    }, Math.min(5000 * t, 30000));
}

/**
 * Inicia a conexão com o servidor Minecraft para uma guilda.
 * (Chama tentarReconectar)
 */
export function conectarMinecraft(guildId, client, interaction = null) {
    if (mcClients.has(guildId) || conectando.has(guildId)) {
        if (interaction) return interaction.editReply('⚠️ Já conectado ou conectando.');
        return;
    }
    conectando.add(guildId);

    carregarConfig(guildId).then(async config => {
        if (!config) { 
            conectando.delete(guildId); 
            if (interaction) return interaction.editReply('⚠️ Use `/setup` primeiro.'); 
            return; 
        }

        let mc;
        try {
            mc = createClient({ host: config.host, port: config.port, version: config.version, username: config.nick, offline: true });
        } catch (err) {
            console.error('createClient error:', err);
            conectando.delete(guildId);
            if (interaction) interaction.editReply(`❌ Falha ao criar cliente: ${err.message || err}`);
            return;
        }

        jogadoresOnline.set(guildId, new Map());
        tentativasReconexao.set(guildId, 0);
        let reconectando = false;

        const sendLog = async (msg) => {
            const thread = await getOrCreateLogThread(guildId, client);
            if (thread) { 
                try { if (thread.archived) await thread.setArchived(false); } catch (e) { /* ignore */ } 
                thread.send(msg).catch(() => {}); 
                return; 
            }
            const canais = await carregarChat(guildId); 
            const canal = client.channels.cache.get(canais[0]);
            if (canal?.type === ChannelType.GuildText) canal.send(msg).catch(() => {});
        };

        sendLog(`🔄 Tentando conectar em ${config.host}:${config.port} como ${config.nick}...`);
        if (interaction) await interaction.editReply(`🔄 Tentando conectar em \`${config.host}:${config.port}\`...`);

        mc.once('join', () => {
            mcClients.set(guildId, mc);
            tentativasReconexao.set(guildId, 0);
            reconectando = false;
            conectando.delete(guildId);
            sendLog(`🟩 Conectado em ${config.host}:${config.port} como ${config.nick}`);
            if (interaction) interaction.editReply(`✅ Conectado em \`${config.host}:${config.port}\` como \`${config.nick}\``);
        });

        // Anexa os handlers de eventos
        attachMcHandlers(mc, guildId, client, config, sendLog);

        mc.on('disconnect', packet => {
            mcClients.delete(guildId);
            conectando.delete(guildId);
            sendLog(`🟥 **Desconectado:** ${packet?.reason || packet?.message || 'Sem mensagem'}`);
            if (!reconectando) {
                reconectando = true;
                sendLog('⚠️ Desconectado. Tentando reconectar...');
                tentarReconectar(guildId, client); // Chamada direta
            }
        });

        mc.on('error', err => {
            console.error(`MC (${guildId}) error:`, err?.message || err);
            sendLog(`❌ **Erro de conexão:** ${err?.message || String(err)}`);
            conectando.delete(guildId);
            if (!reconectando) {
                reconectando = true;
                sendLog('⚠️ Erro detectado. Tentando reconectar...');
                tentarReconectar(guildId, client); // Chamada direta
            }
        });

    }).catch(err => {
        console.error('conectarMinecraft catch:', err);
        conectando.delete(guildId);
    });
}