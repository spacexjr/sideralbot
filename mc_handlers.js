// mc_handlers.js

import { ChannelType } from 'discord.js';
import { carregarChat } from './db.js';
import { 
    jogadoresOnline, 
    getOrCreateLogThread, 
    tentativasReconexao, 
    mcClients, 
    conectando,
    USUARIO_AUTORIZADO_ID // Importado do mc_client, que o mc_client importa do index.js
} from './mc_client.js';


/**
 * Envia mensagem de chat do MC para o canal do Discord.
 */
async function sendChatToChannel(guildId, client, author, texto) {
    try {
        const canais = await carregarChat(guildId);
        if (!canais || canais.length === 0) return;
        const canal = client.channels.cache.get(canais[0]);
        if (!canal || canal.type !== ChannelType.GuildText) return;

        let textoFormatado = texto;

        if (USUARIO_AUTORIZADO_ID) textoFormatado = textoFormatado.replace(/@space/gi, `<@${USUARIO_AUTORIZADO_ID}>`);

        const guild = client.guilds.cache.get(guildId);
        if (guild) {
            guild.members.cache.forEach(m => {
                const nomeExibicao = m.user.username;
                if (!nomeExibicao) return;
                const esc = nomeExibicao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                textoFormatado = textoFormatado.replace(new RegExp(`@${esc}`, 'gi'), `<@${m.id}>`);
            });
        }
        canal.send(`💬 **${author}**: ${textoFormatado}`).catch(() => {});
    } catch (e) { console.error('sendChatToChannel error:', e); }
}


/**
 * Anexa todos os manipuladores de eventos do Minecraft ao cliente MC.
 */
export function attachMcHandlers(mc, guildId, client, config, sendLog) {
    
    /* ---------- MC text handler: chat, join/leave, death, advancement ---------- */
    mc.on('text', async packet => {
        try {
            if (!packet.message || (packet.source_name && packet.source_name === config.nick)) return;

            const raw = (packet.message || '').trim();
            const noColor = raw.replace(/§[0-9a-fklmnor]/gi, '').trim();
            const params = packet.parameters || [];

            // 1. Deteção de Join/Leave
            const isJoin = /%multiplayer\.player\.joined/i.test(raw) || / entrou no jogo$/i.test(noColor) || / joined the game$/i.test(noColor);
            const isLeave = /%multiplayer\.player\.left/i.test(raw) || / saiu do jogo$/i.test(noColor) || / left the game$/i.test(noColor);
            const playerName = params[0] || packet.source_name || 'Jogador';

            // 2. Deteção de Morte (type: translation ou chave/texto)
            const isDeathKey = raw.toLowerCase().includes('death.attack.');
            const isDeathText = noColor.toLowerCase().includes('morreu') || noColor.toLowerCase().includes('died');
            const isTranslationDeath = packet.type === 'translation' && raw.startsWith('death.'); 
            const isDeath = isDeathKey || isDeathText || isTranslationDeath;

            // 3. Deteção de outros eventos de sistema (Avances, Tips)
            const isSystemEvent = (packet.type === 'system' || packet.type === 'tip' || packet.type === 'announcement') && !isJoin && !isLeave && !isDeath;
            const isAdvancement = isSystemEvent && (raw.startsWith('%') || noColor.toLowerCase().includes('concluiu o desafio') || noColor.toLowerCase().includes('achievement'));


            // SYSTEM EVENTS (JOIN/LEAVE/DEATH/ADVANCEMENT) -> thread logs
            if (isJoin || isLeave || isDeath || isAdvancement) {
                const thread = await getOrCreateLogThread(guildId, client);
                const fallbackSend = async (text) => {
                    const canais = await carregarChat(guildId); const canal = client.channels.cache.get(canais[0]);
                    if (canal?.type === ChannelType.GuildText) canal.send(text).catch(() => {});
                };

                const logSender = thread ? (txt) => { 
                    try { if (thread.archived) thread.setArchived(false); } catch (e) { /* ignore */ } 
                    return thread.send(txt).catch(() => {}); 
                } : fallbackSend;

                if (isJoin) {
                    const txt = (playerName && playerName !== 'Jogador') ? `🟢 **${playerName} entrou no servidor**` : `🟢 **Um jogador entrou no servidor**`;
                    return logSender(txt);
                }
                if (isLeave) {
                    const txt = (playerName && playerName !== 'Jogador') ? `🔴 **${playerName} saiu do servidor**` : `🔴 **Um jogador saiu do servidor**`;
                    return logSender(txt);
                }
                
                if (isDeath || isAdvancement) {
                    let prefix = isDeath ? '💀' : '⭐';
                    let logMsg;
                    const nomeJogador = params[0] && params[0] !== 'Jogador' ? params[0] : 'Um jogador';
                    
                    if (isDeath) {
                        let causaKey = raw;
                        if (isTranslationDeath || isDeathKey) {
                            causaKey = raw; 
                        } else {
                            causaKey = noColor;
                        }
                        logMsg = `**${nomeJogador} Morreu** Causa: ${causaKey}`;
                    } else if (isAdvancement) {
                        logMsg = raw.startsWith('%') ? `[AVANÇO CHAVE] ${raw}` : noColor;
                    }

                    return logSender(`${prefix} ${logMsg}`);
                }
                return;
            }

            // Ignorar logs de sistema/tip que não são eventos logáveis
            if ((packet.type === 'system' || packet.type === 'tip' || packet.type === 'announcement' || packet.type === 'whisper') || packet.source_name === '') {
                return;
            }

            // NORMAL CHAT
            if (packet.source_name) {
                await sendChatToChannel(guildId, client, packet.source_name, noColor);
            }

        } catch (err) {
            console.error('mc.on(text) handler error:', err);
        }
    });

    /* ---------- MC player list update ---------- */
    mc.on('player_list', packet => {
        try {
            const mapa = jogadoresOnline.get(guildId) || new Map();
            const records = packet.records?.records || packet.records || packet.entries || [];
            const type = packet.records?.type || packet.action || null;
            
            if (type === 'add' || packet.action === 'add') {
                (records || []).forEach(r => mapa.set(r.uuid || r.xuid || r.name, r.username || r.name));
            } else if (type === 'remove' || packet.action === 'remove') {
                (records || []).forEach(r => mapa.delete(r.uuid || r.xuid || r.name));
            }
            jogadoresOnline.set(guildId, mapa);
        } catch (e) { console.error('player_list error:', e); }
    });

    /* ---------- MC server time (days) update ---------- */
    mc.on('set_time', packet => {
        try {
            const dias = Math.floor(packet.time / 24000);
            const dados = jogadoresOnline.get(guildId) || new Map();
            dados.diasServidor = dias;
            jogadoresOnline.set(guildId, dados);
        } catch (e) { /* ignore */ }
    });
}