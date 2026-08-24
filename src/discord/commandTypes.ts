import type { AutocompleteInteraction, ChatInputCommandInteraction } from "discord.js";

export interface SlashCommandData {
  name: string;
  toJSON(): unknown;
}

export interface Command {
  data: SlashCommandData;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}
