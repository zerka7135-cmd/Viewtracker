import { SlashCommandBuilder } from 'discord.js';

export const resumeCommand = new SlashCommandBuilder()
  .setName('views')
  .setDescription('Affiche le nombre de vues des dernières publications Instagram, tiktok et youtube');
