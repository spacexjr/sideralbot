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
  new SlashCommandBuilder().setName('status').setDescription('Mostra o status do servidor e do bot')
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
      connectedPlayers = [];
      interaction.editReply('✅ Entrei no servidor Minecraft Bedrock!');
    });

    mcClient.on('text', packet => {
      if (packet.message.includes('joined the game')) {
        const name = packet.source_name;
        if (!connectedPlayers.includes(name)) connectedPlayers.push(name);
      } else if (packet.message.includes('left the game')) {
        const name = packet.source_name;
        connectedPlayers = connectedPlayers.filter(n => n !== name);
      }

      console.log(`[Chat Minecraft] ${packet.source_name}: ${packet.message}`);
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
    const serverStatus = mcClient ? '🟢 Online' : '🔴 Offline';
    const botStatus = client.ws.status === 0 ? '🟢 Conectado' : '🔴 Desconectado';
    const playerList = connectedPlayers.length
      ? connectedPlayers.join(', ')
      : 'Nenhum jogador online';

    await interaction.reply({
      embeds: [{
        title: '📊 Status do Servidor Minecraft',
        color: 0x00FF00,
        fields: [
          { name: 'Servidor', value: serverStatus, inline: true },
          { name: 'Bot', value: botStatus, inline: true },
          { name: 'Jogadores Online', value: `${connectedPlayers.length}`, inline: true },
          { name: 'Nomes', value: playerList }
        ],
        timestamp: new Date().toISOString()
      }]
    });
  }
});

client.login(DISCORD_TOKEN);
