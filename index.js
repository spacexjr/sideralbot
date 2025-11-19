// index.js Versao GO/JO

import 'dotenv/config';
import {
    Client, GatewayIntentBits, REST, Routes, Events, ActivityType
} from 'discord.js';
import { esperarPostgres } from './db.js';
import { commands } from './dc_commands.js';
import { handleInteraction, handleMessage } from './dc_handlers.js';
import { setAuthUserId } from './mc_client.js';

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
    // Adicionado para otimizar o uso de memória em bots grandes
    sweepers: { members: { lifetime: 3600 } },
    presence: {
        status: 'idle',
        activities: [
            {
                name: "em uns servers de Minecraft Bedrock",
                type: ActivityType.Playing
            }
        ]
    }
});


/* ---------- Main init ---------- */
(async () => {
    // 1. Espera o PostgreSQL subir e se conectar
    await esperarPostgres();

    // 2. Registro de Comandos Slash (Global)
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    try {
        console.log('📦 Registrando comandos...');
        // O Routes.applicationCommands(CLIENT_ID) registra comandos globalmente
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('✅ Comandos registrados');
    } catch (e) {
        console.error('❌ Erro registrando comandos:', e);
    }

    // 3. Listener de Bot Pronto (Online)
    client.once(Events.ClientReady, async () => {
        console.log(`🤖 Bot online como ${client.user.tag}`);
        
        // Carrega o cache de membros para garantir que as menções funcionem
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
    });

    // 4. Listeners de Eventos
    // Lida com a execução de comandos Slash
    client.on(Events.InteractionCreate, (interaction) => handleInteraction(interaction, client));

    // Lida com mensagens de chat do Discord (DC -> MC Chat)
    client.on(Events.MessageCreate, handleMessage);


    /* ---------- misc ---------- */
    // Captura erros de promessas não tratadas e erros gerais do cliente
    process.on('unhandledRejection', e => console.error('UnhandledRejection', e));
    client.on('error', console.error);
    
    // Indica que o processo de login está iniciando
    console.log(`🚀 Iniciando o Bot Discord...`);

    // Inicia a conexão com o Discord
    client.login(DISCORD_TOKEN);
})().catch(e => console.error('BOOT ERR', e));