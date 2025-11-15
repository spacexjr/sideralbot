import 'dotenv/config';
import {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, Events, EmbedBuilder, ChannelType
} from 'discord.js';
import { createClient, ping } from 'bedrock-protocol';
import pkg from 'pg';
import express from 'express';

const { Pool } = pkg;

// ───── Variáveis de ambiente ─────
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const USUARIO_AUTORIZADO_ID = process.env.USUARIO_AUTORIZADO_ID;
const PORT = process.env.PORT || 3000;

// ───── Conexão PostgreSQL ─────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ───── Discord Client ─────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ───── Mapas de controle ─────
let mcClients = new Map();
let jogadoresOnline = new Map();
let tentativasReconexao = new Map();

// ───── Funções PostgreSQL ─────
async function salvarConfig(guildId, ip, porta, versao, nick, canais, cargos) {
  await pool.query(`
    INSERT INTO configs (guild_id, host, port, version, nick, canais, cargos)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (guild_id) DO UPDATE SET
      host = EXCLUDED.host,
      port = EXCLUDED.port,
      version = EXCLUDED.version,
      nick = EXCLUDED.nick,
      canais = EXCLUDED.canais,
      cargos = EXCLUDED.cargos
  `, [guildId, ip, porta, versao, nick, canais, cargos]);
}

async function carregarConfig(guildId) {
  const res = await pool.query("SELECT * FROM configs WHERE guild_id=$1", [guildId]);
  return res.rows[0] || null;
}

async function salvarChat(guildId, canais) {
  await pool.query(`
    INSERT INTO last_channels (guild_id, canais)
    VALUES ($1,$2)
    ON CONFLICT (guild_id) DO UPDATE SET canais = EXCLUDED.canais
  `, [guildId, canais]);
}

async function carregarChat(guildId) {
  const res = await pool.query("SELECT canais FROM last_channels WHERE guild_id=$1", [guildId]);
  return res.rows[0]?.canais || [];
}

// ───── Funções auxiliares ─────
function parseMentions(input) {
  if (!input) return [];
  return input.match(/\d{17,19}/g) || [];
}

async function testarServidor(config) {
  try {
    const status = await ping({ host: config.host, port: config.port, timeout: 10000 });
    return { online: true, jogadores: status.playersOnline, max: status.playersMax, playersSample: status.playersSample };
  } catch {
    return { online: false };
  }
}

function tentarReconectar(guildId) {
  let tentativa = tentativasReconexao.get(guildId) || 0;
  tentativa++;
  tentativasReconexao.set(guildId, tentativa);
  if (tentativa > 10) return;

  setTimeout(() => conectarMinecraft(guildId), Math.min(5000 * tentativa, 30000));
}

// ───── Conectar Minecraft ─────
function conectarMinecraft(guildId, interaction) {
  carregarConfig(guildId).then(async config => {
    if (!config) return interaction?.editReply('⚠️ Use `/setup` primeiro.');
    if (mcClients.has(guildId)) return interaction?.editReply('⚠️ Já conectado.');

    const mc = createClient({
      host: config.host,
      port: config.port,
      version: config.version,
      username: config.nick,
      offline: true
    });

    mcClients.set(guildId, mc);
    jogadoresOnline.set(guildId, new Map());
    const canaisAviso = await carregarChat(guildId);
    let reconectando = false;

    const enviarAviso = msg => {
      canaisAviso.forEach(id => {
        const canal = client.channels.cache.get(id);
        if (canal?.type === ChannelType.GuildText) canal.send(msg).catch(() => {});
      });
    };

    mc.once('join', () => {
      tentativasReconexao.set(guildId, 0);
      enviarAviso(`✅ Conectado em ${config.host}:${config.port} como ${config.nick}`);
      interaction?.editReply(`✅ Conectado em ${config.host}:${config.port} como ${config.nick}`);
      reconectando = false;
    });

    // ── Chat MC → DC com menções reais ──
    mc.on('text', async packet => {
      if (!packet.source_name || packet.source_name === config.nick) return;

      const canais = await carregarChat(guildId);
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return;

      let mensagem = packet.message.replace(/§[0-9a-fklmnor]/gi, '');

      // ===== CORREÇÃO DE MENÇÕES =====
      guild.members.cache.forEach(member => {
        const username = member.user.username;
        const nickname = member.nickname;

        const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const nomes = [username];
        if (nickname) nomes.push(nickname);

        nomes.forEach(nome => {
          const regex = new RegExp(`@${esc(nome)}`, 'gi');
          mensagem = mensagem.replace(regex, `<@${member.id}>`);
        });
      });

      if (USUARIO_AUTORIZADO_ID) {
        mensagem = mensagem.replace(/@space/gi, `<@${USUARIO_AUTORIZADO_ID}>`);
      }
      // ================================

      canais.forEach(canalId => {
        const canal = client.channels.cache.get(canalId);
        if (canal?.type === ChannelType.GuildText) {
          canal.send(`💬 **${packet.source_name}**: ${mensagem}`).catch(() => {});
        }
      });
    });

    // ── Jogadores online ──
    mc.on('player_list', packet => {
      const lista = jogadoresOnline.get(guildId) || new Map();
      if (packet.records?.type === 'add') packet.records.records.forEach(p => lista.set(p.uuid, p.username));
      else if (packet.records?.type === 'remove') packet.records.records.forEach(p => lista.delete(p.uuid));
      jogadoresOnline.set(guildId, lista);
    });

    // ── Dias do servidor ──
    mc.on('set_time', packet => {
      const dias = Math.floor(packet.time / 24000);
      const dados = jogadoresOnline.get(guildId) || new Map();
      dados.diasServidor = dias;
      jogadoresOnline.set(guildId, dados);
    });

    mc.on('disconnect', () => {
      mcClients.delete(guildId);
      if (!reconectando) {
        reconectando = true;
        enviarAviso('❌ Desconectado. Tentando reconectar...');
        tentarReconectar(guildId);
      }
    });

    mc.on('error', err => {
      console.error(`MC (${guildId}) erro:`, err.message);
      if (err.message.includes('raknet timeout')) enviarAviso('⚠️ Conexão expirada (raknet timeout). Tentando reconectar...');
      else enviarAviso(`⚠️ Erro de conexão: ${err.message}`);
      if (!reconectando) { reconectando = true; tentarReconectar(guildId); }
    });
  });
}

// ───── Comandos Discord ─────
const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configura IP, porta, versão, nick e permissões')
    .addStringOption(opt => opt.setName('ip').setDescription('IP do servidor').setRequired(true))
    .addIntegerOption(opt => opt.setName('porta').setDescription('Porta do servidor').setRequired(true))
    .addStringOption(opt => opt.setName('versao').setDescription('Versão Bedrock').setRequired(true))
    .addStringOption(opt => opt.setName('nick').setDescription('Nick do bot').setRequired(true))
    .addStringOption(opt => opt.setName('canais').setDescription('Canais (#) separados ou IDs'))
    .addStringOption(opt => opt.setName('cargos').setDescription('Cargos (@) separados ou IDs')),

  new SlashCommandBuilder().setName('entrar').setDescription('Conecta ao servidor MC'),
  new SlashCommandBuilder().setName('sair').setDescription('Desconecta do servidor MC'),
  new SlashCommandBuilder().setName('setchat').setDescription('Define canais de chat MC ↔ DC')
    .addStringOption(opt => opt.setName('canais').setDescription('Canais (#) separados ou IDs').setRequired(true)),
  new SlashCommandBuilder().setName('status').setDescription('Mostra status do servidor e ping'),
  new SlashCommandBuilder().setName('baixar').setDescription('Links MCPEDL para baixar Minecraft')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
(async () => {
  try { 
    console.log('📦 Registrando comandos...'); 
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands }); 
    console.log('✅ Comandos registrados'); 
  }
  catch (err) { console.error(err); }
})();

// ───── Eventos Discord ─────
client.once(Events.ClientReady, () => console.log(`🤖 Bot online como ${client.user.tag}`));

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, guildId, user, channelId } = interaction;
  if (!guildId) return;
  const ownerId = interaction.guild?.ownerId;

  const config = await carregarConfig(guildId);
  const canaisPermitidos = config?.canais || [];
  if (canaisPermitidos.length > 0 && !canaisPermitidos.includes(channelId)) {
    return interaction.reply({ content: '❌ Comando não permitido neste canal.', ephemeral: true });
  }

  if (commandName === 'setup') {
    if (user.id !== ownerId && user.id !== USUARIO_AUTORIZADO_ID) return interaction.reply({ content: '❌ Apenas dono/autorizado', ephemeral: true });
    const ip = interaction.options.getString('ip');
    const porta = interaction.options.getInteger('porta');
    const versao = interaction.options.getString('versao');
    const nick = interaction.options.getString('nick');
    const canais = parseMentions(interaction.options.getString('canais'));
    const cargos = parseMentions(interaction.options.getString('cargos')).slice(0, 5);
    await salvarConfig(guildId, ip, porta, versao, nick, canais, cargos);
    interaction.reply(`✅ Configuração salva:\n> IP: \`${ip}\`\n> Porta: \`${porta}\`\n> Versão: \`${versao}\`\n> Nick: \`${nick}\`\n> Canais: ${canais.map(id => `<#${id}>`).join(', ') || 'Nenhum'}\n> Cargos: ${cargos.map(id => `<@&${id}>`).join(', ') || 'Nenhum'}`);
  }

  else if (commandName === 'entrar') { await interaction.deferReply(); conectarMinecraft(guildId, interaction); }

  else if (commandName === 'sair') {
    const mc = mcClients.get(guildId);
    const cargosPermitidos = config?.cargos?.slice(0, 5) || [];
    const membro = interaction.member;
    const temCargo = cargosPermitidos.length === 0 || cargosPermitidos.some(id => membro.roles.cache.has(id));
    if (!temCargo) return interaction.reply({ content: '❌ Você não tem permissão para usar /sair.', ephemeral: true });
    if (mc) { mc.disconnect(); mcClients.delete(guildId); interaction.reply('👋 Desconectado do servidor Minecraft.'); }
    else interaction.reply('⚠️ Não conectado.');
  }

  else if (commandName === 'setchat') {
    if (user.id !== ownerId && user.id !== USUARIO_AUTORIZADO_ID) return interaction.reply({ content: '❌ Apenas dono/autorizado', ephemeral: true });
    const canais = parseMentions(interaction.options.getString('canais'));
    await salvarChat(guildId, canais);
    interaction.reply(`✅ Canais de chat MC ↔ DC definidos: ${canais.map(id => `<#${id}>`).join(', ')}`);
  }

  else if (commandName === 'status') {
    const sent = await interaction.reply({ content: "🏓 Testando...", fetchReply: true });
    const discordPing = sent.createdTimestamp - interaction.createdTimestamp;
    const apiPing = client.ws.ping;
    let serverStatus = "❌ Offline", botStatus = "❌ Desconectado", jogadoresTexto = "👥 Nenhum jogador online";

    if (config) {
      const status = await testarServidor(config);
      if (status.online) serverStatus = `✅ Online | ${status.jogadores}/${status.max}`;
      if (mcClients.has(guildId)) {
        botStatus = "✅ Conectado";

        const dados = jogadoresOnline.get(guildId) || new Map();

        if (status.playersSample && status.playersSample.length > 0) {
          jogadoresTexto = `👥 Jogadores: ${status.playersSample.map(p => p.name).join(', ')}`;
        } else if (dados.size > 0) {
          jogadoresTexto = `👥 Jogadores: ${[...dados.values()].join(', ')}`;
        }

        if (dados.diasServidor !== undefined) {
          jogadoresTexto += `\n⏳ Dias no servidor: ${dados.diasServidor}`;
        }
      }
    }
    interaction.editReply(`🏓 **Pong!**\n📡 Discord: ${discordPing}ms\n🌐 API: ${apiPing}ms\n🎮 Servidor: ${serverStatus}\n🤖 Bot: ${botStatus}\n${jogadoresTexto}`);
  }

  else if (commandName === 'baixar') {
    const embed = new EmbedBuilder()
      .setColor(0x8000ff)
      .setTitle("📥 Baixar Minecraft PE/Bedrock")
      .setDescription("Links MCPEDL:")
      .addFields({ name: "🔗 Minecraft APK", value: "[Download](https://mcpedl.org/downloading)" })
      .setFooter({ text: "⚠️ by space" });
    interaction.reply({ embeds: [embed] });
  }
});

// ───── Chat DC → MC ─────
client.on("messageCreate", async msg => {
  if (msg.author.bot || !msg.guildId) return;
  const canais = await carregarChat(msg.guildId);
  if (!canais.includes(msg.channelId)) return;
  const mc = mcClients.get(msg.guildId);
  if (!mc) return;

  const texto = msg.content.replace(/<@!?(\d+)>/g, (m, id) => {
    const member = msg.guild?.members?.cache?.get(id);
    return member ? `@${member.user.username}` : '@usuario';
  });

  const authorName = msg.member?.user.username || msg.author.username;
  mc.queue('text', {
    type: 'chat',
    needs_translation: false,
    source_name: mc.username,
    xuid: '',
    platform_chat_id: '',
    filtered_message: '',
    message: `<${authorName}> ${texto}`
  });
});

// ───── Webserver ─────
const app = express();
app.get("/", (req, res) => res.status(200).send("🤖 Bot rodando!"));
app.listen(PORT, () => console.log(`🌐 Webserver na porta ${PORT}`));

process.on('unhandledRejection', console.error);
client.on('error', console.error);
client.login(DISCORD_TOKEN);
