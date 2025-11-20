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
    .addStringOption(o => o.setName('cargos').setDescription('Cargos (@) separados ou IDs')),
  new SlashCommandBuilder().setName('entrar').setDescription('Conecta ao servidor MC'),
  new SlashCommandBuilder().setName('sair').setDescription('Desconecta do servidor MC'),
  new SlashCommandBuilder().setName('setchat').setDescription('Define canais de chat MC ↔ DC').addStringOption(o => o.setName('canais').setDescription('Canais (#) separados ou IDs').setRequired(true)),
  
  // ---------- Comandos de Informação (Existentes) ----------
  new SlashCommandBuilder().setName('status').setDescription('Mostra status do servidor e ping'),
  new SlashCommandBuilder().setName('baixar').setDescription('Links MCPEDL para baixar Minecraft'),

  // ----------------------------------------------------------------------
  // ---------- NOVOS Comandos de Economia e Vinculação ----------
  // ----------------------------------------------------------------------
  
  // Comando: /coins
  new SlashCommandBuilder().setName('coins').setDescription('Mostra seu saldo de moedas ou o ranking de top jogadores')
    .addSubcommand(s => s.setName('saldo').setDescription('Mostra seu saldo atual de moedas'))
    .addSubcommand(s => s.setName('top').setDescription('Mostra o ranking dos jogadores mais ricos')),
    
  // Comando: /pagar
  new SlashCommandBuilder().setName('pagar').setDescription('Transfere moedas para outro jogador')
    .addUserOption(o => o.setName('membro').setDescription('O membro para quem você quer pagar').setRequired(true))
    .addIntegerOption(o => o.setName('valor').setDescription('O valor que você quer transferir').setRequired(true).setMinValue(1)),
    
  // Comando: /vincular
  new SlashCommandBuilder().setName('vincular').setDescription('Vincula seu ID do Discord a um Nickname do Minecraft')
    .addStringOption(o => o.setName('nick').setDescription('Seu nickname exato do Minecraft Bedrock/Java').setRequired(true)),
  
].map(c => c.toJSON()); // Mantenha o .map(c => c.toJSON())