import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type ButtonInteraction, type GuildMember } from "discord.js";
import { isLeagueManager } from "../../permissions.js";
import { shuffleLadderRanks } from "../../../domain/adminService.js";
import * as matchesRepo from "../../../sheets/matchesRepo.js";
import { notify } from "../../notify.js";
import { refreshTop10Panel } from "../../top10Panel.js";
import { scheduleReplyCleanup, scheduleMessageCleanup } from "../../ephemeralCleanup.js";

const CONFIRM_ID = "admin_rankshuffle_confirm";
const CANCEL_ID = "admin_rankshuffle_cancel";
export const RANK_SHUFFLE_RESOLVE_IDS = [CONFIRM_ID, CANCEL_ID];

async function requireLeagueManager(interaction: ButtonInteraction): Promise<boolean> {
  if (!isLeagueManager(interaction.member as GuildMember | null)) {
    await interaction.reply({ content: "Only League Managers can do that.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return false;
  }
  return true;
}

/** "Shuffle Ranks": randomizes rank order only, with no season archiving or match cancellation. */
export async function handleRankShuffleStart(interaction: ButtonInteraction): Promise<void> {
  if (!(await requireLeagueManager(interaction))) return;

  const pending = await matchesRepo.getPendingMatches();

  let content =
    "⚠️ This will **randomize everyone's rank order** on the ladder. This can't be undone. Are you sure?";
  if (pending.length > 0) {
    content =
      `⚠️ There ${pending.length === 1 ? "is" : "are"} currently **${pending.length} active challenge${pending.length === 1 ? "" : "s"}**. ` +
      "Shuffling now will change the ranks involved in those matches, which can make the challenge context (who challenged whom, at what rank) confusing. " +
      "Consider resolving or force-cancelling them first.\n\n" +
      "This will **randomize everyone's rank order** on the ladder. This can't be undone. Are you sure?";
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CONFIRM_ID).setLabel("Yes, shuffle ranks").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(CANCEL_ID).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({ content, components: [row], ephemeral: true });
}

export async function handleRankShuffleResolve(interaction: ButtonInteraction): Promise<void> {
  if (!(await requireLeagueManager(interaction))) return;

  if (interaction.customId === CANCEL_ID) {
    await interaction.update({ content: "Shuffle cancelled — no changes made.", components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  await interaction.update({ content: "Shuffling…", components: [] });

  const { changedCount } = await shuffleLadderRanks();

  const followUp = await interaction.followUp({ content: `Done. ${changedCount} rank(s) changed.`, ephemeral: true });
  scheduleReplyCleanup(interaction);
  scheduleMessageCleanup(followUp);

  const embed = new EmbedBuilder()
    .setTitle("🔀 Ranks Shuffled")
    .setDescription(`<@${interaction.user.id}> shuffled the ladder's rank order (${changedCount} rank(s) changed).`)
    .setColor(0x992d22);
  await notify.challenges(interaction.client, { embeds: [embed] });
  await refreshTop10Panel(interaction.client).catch((err) => console.error("Failed to refresh top 10 panel:", err));
}
