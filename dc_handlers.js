// dc_handlers.js

import {
    ChannelType, EmbedBuilder
} from 'discord.js';
import { ping } from 'bedrock-protocol'; // ping é uma função standalone
import {
    salvarConfig, salvarChat, carregarConfig, carregarChat
} from './db.js';
import {
    conectarMinecraft, mcClients, conectando, tentativasReconexao, jogadoresOnline, getOrCreateLogThread, USUARIO_AUTORIZADO_ID
} from './mc_client.js';
import { parseMentions } from './utils.js';

/**
 * Lida com a execução de comandos Slash.
 */
export async function handleInteraction(interaction, client) {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, guildId, user, channelId } = interaction;
    if (!guildId) return;
    const ownerId = interaction.guild?.ownerId;
    const config = await carregarConfig(guildId);
    
    // Verificação de Canais Permitidos (Se configurado)
    const canaisPermitidos = config?.canais || [];
    if (canaisPermitidos.length > 0 && !canaisPermitidos.includes(channelId)) {
        return interaction.reply({ content: '❌ Comando não permitido neste canal.', ephemeral: true });
    }

    // Comandos de Administração
    if (commandName === 'setup') {
        if (user.id !== ownerId && user.id !== USUARIO_AUTORIZADO_ID) return interaction.reply({ content: '❌ Apenas dono/autorizado', ephemeral: true });
        const ip = interaction.options.getString('ip');
        const porta = interaction.options.getInteger('porta');
        const versao = interaction.options.getString('versao');
        const nick = interaction.options.getString('nick');
        const canais = parseMentions(interaction.options.getString('canais'));
        const cargos = parseMentions(interaction.options.getString('cargos')).slice(0, 5);
        await salvarConfig(guildId, ip, porta, versao, nick, canais, cargos);
        try { conectarMinecraft(guildId, client); } catch (e) { /* ignore */ }
        return interaction.reply({ content: `✅ Configuração salva.\nIP: \`${ip}\`\nPorta: \`${porta}\`\nVersão: \`${versao}\`\nNick: \`${nick}\``, ephemeral: false });
    }

    if (commandName === 'entrar') {
        if (user.id !== ownerId && user.id !== USUARIO_AUTORIZADO_ID) return interaction.reply({ content: '❌ Apenas dono/autorizado', ephemeral: true });
        await interaction.deferReply();
        conectarMinecraft(guildId, client, interaction);
        return;
    }

    if (commandName === 'sair') {
        const mc = mcClients.get(guildId);
        const cargosPermitidos = config?.cargos?.slice(0, 5) || [];
        const membro = interaction.member;
        const temCargo = cargosPermitidos.length === 0 || cargosPermitidos.some(id => membro.roles.cache.has(id));
        
        if (!temCargo && interaction.user.id !== ownerId && interaction.user.id !== USUARIO_AUTORIZADO_ID) {
            return interaction.reply({ content: '❌ Você não tem permissão', ephemeral: true });
        }
        
        if (mc) {
            try { mc.disconnect && mc.disconnect(); } catch (e) { /* ignore */ }
            mcClients.delete(guildId);
            conectando.delete(guildId);
            tentativasReconexao.set(guildId, 10);
            return interaction.reply({ content: '👋 Desconectado do servidor Minecraft.' });
        }
        return interaction.reply({ content: '⚠️ Não conectado.', ephemeral: true });
    }

    if (commandName === 'setchat') {
        if (user.id !== ownerId && user.id !== USUARIO_AUTORIZADO_ID) return interaction.reply({ content: '❌ Apenas dono/autorizado', ephemeral: true });
        const canais = parseMentions(interaction.options.getString('canais'));
        if (!canais || canais.length === 0) return interaction.reply({ content: '❌ Nenhum canal válido', ephemeral: true });
        const canal = client.channels.cache.get(canais[0]);
        if (!canal || canal.type !== ChannelType.GuildText) return interaction.reply({ content: '❌ O canal precisa ser de texto', ephemeral: true });
        
        // Garante que o thread de log será criado/reaberto no novo canal
        try { await getOrCreateLogThread(guildId, client); } catch (e) { console.error('thread create error on setchat:', e); }

        await salvarChat(guildId, canais);
        return interaction.reply({ content: `✅ Canais salvos: <#${canais[0]}>`, ephemeral: false });
    }
    
    // Comandos de Informação
    if (commandName === 'status') {
        await interaction.deferReply();
        const sent = await interaction.fetchReply();
        const discordPing = sent.createdTimestamp - interaction.createdTimestamp;
        const apiPing = client.ws.ping;
        let serverStatus = "❌ Offline", botStatus = "❌ Desconectado", jogadoresTexto = "👥 Nenhum jogador online";
        
        if (config) {
            try {
                // Ping do Bedrock Server
                const st = await ping({ host: config.host, port: config.port, timeout: 10000 });
                if (st) {
                    serverStatus = `✅ Online | ${st.playersOnline || 0}/${st.playersMax || 0}`;
                    if (st.playersSample && st.playersSample.length > 0) jogadoresTexto = `👥 Jogadores: ${st.playersSample.map(p => p.name).join(', ')}`;
                    else {
                        const dados = jogadoresOnline.get(guildId) || new Map();
                        const players = Array.from(dados.values()).filter(v => typeof v === 'string');
                        if (players.length > 0) jogadoresTexto = `👥 Jogadores: ${players.join(', ')}`;
                        if (dados.diasServidor !== undefined) jogadoresTexto += `\n⏳ Dias no servidor: ${dados.diasServidor}`;
                    }
                }
            } catch (e) { serverStatus = '❌ Offline (erro no ping)'; }
            if (mcClients.has(guildId)) botStatus = "✅ Conectado";
        }
        
        return interaction.editReply(`🏓 **Pong!**\n📡 Discord: ${discordPing}ms\n🌐 API: ${apiPing}ms\n🎮 Servidor: ${serverStatus}\n🤖 Bot: ${botStatus}\n${jogadoresTexto}`);
    }

    if (commandName === 'baixar') {
        const embed = new EmbedBuilder()
            .setColor(0x8000ff)
            .setTitle("📥 Baixar Minecraft PE/Bedrock")
            .setDescription("Links MCPEDL:")
            .addFields(
                { name: "🔗 Minecraft APK", value: "[Download](https://mcpedl.org/downloading)" },
                { name: "✨ Actions & Stuff", value: "[Download](https://www.mediafire.com/file/7nhvp52l6hu1p09/Actions-and-Stuff-1.8.mcpack/file)" }
            )
            .setFooter({ text: "⚠️ by space" });
        return interaction.reply({ embeds: [embed] });
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
        if (!mc) return;

        // transformar menções reais em @username para MC
        const texto = msg.content.replace(/<@!?(\d+)>/g, (m, id) => {
            const member = msg.guild.members.cache.get(id);
            return member ? `@${member.user.username}` : '@usuario';
        });

        const authorName = msg.author.username || 'Discord';

        const final = `§1<${authorName}> ${texto}`;
        mc.queue?.('text', {
            type: 'chat',
            needs_translation: false,
            source_name: authorName,
            xuid: '',
            platform_chat_id: '',
            filtered_message: '',
            message: final
        });

    } catch (e) {
        console.error('DC->MC handler error:', e);
    }
}