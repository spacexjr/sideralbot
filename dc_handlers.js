// dc_handlers.js

import {
    ChannelType, EmbedBuilder, MessageFlags 
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
// NOVO: Importa o novo manipulador de status do mc_handlers.js
import { handleStatusCommand } from './mc_handlers.js'; 


/**
 * Lida com a execução de comandos Slash.
 */
export async function handleInteraction(interaction, client) {
    if (!interaction.isChatInputCommand()) return;
    
    // Define se a resposta deve ser privada (ephemeral)
    const PRIVATE_COMMANDS = ['vincular'];
    const isEphemeral = PRIVATE_COMMANDS.includes(interaction.commandName);

    // ✅ CORREÇÃO: Chama deferReply usando MessageFlags para efêmero
    await interaction.deferReply({ flags: isEphemeral ? MessageFlags.Ephemeral : undefined }); 
    
    const { commandName, guildId, user, channelId } = interaction;
    if (!guildId) return;
    const ownerId = interaction.guild?.ownerId;
    const config = await carregarConfig(guildId);
    
    // Verificação de Canais Permitidos (Se configurado)
    if (config?.canais?.length > 0 && !config.canais.includes(channelId)) {
        // Ignora comandos se não estiver nos canais de chat permitidos, exceto para setup
        if (commandName !== 'setup') {
            return interaction.editReply({ content: '❌ Este canal não está configurado para comandos do bot.', ephemeral: true });
        }
    }
    
    // Verificação de Permissão (Para Comandos de Administrador)
    const ADMIN_COMMANDS = ['setup', 'entrar', 'sair', 'setchat'];
    if (ADMIN_COMMANDS.includes(commandName) && user.id !== ownerId && user.id !== USUARIO_AUTORIZADO_ID) {
        let hasRole = false;
        if (config?.cargos?.length > 0) {
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (member) {
                hasRole = config.cargos.some(roleId => member.roles.cache.has(roleId));
            }
        }
        if (!hasRole) {
            return interaction.editReply({ content: '❌ Você não tem permissão para usar este comando.', ephemeral: true });
        }
    }


    /* ------------------------------------------------------------------ */
    /* ---------- Comandos de Administração ---------- */
    /* ------------------------------------------------------------------ */
    
    if (commandName === 'setup') {
        const ip = interaction.options.getString('ip');
        const port = interaction.options.getInteger('porta');
        const version = interaction.options.getString('versao');
        const nick = interaction.options.getString('nick');
        const canaisRaw = interaction.options.getString('canais');
        const cargosRaw = interaction.options.getString('cargos');

        const canais = canaisRaw ? parseMentions(canaisRaw) : [];
        const cargos = cargosRaw ? parseMentions(cargosRaw) : [];

        await salvarConfig(guildId, ip, port, version, nick, canais, cargos);
        return interaction.editReply({ content: `✅ Configuração salva para o servidor: **${ip}:${port}** (Nick: ${nick}).`, ephemeral: true });
    }
    
    if (commandName === 'entrar') {
        if (!config) return interaction.editReply({ content: '❌ Configure o servidor primeiro usando `/setup`.' });
        if (mcClients.has(guildId)) return interaction.editReply({ content: '⚠️ O bot já está conectado ao servidor.', ephemeral: true });

        // Passa o config explicitamente
        await conectarMinecraft(guildId, client, config, interaction);
        return;
    }
    
    if (commandName === 'sair') {
        const mc = mcClients.get(guildId);
        if (!mc) return interaction.editReply({ content: '⚠️ O bot não está conectado ao servidor.', ephemeral: true });

        mc.close('Comando /sair');
        mcClients.delete(guildId);
        // Remove quaisquer tentativas de reconexão pendentes
        conectando.delete(guildId); 
        
        return interaction.editReply({ content: '👋 Desconectado com sucesso do servidor Minecraft.', ephemeral: true });
    }
    
    if (commandName === 'setchat') {
        const canaisRaw = interaction.options.getString('canais');
        const canais = canaisRaw ? parseMentions(canaisRaw) : [];
        
        if (canais.length === 0) {
            return interaction.editReply({ content: '❌ Por favor, mencione um ou mais canais para definir como chat do Minecraft.', ephemeral: true });
        }
        
        await salvarChat(guildId, canais);
        const canaisMencoes = canais.map(id => `<#${id}>`).join(', ');
        return interaction.editReply({ content: `✅ Canais de chat MC ↔ DC definidos para: ${canaisMencoes}`, ephemeral: true });
    }


    /* ------------------------------------------------------------------ */
    /* ---------- Comandos de Informação / Economia ---------- */
    /* ------------------------------------------------------------------ */
    
    if (commandName === 'status') {
        if (!config) return interaction.editReply({ content: '❌ Configure o servidor primeiro usando `/setup`.' });
        
        // NOVO: Chama a função que gera o Embed detalhado
        await handleStatusCommand(interaction, client, guildId);
        return;
    }
    
    if (commandName === 'coins') {
        if (!config) return interaction.editReply({ content: '❌ Configure o servidor primeiro usando `/setup`.' });
        
        const subCommand = interaction.options.getSubcommand();
        const userId = user.id;

        if (subCommand === 'saldo') {
            const balance = await getBalance(userId, guildId);
            return interaction.editReply({ content: `🪙 Seu saldo atual é de **${balance}** moedas.`, ephemeral: true });
        }
        
        if (subCommand === 'top') {
            const topPlayers = await getTopBalances(guildId);
            const embed = new EmbedBuilder()
                .setTitle('💰 Top Jogadores Mais Ricos')
                .setColor(0xffd700) // Dourado
                .setDescription(topPlayers.length > 0 ? topPlayers.map((p, i) => 
                    `**${i + 1}.** <@${p.user_id}>: **${p.balance}** moedas`
                ).join('\n') : 'Nenhum jogador no ranking ainda.');
            
            return interaction.editReply({ embeds: [embed] });
        }
    }
    
    if (commandName === 'pagar') {
        if (!config) return interaction.editReply({ content: '❌ Configure o servidor primeiro usando `/setup`.' });
        
        const targetMember = interaction.options.getUser('membro');
        const amount = interaction.options.getInteger('valor');
        const senderId = user.id;
        
        if (targetMember.id === senderId) {
            return interaction.editReply({ content: '❌ Você não pode pagar a si mesmo.', ephemeral: true });
        }
        if (amount <= 0) {
             return interaction.editReply({ content: '❌ O valor a pagar deve ser positivo.', ephemeral: true });
        }
        
        const senderBalance = await getBalance(senderId, guildId);
        if (senderBalance < amount) {
            return interaction.editReply({ content: `❌ Saldo insuficiente. Você tem apenas **${senderBalance}** moedas.`, ephemeral: true });
        }

        // Realiza a transação
        await updateBalance(senderId, guildId, -amount);
        await updateBalance(targetMember.id, guildId, amount);

        return interaction.editReply({ 
            content: `✅ Você transferiu **${amount}** moedas para <@${targetMember.id}>. Seu novo saldo: **${senderBalance - amount}** moedas.`, 
            ephemeral: true 
        });
    }

    if (commandName === 'vincular') {
        if (!config) return interaction.editReply({ content: '❌ Configure o servidor primeiro usando `/setup`.' });
        
        const mcNick = interaction.options.getString('nick');
        const userId = user.id;

        await vincularNick(userId, mcNick);

        return interaction.editReply({ 
            content: `🔗 Seu ID do Discord (<@${userId}>) foi vinculado ao Nickname Minecraft: **${mcNick}**`, 
            ephemeral: true 
        });
    }

    if (commandName === 'baixar') {
        const embed = new EmbedBuilder()
            .setTitle("🎮 Baixar Minecraft Bedrock")
            .setColor(0x3498db)
            .setDescription("Acesse os links abaixo para baixar o Minecraft ou recursos úteis do MCPEDL:")
            .addFields(
                { name: "🔗 Minecraft APK", value: "[Download](https://mcpedl.org/downloading)" },
                { name: "✨ Actions & Stuff", value: "[Download](https://www.mediafire.com/file/7nhvp52l6hu1p09/Actions-and-Stuff-1.8.mcpack/file)" }
            )
            .setFooter({ text: "⚠️ by space" });
        return interaction.editReply({ embeds: [embed] });
    }
}

// DC  -> MC

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