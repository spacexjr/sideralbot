import { ChannelType, EmbedBuilder } from 'discord.js';
import { ping } from 'bedrock-protocol';
import { carregarChat, carregarConfig } from './db.js';
import { askAI } from './ai_service.js';
import { 
    jogadoresOnline, 
    getOrCreateLogThread, 
    tentativasReconexao, 
    mcClients, 
    conectando,
    USUARIO_AUTORIZADO_ID
} from './mc_client.js';


/**
 * Testa o servidor Minecraft usando ping.
 */
async function testarServidor(config) {
    try {
        const status = await ping({ 
            host: config.host, 
            port: config.port, 
            timeout: 10000 
        });
        return { 
            online: true, 
            jogadores: status.playersOnline || 0, 
            max: status.playersMax || 20, 
            playersSample: status.playersSample || [] 
        };
    } catch (err) {
        console.error('Erro ao pingar servidor:', err.message);
        return { online: false };
    }
}


/**
 * Remove códigos de cor/formatação do Minecraft de uma string.
 */
function stripColor(str) {
    return (str || '').replace(/§[0-9a-fklmnor]/gi, '').trim();
}


/**
 * Envia mensagem de chat do MC para o canal do Discord.
 */
async function sendChatToChannel(guildId, client, author, texto, botNick) {
    try {
        // Ignora mensagens do próprio bot (compara já sem códigos de cor)
        if (!author) return;
        if (author === botNick) return;
        if (author === 'IA') return;

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
            if (!packet.message) return;

            const raw = (packet.message || '').trim();
            const noColor = stripColor(raw);

            // ✅ CORREÇÃO: remove §r e outros códigos do source_name antes de comparar
            const sourceName = stripColor(packet.source_name || '');

            const params = packet.parameters || [];

            // Ignora mensagens originadas pelo próprio bot (nick, IA, formato DC->MC)
            const isOwnMessage =
                sourceName === config.nick ||
                sourceName === 'IA' ||
                noColor.startsWith(`<${config.nick}>`) ||
                raw.startsWith(`§1 <${config.nick}>`) ||
                raw.startsWith(`§5 <${config.nick}>`) ||
                raw.startsWith('§c<IA>');

            if (isOwnMessage) return;

            // 1. Detecção de Join/Leave
            const isJoin = /%multiplayer\.player\.joined/i.test(raw) || / entrou no jogo$/i.test(noColor) || / joined the game$/i.test(noColor);
            const isLeave = /%multiplayer\.player\.left/i.test(raw) || / saiu do jogo$/i.test(noColor) || / left the game$/i.test(noColor);
            const playerName = params[0] || sourceName || 'Jogador';

            // 2. Detecção de Morte
            const isDeathKey = raw.toLowerCase().includes('death.attack.');
            const isDeathText = noColor.toLowerCase().includes('morreu') || noColor.toLowerCase().includes('died');
            const isTranslationDeath = packet.type === 'translation' && raw.startsWith('death.'); 
            const isDeath = isDeathKey || isDeathText || isTranslationDeath;

            // 3. Detecção de outros eventos de sistema
            const isSystemEvent = (packet.type === 'system' || packet.type === 'tip' || packet.type === 'announcement') && !isJoin && !isLeave && !isDeath;
            const isAdvancement = isSystemEvent && (raw.startsWith('%') || noColor.toLowerCase().includes('concluiu o desafio') || noColor.toLowerCase().includes('achievement'));


            // SYSTEM EVENTS (JOIN/LEAVE/DEATH/ADVANCEMENT) -> thread logs
            if (isJoin || isLeave || isDeath || isAdvancement) {
                const thread = await getOrCreateLogThread(guildId, client);
                const fallbackSend = async (text) => {
                    const canais = await carregarChat(guildId);
                    const canal = client.channels.cache.get(canais[0]);
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
                    const prefix = isDeath ? '💀' : '⭐';
                    let logMsg;
                    const nomeJogador = params[0] && params[0] !== 'Jogador' ? params[0] : 'Um jogador';
                    
                    if (isDeath) {
                        const causaKey = (isTranslationDeath || isDeathKey) ? raw : noColor;
                        logMsg = `**${nomeJogador} Morreu** Causa: ${causaKey}`;
                    } else if (isAdvancement) {
                        logMsg = raw.startsWith('%') ? `[AVANÇO CHAVE] ${raw}` : noColor;
                    }

                    return logSender(`${prefix} ${logMsg}`);
                }
                return;
            }

            // Ignorar logs de sistema/tip que não são eventos logáveis
            if ((packet.type === 'system' || packet.type === 'tip' || packet.type === 'announcement' || packet.type === 'whisper') || sourceName === '') {
                return;
            }

            // NORMAL CHAT
            if (sourceName) {
                if (noColor.startsWith('!c ')) {
                    const prompt = noColor.slice(3).trim();
                    const aiReply = await askAI(prompt);
                    const chatPacket = {
                        needs_translation: false,
                        category: 'authored',
                        type: 'chat',
                        source_name: '§cIA',
                        message: String(`§c<IA> ${aiReply}`).replace(/[\r\n]+/g, ' ').trim().slice(0, 250),
                        xuid: '',
                        platform_chat_id: '',
                        has_filtered_message: false,
                        filtered_message: ''
                    };
                    if (typeof mc.queue === 'function') {
                        mc.queue('text', chatPacket);
                    } else if (typeof mc.write === 'function') {
                        mc.write('text', chatPacket);
                    } else {
                        throw new Error('Cliente MC sem método de envio de pacote.');
                    }
                    return;
                }

                // sourceName já está sem códigos de cor, config.nick também será comparado limpo
                await sendChatToChannel(guildId, client, sourceName, noColor, config.nick);
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

// ---------------------------------------------------------------------

/**
 * Manipula o comando /status do Discord.
 */
export async function handleStatusCommand(interaction, client, guildId) {
    const sent = interaction.createdTimestamp;
    
    const config = await carregarConfig(guildId);
    if (!config) {
        return interaction.editReply('⚠️ Use `/setup` primeiro.');
    }

    const mcClient = mcClients.get(guildId);
    const mcIsConnected = !!(mcClient && !mcClient.closed);
    const isConnecting = conectando.has(guildId);
    const tentativas = tentativasReconexao.get(guildId) || 0;

    const serverTest = await testarServidor(config);
    
    let serverStatus = "❌ Offline";
    let serverStatusColor = 0xe74c3c;
    
    if (serverTest.online) {
        serverStatus = `✅ Online | ${serverTest.jogadores}/${serverTest.max}`;
        serverStatusColor = 0x2ecc71;
    }

    let botStatusEmoji, botStatusText;
    if (mcIsConnected) {
        botStatusEmoji = '✅';
        botStatusText = 'Conectado';
    } else if (isConnecting) {
        botStatusEmoji = '🔄';
        botStatusText = `Reconectando (${tentativas}ª tentativa)`;
        serverStatusColor = 0xffa500;
    } else {
        botStatusEmoji = '❌';
        botStatusText = 'Desconectado';
    }

    const dados = jogadoresOnline.get(guildId) || new Map();
    let jogadoresTexto = "👥 Nenhum jogador online";
    
    if (serverTest.playersSample && serverTest.playersSample.length > 0) {
        const nomes = serverTest.playersSample.map(p => p.name).join(', ');
        jogadoresTexto = `👥 Jogadores: ${nomes}`;
    } else if (dados.size > 0) {
        const jogadores = Array.from(dados.values()).filter(name => typeof name === 'string' && name !== 'Jogador');
        if (jogadores.length > 0) {
            jogadoresTexto = `👥 Jogadores: ${jogadores.join(', ')}`;
        }
    }

    let diasInfo = '';
    if (dados.diasServidor !== undefined) {
        diasInfo = `\n⏳ Dias no servidor: ${dados.diasServidor}`;
    }

    const discordPing = Date.now() - sent;
    const apiPing = client.ws.ping;

    const embed = new EmbedBuilder()
        .setColor(serverStatusColor)
        .setTitle('🏓 Pong!')
        .setDescription(
            `📡 **Discord**: ${discordPing}ms\n` +
            `🌐 **API**: ${apiPing}ms\n` +
            `🎮 **Servidor**: ${serverStatus}\n` +
            `🤖 **Bot**: ${botStatusEmoji} ${botStatusText}\n` +
            `${jogadoresTexto}${diasInfo}`
        )
        .setTimestamp()
        .setFooter({ 
            text: `Requisitado por ${interaction.user.username}`,
            iconURL: interaction.user.displayAvatarURL()
        });

    try {
        await interaction.editReply({ embeds: [embed] });
    } catch (e) {
        console.error('Erro ao enviar /status:', e);
        await interaction.editReply({ content: '❌ Ocorreu um erro ao obter o status.' }).catch(() => {});
    }
}
