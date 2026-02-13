
import { REST, Routes } from 'discord.js';
import 'dotenv/config';

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('🧹 Iniciando limpeza profunda...');

        // 1. Limpa comandos GLOBAIS (os que aparecem em todos os servers)
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
        console.log('✅ Comandos GLOBAIS deletados.');

        // 2. Limpa comandos de GUILDA (se você tiver o ID do servidor em que está testando)
        // Substitua 'ID_DO_SEU_SERVER' pelo ID real onde o fantasma aparece
        const GUILD_ID = '979385538496831508'; 
        if (GUILD_ID !== '979385538496831508') {
            await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, GUILD_ID), { body: [] });
            console.log('✅ Comandos da GUILDA deletados.');
        }

        console.log('✨ Limpeza concluída! AGORA REINICIE SEU DISCORD (CTRL + R).');
    } catch (error) {
        console.error('❌ Erro:', error);
    }
})();