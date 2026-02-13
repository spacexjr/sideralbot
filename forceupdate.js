import { REST, Routes } from 'discord.js';
import { commands } from './dc_commands.js';
import 'dotenv/config';

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('🗑️ Deletando TODOS os comandos antigos...');
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
        
        console.log('🚀 Registrando a VERSÃO NOVA agora...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );
        console.log('✅ Sincronização concluída! Reinicie seu Discord (Ctrl + R).');
    } catch (error) {
        console.error('❌ Erro no registro:', error);
    }
})();