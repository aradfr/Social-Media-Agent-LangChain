import { getActiveProfile } from "../profiles/index.js";

/**
 * Content exclusion rules. Lists come from the active profile's `exclusions`
 * section (empty in the default profile = nothing excluded).
 */

export function shouldExcludeGeneralContent(url: string): boolean {
  const { domains } = getActiveProfile().exclusions;
  return domains.some((d) => url.includes(d));
}

export function shouldExcludeGitHubContent(link: string): boolean {
  const { githubOrgs } = getActiveProfile().exclusions;
  return githubOrgs.some((org) => link.includes(`github.com/${org}/`));
}

export function shouldExcludeYouTubeContent(channelName: string): boolean {
  const { youtubeChannels } = getActiveProfile().exclusions;
  return youtubeChannels.some(
    (c) => c.toLowerCase() === channelName.toLowerCase(),
  );
}

export function shouldExcludeTweetContent(externalUrls: string[]): boolean {
  // Some profiles only want tweets that link to external content.
  if (!getActiveProfile().exclusions.tweetsRequireExternalUrls) {
    return false;
  }
  return externalUrls.length === 0;
}
