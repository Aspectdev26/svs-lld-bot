import type { Client } from "discord.js";
import { commandsByName } from "../commands/index.js";
import { handleDodgeButton, DENY_MODAL_PREFIX } from "../components/dodgeButtons.js";
import { handleDodgeDenyModal } from "../components/dodgeDenyModal.js";
import { handleMatchChannelButton } from "../components/matchChannelButtons.js";
import { handleExtensionButton } from "../components/extensionButtons.js";
import { REGISTER_START_BUTTON_ID, LEAVE_LADDER_BUTTON_ID } from "../registerPanel.js";
import {
  handleLeaveLadderStartButton,
  handleLeaveLadderElementSelect,
  handleLeaveLadderResolve,
  LEAVE_ELEMENT_SELECT_ID,
  LEAVE_CONFIRM_PREFIX,
  LEAVE_CANCEL_ID,
} from "../components/leaveLadderFlow.js";
import {
  handleRegisterStartButton,
  handleElementSelect,
  handleBuildSelect,
  handleNameModal,
  handleRegisterApproveDenyButton,
  handleRegisterDenyModal,
  DENY_MODAL_PREFIX as REG_DENY_MODAL_PREFIX,
} from "../components/registerFlow.js";
import { CHALLENGE_START_BUTTON_ID } from "../challengePanel.js";
import { TARGET_SELECT_PREFIX } from "../challengeFlow.js";
import {
  handleChallengeStartButton,
  handleChallengeElementSelect,
  handleChallengeTargetSelect,
} from "../components/challengeFlowButtons.js";
import { ADMIN_BUTTON_IDS } from "../adminPanel.js";
import { maybeTrollAdminAction } from "../troll.js";
import { scheduleReplyCleanup } from "../ephemeralCleanup.js";
import { handleShuffleStart, handleShuffleResolve, handleShuffleNameModal, SEASON_NAME_MODAL_ID } from "../components/admin/adminShuffle.js";
import {
  handleRemoveStart,
  handleRemoveCharacterSelect,
  handleRemoveResolve,
  handleBanStart,
  handleBanUserSelect,
  handleBanElementSelect,
  handleBanReasonModal,
  BAN_REASON_MODAL_PREFIX,
  handleUnbanStart,
  handleUnbanSelect,
} from "../components/admin/adminPlayerActions.js";
import { handleVacationStart, handleVacationSelect, VACATION_SELECT_ID } from "../components/admin/adminVacation.js";
import {
  handleRankShuffleStart,
  handleRankShuffleResolve,
  RANK_SHUFFLE_RESOLVE_IDS,
} from "../components/admin/adminRankShuffle.js";
import { handlePauseToggle } from "../components/admin/adminPause.js";
import { handleGuideButton } from "../components/admin/adminGuide.js";
import {
  handleCancelMatchStart,
  handleCancelMatchSelect,
  handleCancelMatchResolve,
  handleSetRankStart,
  handleSetRankUserSelect,
  handleSetRankElementSelect,
  handleSetRankModal,
} from "../components/admin/adminMatchAndRank.js";
import {
  handlePendingSignupsStart,
  handlePendingSignupSelect,
  PENDING_SIGNUPS_SELECT_ID,
} from "../components/admin/adminPendingSignups.js";
import { WINNER_SELECT_PREFIX } from "../reportWinFlow.js";
import { handleWinnerSelect } from "../components/reportWinSelect.js";

const MATCH_CHANNEL_BUTTON_PREFIXES = [
  "matchch_report:",
  "matchch_dodge:",
  "matchch_dodge_submit:",
  "matchch_extend:",
  "matchch_cancel:",
];
const EXTENSION_BUTTON_PREFIXES = ["extend_approve:", "extend_deny:"];
const DODGE_BUTTON_PREFIXES = ["dodge_approve:", "dodge_deny:"];
const REGISTER_APPROVE_DENY_PREFIXES = ["reg_approve:", "reg_deny:"];
const REG_BUILD_SELECT_PREFIX = "reg_build_select:";
const REG_NAME_MODAL_PREFIX = "reg_name_modal:";
const CHAL_ELEMENT_SELECT_ID = "chal_element_select";
const CHAL_TARGET_SELECT_PREFIX = `${TARGET_SELECT_PREFIX}:`;

const ADMIN_BUTTON_ID_VALUES: string[] = Object.values(ADMIN_BUTTON_IDS);
const ADMIN_SHUFFLE_RESOLVE_IDS = ["admin_shuffle_confirm", "admin_shuffle_cancel"];
const ADMIN_REMOVE_RESOLVE_PREFIXES = ["admin_remove_confirm:", "admin_remove_cancel"];
const ADMIN_CANCEL_RESOLVE_PREFIXES = ["admin_cancel_confirm:", "admin_cancel_cancel"];
const ADMIN_REMOVE_CHARACTER_SELECT_ID = "admin_remove_character";
const ADMIN_BAN_ELEMENT_SELECT_PREFIX = "admin_ban_element:";
const ADMIN_SETRANK_ELEMENT_SELECT_PREFIX = "admin_setrank_element:";
const ADMIN_SETRANK_MODAL_PREFIX = "admin_setrank_modal:";
const WINNER_SELECT_PREFIX_WITH_COLON = `${WINNER_SELECT_PREFIX}:`;
const LEAVE_RESOLVE_PREFIXES = [`${LEAVE_CONFIRM_PREFIX}:`, LEAVE_CANCEL_ID];

export function registerInteractionEvent(client: Client): void {
  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        const command = commandsByName.get(interaction.commandName);
        if (!command) return;
        await command.execute(interaction);
        return;
      }

      if (interaction.isAutocomplete()) {
        const command = commandsByName.get(interaction.commandName);
        if (!command?.autocomplete) return;
        await command.autocomplete(interaction);
        return;
      }

      if (interaction.isUserSelectMenu()) {
        if (interaction.customId === "admin_ban_user") {
          await handleBanUserSelect(interaction);
        } else if (interaction.customId === "admin_setrank_user") {
          await handleSetRankUserSelect(interaction);
        }
        return;
      }

      if (interaction.isStringSelectMenu()) {
        if (interaction.customId === "reg_element_select") {
          await handleElementSelect(interaction);
        } else if (interaction.customId.startsWith(REG_BUILD_SELECT_PREFIX)) {
          await handleBuildSelect(interaction);
        } else if (interaction.customId === CHAL_ELEMENT_SELECT_ID) {
          await handleChallengeElementSelect(interaction);
        } else if (interaction.customId.startsWith(CHAL_TARGET_SELECT_PREFIX)) {
          await handleChallengeTargetSelect(interaction);
        } else if (interaction.customId === ADMIN_REMOVE_CHARACTER_SELECT_ID) {
          await handleRemoveCharacterSelect(interaction);
        } else if (interaction.customId.startsWith(ADMIN_BAN_ELEMENT_SELECT_PREFIX)) {
          await handleBanElementSelect(interaction);
        } else if (interaction.customId === "admin_unban_select") {
          await handleUnbanSelect(interaction);
        } else if (interaction.customId === "admin_cancel_select") {
          await handleCancelMatchSelect(interaction);
        } else if (interaction.customId.startsWith(ADMIN_SETRANK_ELEMENT_SELECT_PREFIX)) {
          await handleSetRankElementSelect(interaction);
        } else if (interaction.customId === PENDING_SIGNUPS_SELECT_ID) {
          await handlePendingSignupSelect(interaction);
        } else if (interaction.customId === VACATION_SELECT_ID) {
          await handleVacationSelect(interaction);
        } else if (interaction.customId.startsWith(WINNER_SELECT_PREFIX_WITH_COLON)) {
          await handleWinnerSelect(interaction);
        } else if (interaction.customId === LEAVE_ELEMENT_SELECT_ID) {
          await handleLeaveLadderElementSelect(interaction);
        }
        return;
      }

      if (interaction.isButton()) {
        if (interaction.customId === REGISTER_START_BUTTON_ID) {
          await handleRegisterStartButton(interaction);
        } else if (interaction.customId === LEAVE_LADDER_BUTTON_ID) {
          await handleLeaveLadderStartButton(interaction);
        } else if (LEAVE_RESOLVE_PREFIXES.some((p) => interaction.customId.startsWith(p))) {
          await handleLeaveLadderResolve(interaction);
        } else if (interaction.customId === CHALLENGE_START_BUTTON_ID) {
          await handleChallengeStartButton(interaction);
        } else if (interaction.customId === ADMIN_BUTTON_IDS.shuffle) {
          await handleShuffleStart(interaction);
        } else if (ADMIN_SHUFFLE_RESOLVE_IDS.includes(interaction.customId)) {
          await handleShuffleResolve(interaction);
        } else if (interaction.customId === ADMIN_BUTTON_IDS.remove) {
          await handleRemoveStart(interaction);
        } else if (ADMIN_REMOVE_RESOLVE_PREFIXES.some((p) => interaction.customId.startsWith(p))) {
          await handleRemoveResolve(interaction);
        } else if (interaction.customId === ADMIN_BUTTON_IDS.ban) {
          await handleBanStart(interaction);
        } else if (interaction.customId === ADMIN_BUTTON_IDS.unban) {
          await handleUnbanStart(interaction);
        } else if (interaction.customId === ADMIN_BUTTON_IDS.cancelMatch) {
          await handleCancelMatchStart(interaction);
        } else if (ADMIN_CANCEL_RESOLVE_PREFIXES.some((p) => interaction.customId.startsWith(p))) {
          await handleCancelMatchResolve(interaction);
        } else if (interaction.customId === ADMIN_BUTTON_IDS.setRank) {
          await handleSetRankStart(interaction);
        } else if (interaction.customId === ADMIN_BUTTON_IDS.pendingSignups) {
          await handlePendingSignupsStart(interaction);
        } else if (interaction.customId === ADMIN_BUTTON_IDS.vacation) {
          await handleVacationStart(interaction);
        } else if (interaction.customId === ADMIN_BUTTON_IDS.rankShuffle) {
          await handleRankShuffleStart(interaction);
        } else if (RANK_SHUFFLE_RESOLVE_IDS.includes(interaction.customId)) {
          await handleRankShuffleResolve(interaction);
        } else if (interaction.customId === ADMIN_BUTTON_IDS.pauseToggle) {
          await handlePauseToggle(interaction);
        } else if (interaction.customId === ADMIN_BUTTON_IDS.guide) {
          await handleGuideButton(interaction);
        } else if (REGISTER_APPROVE_DENY_PREFIXES.some((p) => interaction.customId.startsWith(p))) {
          await handleRegisterApproveDenyButton(interaction);
        } else if (DODGE_BUTTON_PREFIXES.some((p) => interaction.customId.startsWith(p))) {
          await handleDodgeButton(interaction);
        } else if (MATCH_CHANNEL_BUTTON_PREFIXES.some((p) => interaction.customId.startsWith(p))) {
          await handleMatchChannelButton(interaction);
        } else if (EXTENSION_BUTTON_PREFIXES.some((p) => interaction.customId.startsWith(p))) {
          await handleExtensionButton(interaction);
        }

        if (ADMIN_BUTTON_ID_VALUES.includes(interaction.customId)) {
          await maybeTrollAdminAction(interaction).catch((err) => console.error("Troll check failed:", err));
        }
        return;
      }

      if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith(REG_NAME_MODAL_PREFIX)) {
          await handleNameModal(interaction);
        } else if (interaction.customId.startsWith(`${REG_DENY_MODAL_PREFIX}:`)) {
          await handleRegisterDenyModal(interaction);
        } else if (interaction.customId.startsWith(`${DENY_MODAL_PREFIX}:`)) {
          await handleDodgeDenyModal(interaction);
        } else if (interaction.customId.startsWith(`${BAN_REASON_MODAL_PREFIX}:`)) {
          await handleBanReasonModal(interaction);
        } else if (interaction.customId.startsWith(ADMIN_SETRANK_MODAL_PREFIX)) {
          await handleSetRankModal(interaction);
        } else if (interaction.customId === SEASON_NAME_MODAL_ID) {
          await handleShuffleNameModal(interaction);
        }
        return;
      }
    } catch (err) {
      console.error("Error handling interaction:", err);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction
          .reply({ content: "Something went wrong handling that — please try again.", ephemeral: true })
          .then(() => scheduleReplyCleanup(interaction))
          .catch(() => undefined);
      }
    }
  });
}
