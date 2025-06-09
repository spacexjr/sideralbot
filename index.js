import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Events } from 'discord.js';
import { createClient } from 'bedrock-protocol';

// Configurações do Discord e Minecraft
const DISCORD_TOKEN = 'MTAyODgwNzAxODYxOTg3MTI5Mw.G-B3Hz.KfA6rUe7nBP2aZ05QTt4EWTU3QvZnauP7zYppw';
const CLIENT_ID = '1028807018619871293';
const GUILD_ID = '979385538496831508';

const BEDROCK_SERVER = {
  host: 'Infobearzlla.aternos.me',
  port: 15507,
  username: 'ZllaBOT',
  offline: true
};

const allowedRoleIds = [
  '1100124305901240400',
  '1294110761496350770',
  '1082460240391446528'
];

let mcClient = null;
let connectedPlayers = [];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder().setName('entrar').setDescription('Conecta o bot ao servidor Minecraft Bedrock'),
  new SlashCommandBuilder().setName('sair').setDescription('Desconecta o bot do servidor Minecraft'),
  new SlashCommandBuilder().setName('status').setDescription('Mostra o status do servidor Minecraft e do bot')
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
  const { commandName } = interaction;

  if (commandName === 'entrar') {
    if (mcClient) return interaction.reply('⚠️ Já estou conectado ao servidor.');

    await interaction.deferReply();

    mcClient = createClient({ ...BEDROCK_SERVER });

    mcClient.once('join', () => {
      interaction.editReply('✅ Entrei no servidor Minecraft Bedrock!');
    });

    mcClient.on('text', packet => {
      console.log(`[Chat Minecraft] ${packet.source_name}: ${packet.message}`);
    });

    mcClient.on('player_list', packet => {
      if (packet.records) {
        connectedPlayers = packet.records
          .filter(record => record.username)
          .map(record => record.username);
        console.log(`📋 Jogadores online: ${connectedPlayers.join(', ')}`);
      }
    });

    mcClient.on('disconnect', () => {
      mcClient = null;
      connectedPlayers = [];
      console.log('❌ Fui desconectado do servidor Minecraft.');
    });

    mcClient.on('error', err => {
      console.error('Erro do cliente MC:', err);
      interaction.followUp('❌ Erro ao conectar no servidor Minecraft.');
    });

  } else if (commandName === 'sair') {
    const member = interaction.member;
    const hasRole = member.roles.cache.some(role => allowedRoleIds.includes(role.id));

    if (!hasRole) {
      return interaction.reply({
        content: '❌ Você não tem permissão para usar este comando.',
        ephemeral: true
      });
    }

    if (mcClient) {
      mcClient.disconnect();
      mcClient = null;
      connectedPlayers = [];
      interaction.reply('👋 Saí do servidor Minecraft.');
    } else {
      interaction.reply('⚠️ Não estou conectado.');
    }

  } else if (commandName === 'status') {
    const statusEmbed = {
      color: 0x00ff00,
      title: '📊 Status do Servidor Minecraft',
      fields: [
        {
          name: 'Servidor Bedrock',
          value: `🟢 Online em ${BEDROCK_SERVER.host}:${BEDROCK_SERVER.port}`,
          inline: true
        },
        {
          name: 'Bot conectado',
          value: mcClient ? '✅ Sim' : '❌ Não',
          inline: true
        },
        {
          name: 'Jogadores online',
          value: connectedPlayers.length > 0
            ? `${connectedPlayers.length} jogador(es):\n${connectedPlayers.join(', ')}`
            : 'Nenhum jogador online',
          inline: false
        }
      ],
      timestamp: new Date().toISOString()
    };

    await interaction.reply({ embeds: [statusEmbed] });
  }
});

client.login(DISCORD_TOKEN);
