// index.js (versão E - sem NENHUM log de morte)
import 'dotenv/config';
import {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, Events, EmbedBuilder, ChannelType
} from 'discord.js';
import { createClient, ping } from 'bedrock-protocol';
import pkg from 'pg';
import express from 'express';
const { Pool } = pkg;

/* ---------- Config / DB ---------- */
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const USUARIO_AUTORIZADO_ID = process.env.USUARIO_AUTORIZADO_ID;
const PORT = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

/* ---------- Discord client ---------- */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

/* ---------- In-memory maps ---------- */
let mcClients = new Map();           // guildId -> bedrock client
let jogadoresOnline = new Map();     // guildId -> Map(uuid->username)
let tentativasReconexao = new Map(); // guildId -> attempts
let conectando = new Set();          // guildIds in connecting state

/* ---------- Helpers: DB ---------- */
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
  const r = await pool.query("SELECT * FROM configs WHERE guild_id=$1", [guildId]);
  return r.rows[0] || null;
}
async function salvarChat(guildId, canais) {
  await pool.query(`INSERT INTO last_channels (guild_id, canais) VALUES ($1,$2) ON CONFLICT (guild_id) DO UPDATE SET canais = EXCLUDED.canais`, [guildId, canais]);
}
async function carregarChat(guildId) {
  const r = await pool.query("SELECT canais FROM last_channels WHERE guild_id=$1", [guildId]);
  return r.rows[0]?.canais || [];
}

/* ---------- Misc helpers ---------- */
function parseMentions(input) { if (!input) return []; return input.match(/\d{17,19}/g) || []; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ---------- Wait Postgres ready (avoid 57P03) ---------- */
async function esperarPostgres(retries = 10, delay = 2000) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query('SELECT 1');
      console.log('📦 PostgreSQL online');
      return;
    } catch (e) {
      console.log(`⏳ PostgreSQL iniciando... ${i}/${retries}`);
      await sleep(delay);
    }
  }
  console.error('❌ PostgreSQL não iniciou após várias tentativas. Saindo.');
  process.exit(1);
}

/* ---------- Thread logs: find / reopen / create ---------- */
async function getOrCreateLogThread(guildId) {
  try {
    const canais = await carregarChat(guildId);
    if (!canais || canais.length === 0) return null;
    const canal = client.channels.cache.get(canais[0]);
    if (!canal || canal.type !== ChannelType.GuildText || !canal.threads) return null;

    // Try active threads
    try {
      const active = await canal.threads.fetchActive();
      const found = active.threads.find(t => t.name.toLowerCase() === 'logs');
      if (found) {
        if (found.archived) try { await found.setArchived(false); } catch {}
        return found;
      }
    } catch (e) { /* ignore */ }

    // Try archived threads
    try {
      const archived = await canal.threads.fetchArchived();
      const foundA = archived.threads.find(t => t.name.toLowerCase() === 'logs');
      if (foundA) {
        try { await foundA.setArchived(false); } catch {}
        return foundA;
      }
    } catch (e) { /* ignore */ }

    // Create new
    const created = await canal.threads.create({
      name: 'logs',
      autoArchiveDuration: 1440,
      reason: 'Tópico automático de logs do servidor Minecraft'
    });
    return created;
  } catch (err) {
    console.error('getOrCreateLogThread error:', err);
    return null;
  }
}

/* ---------- Simple classifier fallback ---------- */
function classifyServerMessage(raw) {
  if (!raw) return { kind: 'chat', text: '' };
  const s = raw.replace(/§[0-9a-fklmnor]/gi, '').trim();
  if (/ entrou no jogo$/i.test(s) || / joined the game$/i.test(s)) return { kind: 'entrada', text: s };
  if (/ saiu do jogo$/i.test(s) || / left the game$/i.test(s)) return { kind: 'saida', text: s };
  // Linha de morte removida: if (/ morreu/i.test(s) || / foi morto/i.test(s) || / died/i.test(s)) return { kind: 'morte', text: s };
  return { kind: 'chat', text: s };
}

/* ---------- Reconnect scheduler ---------- */
function tentarReconectar(guildId) {
  const t = (tentativasReconexao.get(guildId) || 0) + 1;
  tentativasReconexao.set(guildId, t);
  if (t > 10) return;
  setTimeout(() => { if (!mcClients.has(guildId)) conectarMinecraft(guildId); }, Math.min(5000 * t, 30000));
}

/* ---------- Connect to Minecraft (per-guild) ---------- */
function conectarMinecraft(guildId, interaction = null) {
  if (mcClients.has(guildId) || conectando.has(guildId)) {
    if (interaction) return interaction.editReply('⚠️ Já conectado ou conectando.');
    return;
  }
  conectando.add(guildId);

  carregarConfig(guildId).then(async config => {
    if (!config) { conectando.delete(guildId); if (interaction) return interaction.editReply('⚠️ Use `/setup` primeiro.'); return; }

    let mc;
    try {
      mc = createClient({ host: config.host, port: config.port, version: config.version, username: config.nick, offline: true });
    } catch (err) {
      console.error('createClient error:', err);
      conectando.delete(guildId);
      if (interaction) interaction.editReply(`❌ Falha ao criar cliente: ${err.message || err}`);
      return;
    }

    mcClients.set(guildId, mc);
    jogadoresOnline.set(guildId, new Map());
    tentativasReconexao.set(guildId, 0);
    let reconectando = false;

    // send log helper: thread preferred, fallback to channel
    const sendLog = async (msg) => {
      const thread = await getOrCreateLogThread(guildId);
      if (thread) { try { if (thread.archived) await thread.setArchived(false); } catch {} thread.send(msg).catch(() => {}); return; }
      const canais = await carregarChat(guildId); const canal = client.channels.cache.get(canais[0]);
      if (canal?.type === ChannelType.GuildText) canal.send(msg).catch(() => {});
    };

    // send chat helper: send MC chat-> configured channel
    const sendChatToChannel = async (author, texto) => {
      try {
        const canais = await carregarChat(guildId);
        if (!canais || canais.length === 0) return;
        const canal = client.channels.cache.get(canais[0]);
        if (!canal || canal.type !== ChannelType.GuildText) return;

        if (USUARIO_AUTORIZADO_ID) texto = texto.replace(/@space/gi, `<@${USUARIO_AUTORIZADO_ID}>`);

        const guild = client.guilds.cache.get(guildId);
        if (guild) {
          guild.members.cache.forEach(m => {
            const esc = m.user.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            texto = texto.replace(new RegExp(`@${esc}`, 'gi'), `<@${m.id}>`);
          });
        }

        canal.send(`💬 **${author}**: ${texto}`).catch(() => {});
      } catch (e) { console.error('sendChatToChannel error:', e); }
    };

    // initial log attempt
    sendLog(`🔄 Tentando conectar em ${config.host}:${config.port} como ${config.nick}...`);
    if (interaction) await interaction.editReply(`🔄 Tentando conectar em \`${config.host}:${config.port}\`...`);

    mc.once('join', () => {
      tentativasReconexao.set(guildId, 0);
      reconectando = false;
      conectando.delete(guildId);
      sendLog(`🟩 Conectado em ${config.host}:${config.port} como ${config.nick}`);
      if (interaction) interaction.editReply(`✅ Conectado em \`${config.host}:${config.port}\` como \`${config.nick}\``);
    });

    /* ---------- MC text handler: separate system events -> thread, chat -> channel ---------- */
    mc.on('text', async packet => {
      try {
        if (!packet.message) return;
        // avoid echo of bot's own nick
        if (packet.source_name && packet.source_name === config.nick) return;

        const raw = (packet.message || '').trim();
        const noColor = raw.replace(/§[0-9a-fklmnor]/gi, '').trim();
        const params = packet.parameters || [];

        // detect types
        const isJoin = /%multiplayer\.player\.joined/i.test(raw) || / entrou no jogo$/i.test(noColor) || / joined the game$/i.test(noColor);
        const isLeave = /%multiplayer\.player\.left/i.test(raw) || / saiu do jogo$/i.test(noColor) || / left the game$/i.test(noColor);
        
        // Variáveis de morte removidas (isDeathKey e isDeathText)

        // name from params or source_name
        const playerName = params[0] || packet.source_name || 'Jogador';
        
        // Se não for Join ou Leave, e for uma mensagem de sistema/tip, trata como sistema genérico.
        // A morte (que é tip/system) cairá neste bloco apenas se for tratada como sistema genérico
        const isSystemMessage = (packet.type === 'system' || packet.type === 'tip') && !isJoin && !isLeave;

        // SYSTEM EVENTS -> thread logs
        // Condição alterada: Morte foi removida
        if (isJoin || isLeave || isSystemMessage) {
          const thread = await getOrCreateLogThread(guildId);
          // fallback channel if no thread
          const fallbackSend = async (text) => {
            const canais = await carregarChat(guildId); const canal = client.channels.cache.get(canais[0]);
            if (canal?.type === ChannelType.GuildText) canal.send(text).catch(() => {});
          };

          // join/leave handling
          if (isJoin) {
            const txt = (playerName && playerName !== 'Jogador') ? `🟢 **${playerName} entrou no servidor**` : `🟢 **Um jogador entrou no servidor**`;
            if (thread) return thread.send(txt).catch(() => {}); return fallbackSend(txt);
          }
          if (isLeave) {
            const txt = (playerName && playerName !== 'Jogador') ? `🔴 **${playerName} saiu do servidor**` : `🔴 **Um jogador saiu do servidor**`;
            if (thread) return thread.send(txt).catch(() => {}); return fallbackSend(txt);
          }

            // generic system message fallback (inclui mortes não classificadas)
          if (isSystemMessage || packet.source_name === '') { // Mensagem sem autor, geralmente sistema
              if (thread) return thread.send(`ℹ️ **${noColor}**`).catch(() => {});
              return fallbackSend(`ℹ️ **${noColor}**`);
            }
            
            // Evita que mensagens que foram classificadas como sistema mas não são, caiam no chat normal
            return; 
        }

        // NORMAL CHAT -> send to configured channel
        if (packet.source_name) { // Apenas se houver um autor (chat)
          await sendChatToChannel(packet.source_name, noColor);
        }

      } catch (err) {
        console.error('mc.on(text) handler error:', err);
      }
    });

    // update player list
    mc.on('player_list', packet => {
      try {
        const mapa = jogadoresOnline.get(guildId) || new Map();
        const records = packet.records?.records || packet.records || packet.entries || [];
        const type = packet.records?.type || packet.action || null;
        if (type === 'add' || packet.action === 'add') (records || []).forEach(r => mapa.set(r.uuid || r.xuid || r.name, r.username || r.name));
        else if (type === 'remove' || packet.action === 'remove') (records || []).forEach(r => mapa.delete(r.uuid || r.xuid || r.name));
        jogadoresOnline.set(guildId, mapa);
      } catch (e) { console.error('player_list error:', e); }
    });

    // server time (days)
    mc.on('set_time', packet => {
      try {
        const dias = Math.floor(packet.time / 24000);
        const dados = jogadoresOnline.get(guildId) || new Map();
        dados.diasServidor = dias;
        jogadoresOnline.set(guildId, dados);
      } catch (e) { /* ignore */ }
    });

    mc.on('disconnect', packet => {
      mcClients.delete(guildId);
      sendLog(`🟥 **Desconectado:** ${packet?.reason || packet?.message || 'Sem mensagem'}`);
      if (!reconectando) {
        reconectando = true;
        sendLog('⚠️ Desconectado. Tentando reconectar...');
        tentarReconectar(guildId);
      }
    });

    mc.on('error', err => {
      console.error(`MC (${guildId}) error:`, err?.message || err);
      sendLog(`❌ **Erro de conexão:** ${err?.message || String(err)}`);
      if (!reconectando) {
        reconectando = true;
        sendLog('⚠️ Erro detectado. Tentando reconectar...');
        tentarReconectar(guildId);
      }
    });

  }).catch(err => {
    console.error('conectarMinecraft catch:', err);
    conectando.delete(guildId);
  });
}

/* ---------- Commands ---------- */
const commands = [
  new SlashCommandBuilder().setName('setup').setDescription('Configura IP, porta, versão, nick e permissões')
    .addStringOption(o => o.setName('ip').setDescription('IP do servidor').setRequired(true))
    .addIntegerOption(o => o.setName('porta').setDescription('Porta do servidor').setRequired(true))
    .addStringOption(o => o.setName('versao').setDescription('Versão Bedrock').setRequired(true))
    .addStringOption(o => o.setName('nick').setDescription('Nick do bot').setRequired(true))
    .addStringOption(o => o.setName('canais').setDescription('Canais (#) separados ou IDs'))
    .addStringOption(o => o.setName('cargos').setDescription('Cargos (@) separados ou IDs')),
  new SlashCommandBuilder().setName('entrar').setDescription('Conecta ao servidor MC'),
  new SlashCommandBuilder().setName('sair').setDescription('Desconecta do servidor MC'),
  new SlashCommandBuilder().setName('setchat').setDescription('Define canais de chat MC ↔ DC').addStringOption(o => o.setName('canais').setDescription('Canais (#) separados ou IDs').setRequired(true)),
  new SlashCommandBuilder().setName('status').setDescription('Mostra status do servidor e ping'),
  new SlashCommandBuilder().setName('baixar').setDescription('Links MCPEDL para baixar Minecraft')
].map(c => c.toJSON());

/* ---------- Main init ---------- */
(async () => {
  await esperarPostgres();

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  try {
    console.log('📦 Registrando comandos...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Comandos registrados');
  } catch (e) {
    console.error('Erro registrando comandos:', e);
  }

  client.once(Events.ClientReady, () => console.log(`🤖 Bot online como ${client.user.tag}`));

  /* ---------- Interaction handler ---------- */
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, guildId, user, channelId } = interaction;
    if (!guildId) return;
    const ownerId = interaction.guild?.ownerId;
    const config = await carregarConfig(guildId);
    const canaisPermitidos = config?.canais || [];
    if (canaisPermitidos.length > 0 && !canaisPermitidos.includes(channelId)) return interaction.reply({ content: '❌ Comando não permitido neste canal.', ephemeral: true });

    if (commandName === 'setup') {
      if (user.id !== ownerId && user.id !== USUARIO_AUTORIZADO_ID) return interaction.reply({ content: '❌ Apenas dono/autorizado', ephemeral: true });
      const ip = interaction.options.getString('ip');
      const porta = interaction.options.getInteger('porta');
      const versao = interaction.options.getString('versao');
      const nick = interaction.options.getString('nick');
      const canais = parseMentions(interaction.options.getString('canais'));
      const cargos = parseMentions(interaction.options.getString('cargos')).slice(0, 5);
      await salvarConfig(guildId, ip, porta, versao, nick, canais, cargos);
      try { conectarMinecraft(guildId); } catch {}
      return interaction.reply({ content: `✅ Configuração salva.\nIP: \`${ip}\`\nPorta: \`${porta}\`\nVersão: \`${versao}\`\nNick: \`${nick}\``, ephemeral: false });
    }

    if (commandName === 'entrar') {
      if (user.id !== interaction.guild?.ownerId && user.id !== USUARIO_AUTORIZADO_ID) return interaction.reply({ content: '❌ Apenas dono/autorizado', ephemeral: true });
      await interaction.deferReply();
      conectarMinecraft(guildId, interaction);
      return;
    }

    if (commandName === 'sair') {
      const mc = mcClients.get(guildId);
      const cargosPermitidos = config?.cargos?.slice(0, 5) || [];
      const membro = interaction.member;
      const temCargo = cargosPermitidos.length === 0 || cargosPermitidos.some(id => membro.roles.cache.has(id));
      if (!temCargo && interaction.user.id !== interaction.guild?.ownerId && interaction.user.id !== USUARIO_AUTORIZADO_ID) return interaction.reply({ content: '❌ Você não tem permissão', ephemeral: true });
      if (mc) { try { mc.disconnect && mc.disconnect(); } catch {} mcClients.delete(guildId); return interaction.reply({ content: '👋 Desconectado do servidor Minecraft.' }); }
      return interaction.reply({ content: '⚠️ Não conectado.', ephemeral: true });
    }

    if (commandName === 'setchat') {
      if (user.id !== ownerId && user.id !== USUARIO_AUTORIZADO_ID) return interaction.reply({ content: '❌ Apenas dono/autorizado', ephemeral: true });
      const canais = parseMentions(interaction.options.getString('canais'));
      if (!canais || canais.length === 0) return interaction.reply({ content: '❌ Nenhum canal válido', ephemeral: true });
      const canal = client.channels.cache.get(canais[0]);
      if (!canal || canal.type !== ChannelType.GuildText) return interaction.reply({ content: '❌ O canal precisa ser de texto', ephemeral: true });
      try {
        const active = await canal.threads.fetchActive();
        let logThread = active.threads.find(t => t.name.toLowerCase() === 'logs');
        if (!logThread) {
          try {
            const archived = await canal.threads.fetchArchived();
            logThread = archived.threads.find(t => t.name.toLowerCase() === 'logs');
          } catch {}
        }
        if (!logThread) {
          const created = await canal.threads.create({ name: 'logs', autoArchiveDuration: 1440, reason: 'Tópico de logs do servidor Minecraft' });
          logThread = created;
        }
      } catch (e) { console.error('thread create error:', e); }
      await salvarChat(guildId, canais);
      return interaction.reply({ content: `✅ Canais salvos: <#${canais[0]}>`, ephemeral: false });
    }

    if (commandName === 'status') {
      await interaction.deferReply();
      const sent = await interaction.fetchReply();
      const discordPing = sent.createdTimestamp - interaction.createdTimestamp;
      const apiPing = client.ws.ping;
      let serverStatus = "❌ Offline", botStatus = "❌ Desconectado", jogadoresTexto = "👥 Nenhum jogador online";
      if (config) {
        try {
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
      const embed = new EmbedBuilder().setColor(0x8000ff).setTitle("📥 Baixar Minecraft PE/Bedrock").setDescription("Links MCPEDL:").addFields({ name: "🔗 Minecraft APK", value: "[Download](https://mcpedl.org/downloading)" }).setFooter({ text: "⚠️ by space" });
      return interaction.reply({ embeds: [embed] });
    }
  });

  /* ---------- DC -> MC handler ---------- */
  client.on("messageCreate", async msg => {
    try {
      if (msg.author.bot || !msg.guildId) return;
      const canais = await carregarChat(msg.guildId);
      if (!canais || canais.length === 0) return;
      if (!canais.includes(msg.channelId)) return;
      const mc = mcClients.get(msg.guildId);
      if (!mc) return;

      // transform mentions to @username for MC text
      const texto = msg.content.replace(/<@!?(\d+)>/g, (m, id) => {
        const member = msg.guild?.members?.cache?.get(id);
        return member ? `@${member.user.username}` : '@usuario';
      });

      // use account username (not displayName)
      const authorName = msg.author.username || msg.member?.user?.username || 'Discord';

      try {
        // entire message in dark blue (§1)
        const final = `§1<${authorName}> ${texto}`;
        mc.queue && mc.queue('text', {
          type: 'chat',
          needs_translation: false,
          source_name: authorName,
          xuid: '',
          platform_chat_id: '',
          filtered_message: '',
          message: final
        });
      } catch (e) { console.error('DC->MC send error:', e); }
    } catch (e) { console.error('messageCreate handler error:', e); }
  });

  /* ---------- Web / misc ---------- */
  const app = express();
  app.get("/", (req, res) => res.status(200).send("🤖 Bot rodando!"));
  app.listen(PORT, () => console.log(`🌐 Webserver na porta ${PORT}`));

  process.on('unhandledRejection', e => console.error('UnhandledRejection', e));
  client.on('error', console.error);

  client.login(DISCORD_TOKEN);
})().catch(e => console.error('BOOT ERR', e));
