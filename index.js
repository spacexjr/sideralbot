// index.js Versao GO/JO

import 'dotenv/config';
import {
    Client, GatewayIntentBits, REST, Routes, Events, ActivityType
} from 'discord.js';
import { 
    esperarPostgres, 
    setupEconomyTable, 
    setupChatTable, 
    setupNickTable, 
    updateBalance, 
    getUserIdByNick // NOVO: Para buscar o ID do Discord pelo Nick MC
} from './db.js';
import { commands } from './dc_commands.js';
import { handleInteraction, handleMessage } from './dc_handlers.js';
import { setAuthUserId, mcClients, jogadoresOnline } from './mc_client.js'; // NOVO: Importa jogadoresOnline

/* ---------- Config / Variáveis de Ambiente ---------- */
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const USUARIO_AUTORIZADO_ID = process.env.USUARIO_AUTORIZADO_ID;

// Exporta o ID para o módulo do cliente MC
setAuthUserId(USUARIO_AUTORIZADO_ID);

/* ---------- Discord client (OTIMIZADO) ---------- */
const client = new Client({
    // ... (configurações do client)
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
    
    // 1.1 Garante que as tabelas necessárias existem
    await setupEconomyTable(); 
    await setupChatTable();    
    await setupNickTable();    
    
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
        
        // NOVO: Sistema de Ganho Automático (5 coins a cada 15 minutos para jogadores MC online)
        const INTERVALO_MS = 15 * 60 * 1000; // 15 minutos
        const GANHO_POR_INTERVALO = 5;
        
        setInterval(async () => {
            // Apenas executa se houver clientes MC conectados (mapa mcClients não vazio)
            if (mcClients.size === 0) return; 

            console.log(`[ECONOMY] Dando +${GANHO_POR_INTERVALO} coins para jogadores online no MC.`);
            
            // Itera sobre todos os servidores MC conectados
            for (const [guildId, mcClient] of mcClients.entries()) {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) continue;
                
                // Obtém a lista de jogadores online no MC para este servidor
                const onlinePlayersMap = jogadoresOnline.get(guildId);
                if (!onlinePlayersMap || onlinePlayersMap.size === 0) continue;
                
                // Itera sobre cada nick de jogador online no MC
                for (const mcNick of onlinePlayersMap.values()) {
                    // 1. Busca o ID do Discord vinculado a este Nick MC
                    const userId = await getUserIdByNick(mcNick);

                    if (!userId) {
                        console.log(`[ECONOMY] Nick MC (${mcNick}) não vinculado a um ID do Discord. Ignorando.`);
                        continue;
                    }
                    
                    // 2. Verifica se o usuário ainda é membro do Discord antes de dar a moeda (opcional)
                    const member = guild.members.cache.get(userId);
                    if (!member) {
                        console.log(`[ECONOMY] Usuário ${userId} (Nick: ${mcNick}) não encontrado na guilda. Ignorando.`);
                        continue;
                    }

                    try {
                        // 3. Dá a recompensa. Usa o ID do Discord e o ID da Guilda.
                        await updateBalance(userId, guildId, GANHO_POR_INTERVALO);
                        console.log(`[ECONOMY] ${mcNick} (${member.user.username}) ganhou ${GANHO_POR_INTERVALO} coins.`);
                    } catch (e) {
                        console.error(`[ECONOMY] Erro ao dar coins para ${mcNick} (${userId}):`, e);
                    }
                }
            }
        }, INTERVALO_MS);
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