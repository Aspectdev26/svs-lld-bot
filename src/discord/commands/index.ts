import type { Command } from "../commandTypes.js";
import { challengeCommand } from "./challenge.js";
import { reportWinCommand } from "./reportWin.js";
import { dodgeCommand } from "./dodge.js";
import { ladderCommand } from "./ladder.js";
import { trollToggleCommand } from "./trollToggle.js";

export const commands: Command[] = [challengeCommand, reportWinCommand, dodgeCommand, ladderCommand, trollToggleCommand];

export const commandsByName = new Map(commands.map((c) => [c.data.name, c]));
