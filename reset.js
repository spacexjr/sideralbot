// Crie um arquivo chamado reset.js e rode: node reset.js
import { REST, Routes } from 'discord.js';
import 'dotenv/config';

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Limpando comandos antigos...');
        // Deleta todos os comandos globais
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
        console.log('✅ Comandos limpos! Agora reinicie seu bot normalmente.');
    } catch (error) {
        console.error(error);
    }
})();