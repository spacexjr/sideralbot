import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Events } from 'discord.js';
import { createClient } from 'bedrock-protocol';

// 🔐 Configurações do bot e servidor
const DISCORD_TOKEN = 'MTAyODgwNzAxODYxOTg3MTI5Mw.G-B3Hz.KfA6rUe7nBP2aZ05QTt4EWTU3QvZnauP7zYppw'; // Coloque seu token aqui
const CLIENT_ID = '1028807018619871293';
const GUILD_ID = '979385538496831508';

const BEDROCK_SERVER = {
  host: 'Infobearzlla.aternos.me',
  port: 15507,
  username: 'ZllaBOT',
  offline: true,
  version: '1.21.90' // ajuste se necessário
};

// Cargos permitidos para /mandar
const allowedMandarRoleIds = ['1384352187106197534', '1082460240391446528'];

// Cargos permitidos para /sair
const allowedSairRoleIds = ['1100124305901240400', '1294110761496350770', '1082460240391446528'];

// Canais onde os comandos podem ser usados
const CANAIS_PERMITIDOS = ['1382404120199303249', '1307780152553635921'];


let mcClient = null;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder().setName('entrar').setDescription('Conecta o bot ao servidor Minecraft Bedrock'),
  new SlashCommandBuilder().setName('sair').setDescription('Desconecta o bot do servidor Minecraft'),
  new SlashCommandBuilder().setName('status').setDescription('Mostra o status do servidor Minecraft e do bot'),
  new SlashCommandBuilder()
    .setName('mandar')
    .setDescription('Envia uma mensagem no servidor Minecraft (restrito)')
    .addStringOption(option => option.setName('mensagem').setDescription('Mensagem para enviar').setRequired(true))
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log('⏳ Registrando comandos...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Comandos registrados com sucesso.');
  } catch (error) {
    console.error('Erro ao registrar comandos:', error);
  }
})();

client.once(Events.ClientReady, () => {
  console.log(`🤖 Bot online como ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (!CANAIS_PERMITIDOS.includes(interaction.channelId)) {
    return interaction.reply({
      content: '❌ Use os comandos somente nos canais permitidos.',
      ephemeral: true
    });
  }

  const { commandName } = interaction;

  if (commandName === 'entrar') {
    if (mcClient) return interaction.reply('⚠️ Já estou conectado ao servidor.');

    await interaction.deferReply();

    mcClient = createClient({ ...BEDROCK_SERVER });

    mcClient.once('join', () => {
      interaction.editReply('✅ Entrei no servidor Minecraft Bedrock!');
    });

    mcClient.on('text', packet => {
      console.log(`[Minecraft] ${packet.source_name}: ${packet.message}`);
    });

    mcClient.on('disconnect', () => {
      mcClient = null;
      console.log('❌ Fui desconectado do servidor Minecraft.');
      const discordChannel = client.channels.cache.get(interaction.channelId);
      if (discordChannel?.isTextBased()) {
        discordChannel.send('❌ Fui desconectado do servidor Minecraft.');
      }
    });

    mcClient.on('error', err => {
      console.error('Erro do cliente MC:', err);
      interaction.followUp('❌ Erro ao conectar no servidor Minecraft.');
    });

  } else if (commandName === 'sair') {
    const member = interaction.member;
    const hasRole = member.roles.cache.some(role => allowedSairRoleIds.includes(role.id));

    if (!hasRole) {
      return interaction.reply({
        content: '❌ Você não tem permissão para usar este comando.',
        ephemeral: true
      });
    }

    if (mcClient) {
      mcClient.disconnect();
      mcClient = null;
      interaction.reply('👋 Saí do servidor Minecraft.');
    } else {
      interaction.reply('⚠️ Não estou conectado.');
    }

  } else if (commandName === 'status') {
    const statusEmbed = {
      color: mcClient ? 0x00ff00 : 0xff0000,
      title: '📊 Status do Servidor Minecraft',
      fields: [
        { name: 'Servidor Bedrock', value: `${BEDROCK_SERVER.host}:${BEDROCK_SERVER.port}`, inline: true },
        { name: 'Bot conectado', value: mcClient ? '✅ Sim' : '❌ Não', inline: true }
      ],
      timestamp: new Date().toISOString()
    };

    await interaction.reply({ embeds: [statusEmbed] });

  } else if (commandName === 'mandar') {
    const isAutorizadoMandar = interaction.member.roles.cache.some(role =>
      allowedMandarRoleIds.includes(role.id)
    );

    if (!isAutorizadoMandar) {
      return interaction.reply({
        content: '❌ Você não tem permissão para usar este comando.',
        ephemeral: true
      });
    }

    const msg = interaction.options.getString('mensagem');

    if (!msg || typeof msg !== 'string' || !msg.trim()) {
      return interaction.reply('❌ Mensagem inválida.');
    }

    if (!mcClient) {
      return interaction.reply('❌ O bot não está conectado ao servidor Minecraft.');
    }

    try {
      // Força todos os campos como strings, para evitar erro ERR_INVALID_ARG_TYPE
      mcClient.write('text', {
        type: 'chat',
        needs_translation: false,
        source_name: String(BEDROCK_SERVER.username || 'ZllaBOT'),
        message: String(msg.trim()),
        xuid: '0000000000000000',
        platform_chat_id: ''
      });

      await interaction.reply(`💬 Enviado no Minecraft: \`${msg.trim()}\``);
    } catch (err) {
      console.error('❌ Erro ao enviar mensagem para o Minecraft:', err);
      await interaction.reply('❌ Erro ao enviar mensagem para o Minecraft.');
    }
  }
});

// Tratamento global de erros
process.on('unhandledRejection', console.error);
client.on('error', console.error);

client.login(DISCORD_TOKEN);
