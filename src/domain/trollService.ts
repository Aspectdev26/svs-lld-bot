import * as settingsRepo from "../sheets/settingsRepo.js";

export async function isTrollEnabled(): Promise<boolean> {
  const settings = await settingsRepo.getSettings();
  return settings.trollEnabled;
}

export async function setTrollEnabled(enabled: boolean): Promise<void> {
  await settingsRepo.setTrollEnabled(enabled);
}
