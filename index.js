// index.js Versao GO/JO

import 'dotenv/config';
import {
    Client, GatewayIntentBits, REST, Routes, Events, ActivityType
} from 'discord.js';
import {
    esperarPostgres,
    setupPlaytimeTable,
    setupChatTable,
    setupNickTable,
    addPlaytime,
    getUserIdByNick,
    checkDbConnection
} from './db.js';
import { commands } from './dc_commands.js';
import { handleInteraction, handleMessage } from './dc_handlers.js';
import { setAuthUserId, mcClients, jogadoresOnline } from './mc_client.js';

/* ---------- Config / Variáveis de Ambiente ---------- */
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const USUARIO_AUTORIZADO_ID = process.env.USUARIO_AUTORIZADO_ID;

// Exporta o ID para o módulo do cliente MC
setAuthUserId(USUARIO_AUTORIZADO_ID);

/* ---------- Discord client (OTIMIZADO) ---------- */
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
    ],
    sweepers: { members: { lifetime: 3600 } },
    presence: {
        status: 'idle',
        activities: [
            {
                name: 'em uns servers de Minecraft Bedrock',
                type: ActivityType.Playing
            }
        ]
    }
});


/* ---------- Main init ---------- */
(async () => {
    // 1. Espera o PostgreSQL subir e se conectar
    await esperarPostgres();

    // 1.1 Garante que as tabelas necessárias existem
    await setupPlaytimeTable();
    await setupChatTable();
    await setupNickTable();

    // 1.2 ⏰ KEEP-ALIVE PARA RAILWAY
    setInterval(async () => {
        try {
            await checkDbConnection();
            console.log('💚 [DB] Keep-Alive: Conexão com o PostgreSQL mantida ativa.');
        } catch (e) {
            console.error('💔 [DB] Keep-Alive falhou. Banco de dados pode ter adormecido.', e.message);
        }
    }, 120000);

    // 2. Registro de Comandos Slash (Global)
    try {
        const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log(`✅ Comandos (${commands.length}) registrados globalmente.`);
    } catch (e) {
        console.error('❌ Erro registrando comandos:', e);
    }

    // 3. Listener de Bot Pronto (Online)
    client.once(Events.ClientReady, async () => {
        console.log(`🤖 Bot online como ${client.user.tag}`);

        // ... (Carregamento de cache de membros existente)
        for (const [guildId, guild] of client.guilds.cache) {
            if (guild.memberCount > guild.members.cache.size) {
                try {
                    await guild.members.fetch();
                    console.log(`Cache de membros para ${guild.name} carregado.`);
                } catch (e) {
                    console.error(`Erro ao carregar membros para ${guild.name}:`, e);
                }
            }
        }

        // Sistema de Playtime: +1 minuto a cada 60s para jogadores MC online e vinculados
        const INTERVALO_MS = 60 * 1000;

        setInterval(async () => {
            if (mcClients.size === 0) return;

            for (const [guildId] of mcClients.entries()) {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) continue;

                const onlinePlayersMap = jogadoresOnline.get(guildId);
                if (!onlinePlayersMap || onlinePlayersMap.size === 0) continue;

                for (const mcNick of onlinePlayersMap.values()) {
                    const userId = await getUserIdByNick(mcNick);
                    if (!userId) continue;

                    const member = guild.members.cache.get(userId);
                    if (!member) continue;

                    try {
                        await addPlaytime(userId, guildId, 1);
                    } catch (e) {
                        console.error(`[PLAYTIME] Erro ao adicionar tempo para ${mcNick} (${userId}):`, e);
                    }
                }
            }
        }, INTERVALO_MS);
    });

    // 4. Listeners de Eventos
    client.on(Events.InteractionCreate, (interaction) => handleInteraction(interaction, client));
    client.on(Events.MessageCreate, handleMessage);


    /* ---------- misc ---------- */
    process.on('unhandledRejection', e => console.error('UnhandledRejection', e));
    client.on('error', console.error);

    console.log('🚀 Iniciando o Bot Discord...');
    client.login(DISCORD_TOKEN);
})().catch(e => console.error('BOOT ERR', e));
