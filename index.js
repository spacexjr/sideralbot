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

    // ─────────── MC → DC com menções corrigidas ───────────
    mc.on('text', async packet => {
      if (!packet.source_name || packet.source_name === config.nick) return;

      const canais = await carregarChat(guildId);
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return;

      let mensagem = packet.message.replace(/§[0-9a-fklmnor]/gi, '');

      // ─── Menções de qualquer username do Discord ───
      guild.members.cache.forEach(member => {
        const escaped = member.user.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`@${escaped}`, 'gi');
        mensagem = mensagem.replace(regex, `<@${member.id}>`);
      });

      // ─── Menção especial para @space ───
      if (USUARIO_AUTORIZADO_ID) {
        mensagem = mensagem.replace(/@space/gi, `<@${USUARIO_AUTORIZADO_ID}>`);
      }

      canais.forEach(canalId => {
        const canal = client.channels.cache.get(canalId);
        if (canal?.type === ChannelType.GuildText) {
          canal.send(`💬 **${packet.source_name}**: ${mensagem}`).catch(() => {});
        }
      });
    });

    // ─── Jogadores online ───
    mc.on('player_list', packet => {
      const lista = jogadoresOnline.get(guildId) || new Map();
      if (packet.records?.type === 'add') packet.records.records.forEach(p => lista.set(p.uuid, p.username));
      else if (packet.records?.type === 'remove') packet.records.records.forEach(p => lista.delete(p.uuid));
      jogadoresOnline.set(guildId, lista);
    });

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
// (… igual ao seu, mantido sem alterações …)

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
