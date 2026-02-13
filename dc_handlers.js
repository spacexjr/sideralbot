// dc_handlers.js

import {
    ChannelType, EmbedBuilder, MessageFlags // Corrigido para MessageFlags
} from 'discord.js'; 
import { ping } from 'bedrock-protocol';
import {
    salvarConfig, salvarChat, carregarConfig, carregarChat,
    // Importações de Economia e Vinculação
    getBalance, updateBalance, getTopBalances,
    vincularNick, getNickVinculado
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
    
    // Define se a resposta deve ser privada (ephemeral)
    const PRIVATE_COMMANDS = ['setup'];
    const isEphemeral = PRIVATE_COMMANDS.includes(interaction.commandName);

    // ✅ CORREÇÃO: Chama deferReply usando MessageFlags para efêmero
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
        
        try { conectarMinecraft(guildId, client, config, null); } catch (e) { /* ignore */ } 

        return interaction.editReply({ content: `✅ Configurações salvas: IP: \`${ip}:${porta}\`, Nick: \`${nick}\`` });
    }

    if (commandName === 'entrar') {
        if (user.id !== ownerId && user.id !== USUARIO_AUTORIZADO_ID) return interaction.editReply({ content: '❌ Apenas dono/autorizado' }); 
        if (!config) return interaction.editReply({ content: '❌ Configure o servidor primeiro usando `/setup`.' });
        if (mcClients.has(guildId)) return interaction.editReply({ content: '❌ O bot já está conectado ao servidor.' });
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
    
    // Lógica dos Comandos de Economia
    if (commandName === 'coins') {
        const subCommand = interaction.options.getSubcommand();
        if (subCommand === 'saldo') {
            const balance = await getBalance(user.id);
            return interaction.editReply({ content: `💰 Seu saldo atual é: **${balance} coins**` });
        } else if (subCommand === 'top') {
            const top = await getTopBalances(guildId, 10);
            if (!top || top.length === 0) return interaction.editReply({ content: '❌ Ninguém no ranking ainda.' });

            let rankingText = '';
            for (let i = 0; i < top.length; i++) {
                const { user_id, balance } = top[i];
                const member = interaction.guild.members.cache.get(user_id);
                const name = member ? member.displayName || member.user.username : `Usuário Desconhecido (${user_id})`; 
                rankingText += `**${i + 1}.** ${name}: **${balance}** coins\n`;
            }

            const embed = new EmbedBuilder()
                .setColor(0xffa500)
                .setTitle('👑 Top 10 Ricos')
                .setDescription(rankingText)
                .setFooter({ text: 'Economy System' });

            return interaction.editReply({ embeds: [embed] });
        }
    }
    
    if (commandName === 'pagar') {
        const targetMember = interaction.options.getMember('membro');
        const amount = interaction.options.getInteger('valor');
        
        if (!targetMember || targetMember.user.bot) return interaction.editReply({ content: '❌ Membro inválido para pagar.' });
        if (targetMember.id === user.id) return interaction.editReply({ content: '❌ Você não pode pagar a si mesmo.' });
        
        const senderBalance = await getBalance(user.id);
        if (senderBalance < amount) return interaction.editReply({ content: `❌ Saldo insuficiente. Você tem apenas **${senderBalance} coins**` });
        
        // Transação
        await updateBalance(user.id, guildId, -amount); // Remover do remetente
        await updateBalance(targetMember.id, guildId, amount); // Adicionar ao destinatário
        
        return interaction.editReply({ content: `✅ Você pagou **${amount} coins** para **${targetMember.user.username}**!` });
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
        if (!config) return interaction.editReply({ content: '❌ Configure o servidor primeiro usando `/setup`.' });

        const mc = mcClients.get(guildId);
        if (mc) {
            return interaction.editReply({ content: `✅ Conectado em \`${config.host}:${config.port}\`. Status: Online. (Nick: ${mc.options.username})` });
        }

        try {
            const data = await ping({ host: config.host, port: config.port, version: config.version });
            return interaction.editReply({ content: `✅ Servidor \`${config.host}:${config.port}\` online. Jogadores: ${data.players.online}/${data.players.max}. Ping: ${data.latency}ms` });
        } catch (e) {
            return interaction.editReply({ content: `❌ Servidor \`${config.host}:${config.port}\` offline ou inacessível. ${e.message ? `(${e.message})` : ''}` });
        }
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
        return interaction.editReply({ embeds: [embed] });
    }


    if (commandName === 'drakinho') {
        const embed = new EmbedBuilder()
            .setTitle("🐉 Drakinho")
            .setColor(0xff6b6b)
            .setImage('https://cdn.discordapp.com/attachments/1270123729355014274/1443199701905178749/image.png?ex=692833f6&is=6926e276&hm=8de4b165d407a290b1d52db564f45df4af87780b80d82a69d88acf83ed0a2903&')
            .setFooter({ text: "O lendário Drakinho!, sendo gay" })
            .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
    }
}

/**
 ** Lida com mensagens do Discord para o chat do Minecraft.
 */
/**
 * Lida com mensagens do Discord para o chat do Minecraft.
 */
export async function handleMessage(msg) {
    try {
        if (msg.author.bot || !msg.guildId) return;

        const canais = await carregarChat(msg.guildId);
        if (!canais || !canais.includes(msg.channelId)) return;

        const mc = mcClients.get(msg.guildId);
        if (!mc || mc.status !== 'online') return; // Verifica se está realmente pronto

        // 1. Limpa menções e limita o tamanho da mensagem para evitar pacotes malformados
        let texto = msg.content.replace(/<@!?(\d+)>/g, (m, id) => {
            const member = msg.guild.members.cache.get(id);
            return member ? `@${member.user.username}` : '@usuario';
        }).slice(0, 250); // O limite de chat do MC costuma ser próximo a isso

        if (texto.length === 0 && !msg.attachments.size) return;

        // 2. Formata a mensagem
        const authorName = msg.member?.displayName || msg.author.username;
        const mensagemFinal = `<${authorName}> ${texto}`;

        // 3. Envia usando o método simplificado (o bedrock-protocol cuida do pacote 'text')
        mc.chat(mensagemFinal);

        console.log(`[DC->MC] ${msg.guild.name}: ${mensagemFinal}`);

    } catch (e) {
        console.error('Erro no handler DC->MC:', e.message);
    }
}
