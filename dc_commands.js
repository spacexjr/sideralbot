// dc_commands.js

import { SlashCommandBuilder } from 'discord.js';

export const commands = [
  // ---------- Comandos de Administração (Existentes) ----------
  new SlashCommandBuilder().setName('setup').setDescription('Configura IP, porta, versão, nick e permissões')
    .addStringOption(o => o.setName('ip').setDescription('IP do servidor').setRequired(true))
    .addIntegerOption(o => o.setName('porta').setDescription('Porta do servidor').setRequired(true))
    .addStringOption(o => o.setName('versao').setDescription('Versão Bedrock').setRequired(true))
    .addStringOption(o => o.setName('nick').setDescription('Nick do bot').setRequired(true))
    .addStringOption(o => o.setName('canais').setDescription('Canais (#) separados ou IDs'))
    .addStringOption(o => o.setName('cargos').setDescription('Cargos (@) separados ou IDs [Cargos que podem usar o /sair]')),
  new SlashCommandBuilder().setName('entrar').setDescription('Conecta ao servidor MC'),
  new SlashCommandBuilder().setName('sair').setDescription('Desconecta do servidor MC'),
  new SlashCommandBuilder().setName('setchat').setDescription('Define canais de chat MC ↔ DC').addStringOption(o => o.setName('canais').setDescription('Canais (#) separados ou IDs').setRequired(true)),

  // ---------- Comandos de Informação (Existentes) ----------
  new SlashCommandBuilder().setName('status').setDescription('Mostra status do servidor e ping'),
  new SlashCommandBuilder().setName('baixar').setDescription('Links MCPEDL para baixar Minecraft'),

  // ----------------------------------------------------------------------
  // ---------- Comandos de Playtime e Vinculação ----------
  // ----------------------------------------------------------------------

  // Comando: /tempo
  new SlashCommandBuilder().setName('tempo').setDescription('Mostra seu tempo jogado ou o ranking de jogadores')
    .addSubcommand(s => s.setName('meu').setDescription('Mostra seu tempo jogado total'))
    .addSubcommand(s => s.setName('top').setDescription('Mostra o ranking dos jogadores com mais tempo')),

  // Comando: /vincular
  new SlashCommandBuilder().setName('vincular').setDescription('Vincula seu ID do Discord a um Nickname do Minecraft')
    .addStringOption(o => o.setName('nick').setDescription('Seu nickname exato do Minecraft Bedrock/Java').setRequired(true)),

  // zoeira //
  // Comando: /drakinho
  new SlashCommandBuilder().setName('drakinho').setDescription('Mostra uma imagem do Drakinho 🐉'),

].map(c => c.toJSON());
