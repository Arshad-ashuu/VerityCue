import { app, pages } from '@microsoft/teams-js';

export interface TeamsContext {
  meetingId: string;
  theme: string;
  inTeams: boolean;
}

/**
 * Falls back to a local context when opened in a plain browser, so the panel is
 * testable outside a meeting.
 */
export async function initTeams(): Promise<TeamsContext> {
  try {
    await app.initialize();
    const context = await app.getContext();
    return {
      meetingId: context.meeting?.id ?? context.chat?.id ?? 'local-dev',
      theme: context.app.theme ?? 'default',
      inTeams: true,
    };
  } catch {
    return { meetingId: 'local-dev', theme: 'default', inTeams: false };
  }
}

export function notifyAppLoaded(): void {
  try {
    app.notifySuccess();
  } catch {
    /* not running in Teams */
  }
}

/** Used by the tab configuration page when the app is added to a meeting. */
export async function saveConfiguration(): Promise<void> {
  await app.initialize();
  pages.config.registerOnSaveHandler((event) => {
    void pages.config
      .setConfig({
        entityId: 'veritycue',
        contentUrl: `${window.location.origin}/`,
        suggestedDisplayName: 'VerityCue',
      })
      .then(() => event.notifySuccess());
  });
  await pages.config.setValidityState(true);
}
