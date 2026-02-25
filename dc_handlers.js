// dc_handlers.js

import {
    EmbedBuilder, MessageFlags
} from 'discord.js';
import {
    salvarConfig, salvarChat, carregarConfig, carregarChat,
    getPlaytime, getTopPlaytime,
    vincularNick, getNickVinculado
} from './db.js';
import {
    conectarMinecraft, mcClients, conectando, getOrCreateLogThread, USUARIO_AUTORIZADO_ID
} from './mc_client.js';
import { handleStatusCommand } from './mc_handlers.js';
import { parseMentions } from './utils.js';

function formatarTempo(minutos) {
    const totalMinutos = Math.max(0, Number(minutos) || 0);
    const horas = Math.floor(totalMinutos / 60);
    const minutosRestantes = totalMinutos % 60;

    if (horas === 0) return `${minutosRestantes}min`;
    if (minutosRestantes === 0) return `${horas}h`;
    return `${horas}h ${minutosRestantes}min`;
}

/**
 * Lida com a execução de comandos Slash.
 */
export async function handleInteraction(interaction, client) {
    if (!interaction.isChatInputCommand()) return;

    // Define se a resposta deve ser privada (ephemeral)
    const PRIVATE_COMMANDS = ['setup'];
    const isEphemeral = PRIVATE_COMMANDS.includes(interaction.commandName);

    await interaction.deferReply({ flags: isEphemeral ? MessageFlags.Ephemeral : undefined });

    const { commandName, guildId, user, channelId } = interaction;
    if (!guildId) return;
    const ownerId = interaction.guild?.ownerId;
    const config = await carregarConfig(guildId);

    // Verificação de Canais Permitidos (Se configurado)
    const canaisPermitidos = config?.canais || [];
    if (canaisPermitidos.length > 0 && !canaisPermitidos.includes(channelId)) {
        return interaction.editReply({ content: '❌ Comando não permitido neste canal.' });
    }

    // Comandos de Administração
    if (commandName === 'setup') {
        if (user.id !== ownerId && user.id !== USUARIO_AUTORIZADO_ID) return interaction.editReply({ content: '❌ Apenas dono/autorizado' });

        const ip = interaction.options.getString('ip');
        const porta = interaction.options.getInteger('porta');
        const versao = interaction.options.getString('versao');
        const nick = interaction.options.getString('nick');
        const canaisTexto = interaction.options.getString('canais');
        const cargosTexto = interaction.options.getString('cargos');
        const canais = canaisTexto ? parseMentions(canaisTexto) : [];
        const cargos = cargosTexto ? parseMentions(cargosTexto) : [];

        await salvarConfig(guildId, ip, porta, versao, nick, canais, cargos);

        const novaConfig = {
            host: ip,
            port: porta,
            version: versao,
            nick,
            canais,
            cargos
        };
        conectarMinecraft(guildId, client, novaConfig, null).catch(() => {});

        return interaction.editReply({ content: `✅ Configurações salvas: IP: \`${ip}:${porta}\`, Nick: \`${nick}\`` });
    }

    if (commandName === 'entrar') {
        if (user.id !== ownerId && user.id !== USUARIO_AUTORIZADO_ID) return interaction.editReply({ content: '❌ Apenas dono/autorizado' });
        if (!config) return interaction.editReply({ content: '❌ Configure o servidor primeiro usando `/setup`.' });
        const existente = mcClients.get(guildId);
        if (existente && !existente.closed) {
            return interaction.editReply({ content: '❌ O bot já está conectado ao servidor.' });
        }
        if (existente && existente.closed) {
            mcClients.delete(guildId);
        }
        if (conectando.has(guildId)) return interaction.editReply({ content: '⏳ O bot já está em processo de conexão.' });

        await conectarMinecraft(guildId, client, config, interaction);
        return;
    }

    if (commandName === 'sair') {
        if (user.id !== ownerId && user.id !== USUARIO_AUTORIZADO_ID) return interaction.editReply({ content: '❌ Apenas dono/autorizado' });
        const mc = mcClients.get(guildId);
        if (!mc) return interaction.editReply({ content: '❌ O bot não está conectado.' });

        mc.close('Comando /sair');
        mcClients.delete(guildId);
        return interaction.editReply({ content: '✅ Desconectado com sucesso.' });
    }

    if (commandName === 'setchat') {
        if (user.id !== ownerId && user.id !== USUARIO_AUTORIZADO_ID) return interaction.editReply({ content: '❌ Apenas dono/autorizado' });
        const canaisTexto = interaction.options.getString('canais');
        const canais = parseMentions(canaisTexto);
        await salvarChat(guildId, canais);

        let replyContent = `✅ Canais de chat salvos: ${canais.map(id => `<#${id}>`).join(', ') || 'Nenhum'}.`;
        if (canais.length > 0) {
            const logThread = await getOrCreateLogThread(guildId, client);
            replyContent += `\n⚠️ Logs e status serão enviados para o primeiro canal (${canais[0]}) no thread \`「🔗」logs-mine\``;
        }

        return interaction.editReply({ content: replyContent });
    }

    // Lógica do Comando de Playtime
    if (commandName === 'tempo') {
        const subCommand = interaction.options.getSubcommand();
        if (subCommand === 'meu') {
            const minutes = await getPlaytime(user.id, guildId);
            return interaction.editReply({ content: `🕒 Seu tempo jogado é: **${formatarTempo(minutes)}**` });
        }

        if (subCommand === 'top') {
            const top = await getTopPlaytime(guildId);
            if (!top || top.length === 0) return interaction.editReply({ content: '❌ Ninguém no ranking ainda.' });

            let rankingText = '';
            for (let i = 0; i < top.length; i++) {
                const { user_id, minutes_played } = top[i];
                const member = interaction.guild.members.cache.get(user_id);
                const name = member ? member.displayName || member.user.username : `Usuário Desconhecido (${user_id})`;
                rankingText += `**${i + 1}.** ${name}: **${formatarTempo(minutes_played)}**\n`;
            }

            const embed = new EmbedBuilder()
                .setColor(0xffa500)
                .setTitle('👑 Top 10 Playtime')
                .setDescription(rankingText)
                .setFooter({ text: 'Playtime System' });

            return interaction.editReply({ embeds: [embed] });
        }
    }

    // Lógica do Comando de Vinculação
    if (commandName === 'vincular') {
        const mcNick = interaction.options.getString('nick');
        const userId = user.id;

        if (mcNick.length < 3) return interaction.editReply({ content: '❌ O Nickname deve ter pelo menos 3 caracteres.' });

        const currentNick = await getNickVinculado(userId);
        if (currentNick === mcNick.toLowerCase()) {
            return interaction.editReply({ content: `ℹ️ Seu ID já está vinculado ao Nick **${mcNick}**.` });
        }

        try {
            await vincularNick(userId, mcNick);
            return interaction.editReply({ content: `✅ Seu ID do Discord foi vinculado com sucesso ao Nick do Minecraft: **${mcNick}**` });
        } catch (error) {
            if (error.code === '23505' && error.constraint === 'nick_vincular_mc_nick_key') {
                return interaction.editReply({
                    content: '❌ Este Nickname do Minecraft já está vinculado a outro usuário do Discord.'
                });
            }
            console.error('Erro ao vincular nick:', error);
            return interaction.editReply({ content: '❌ Ocorreu um erro interno ao tentar vincular seu Nickname.' });
        }
    }

    // Comandos de Informação
    if (commandName === 'status') {
        return handleStatusCommand(interaction, client, guildId);
    }

    if (commandName === 'baixar') {
        const embed = new EmbedBuilder()
            .setColor(0x8000ff)
            .setTitle('📥 Baixar Minecraft PE/Bedrock')
            .setDescription('Links MCPEDL:')
            .addFields(
                { name: '🔗 Minecraft APK', value: '[Download](https://mcpedl.org/downloading)' },
                { name: '✨ Actions & Stuff', value: '[Download](https://www.mediafire.com/file/7nhvp52l6hu1p09/Actions-and-Stuff-1.8.mcpack/file)' }
            )
            .setFooter({ text: '⚠️ by space' });
        return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'drakinho') {
        const embed = new EmbedBuilder()
            .setTitle('🐉 Drakinho')
            .setColor(0xff6b6b)
            .setImage('https://cdn.discordapp.com/attachments/1270123729355014274/1443199701905178749/image.png?ex=692833f6&is=6926e276&hm=8de4b165d407a290b1d52db564f45df4af87780b80d82a69d88acf83ed0a2903&')
            .setFooter({ text: 'O lendário Drakinho!, sendo gay' })
            .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
    }
}

/**
 * Lida com mensagens do Discord para o chat do Minecraft.
 */
export async function handleMessage(msg) {
    try {
        if (msg.author.bot || !msg.guildId) return;

        const canais = await carregarChat(msg.guildId);
        if (!canais || !canais.includes(msg.channelId)) return;

        const mc = mcClients.get(msg.guildId);
        const mcConectado = !!(mc && !mc.closed);
        if (!mcConectado) return;

        // 1. Limpa menções e limita o tamanho da mensagem para evitar pacotes malformados
        let texto = msg.content.replace(/<@!?(\d+)>/g, (m, id) => {
            const member = msg.guild.members.cache.get(id);
            return member ? `@${member.user.username}` : '@usuario';
        }).slice(0, 250);

        if (texto.length === 0 && !msg.attachments.size) return;

        // 2. Formata a mensagem
        const authorName = msg.member?.displayName || msg.author.username;
        const authorColor = msg.author.id === USUARIO_AUTORIZADO_ID ? '§5' : '§1';
        const mensagemFinal = `${authorColor} <${authorName}> §f${texto}`;

        // 3. Envia no formato oficial do bedrock-protocol para evitar "bad packet"
        const chatPacket = {
            needs_translation: false,
            category: 'authored',
            type: 'chat',
            source_name: mc.username || 'Discord',
            message: String(mensagemFinal).replace(/[\r\n]+/g, ' ').trim().slice(0, 250),
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

        console.log(`[DC->MC] ${msg.guild.name}: ${mensagemFinal}`);

    } catch (e) {
        console.error('Erro no handler DC->MC:', e.message);
    }
}
