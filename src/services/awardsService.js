const INVALID_VALUES = new Set(["n/a", "na", "none", "null", "undefined", "-"]);

function pluralize(count, singular, plural) {
  return count === 1 ? `${count} ${singular}` : `${count} ${plural}`;
}

/**
 * Parses an OMDb `Awards` summary string (e.g. "Won 7 Oscars. 92 wins & 143 nominations total")
 * into structured Oscar, major prestige, and total win/nomination fields. Returns null when empty or "N/A".
 */
export function parseAwardsSummary(rawAwards) {
  if (typeof rawAwards !== "string") return null;
  const cleaned = rawAwards.trim().replace(/\s+/g, " ");
  if (!cleaned || INVALID_VALUES.has(cleaned.toLowerCase())) return null;

  let oscarWins = 0;
  let oscarNominations = 0;
  let prestigeLabel = null;

  const oscarWinMatch = cleaned.match(/Won\s+(\d+)\s+Oscars?/i);
  const oscarNomMatch = cleaned.match(/Nominated\s+for\s+(\d+)\s+Oscars?/i);

  if (oscarWinMatch) {
    oscarWins = Number.parseInt(oscarWinMatch[1], 10) || 0;
  } else if (oscarNomMatch) {
    oscarNominations = Number.parseInt(oscarNomMatch[1], 10) || 0;
  } else {
    const prestigeMatch = cleaned.match(/^((?:Won|Nominated\s+for)\s+\d+\s+[^.]+)\./i);
    if (prestigeMatch) {
      prestigeLabel = prestigeMatch[1].trim();
    }
  }

  // OMDb uses either "92 wins & 143 nominations total" or older "Another 4 wins & 7 nominations."
  const remainder = cleaned.replace(/^[^.]*(?:Oscars?|Globes?|BAFTA[^.]*|Emmy[^.]*)\.\s*/i, "");
  const winsMatch = remainder.match(/(?:^|\b)(?:Another\s+)?(\d+)\s+wins?\b/i);
  const nomsMatch = remainder.match(/(?:^|\b)(\d+)\s+nominations?\b/i);

  const wins = winsMatch ? Number.parseInt(winsMatch[1], 10) || 0 : 0;
  const nominations = nomsMatch ? Number.parseInt(nomsMatch[1], 10) || 0 : 0;

  let oscarLabel = null;
  if (oscarWins > 0) {
    oscarLabel = `Won ${pluralize(oscarWins, "Oscar", "Oscars")}`;
  } else if (oscarNominations > 0) {
    oscarLabel = `${pluralize(oscarNominations, "Oscar nomination", "Oscar nominations")}`;
  }

  const totalParts = [];
  if (wins > 0) totalParts.push(pluralize(wins, "win", "wins"));
  if (nominations > 0) totalParts.push(pluralize(nominations, "nomination", "nominations"));
  const totalLabel = totalParts.join(" · ");

  const headline = !oscarLabel && !prestigeLabel && !totalLabel ? cleaned : null;

  return {
    raw: cleaned,
    oscarWins,
    oscarNominations,
    hasOscars: oscarWins > 0 || oscarNominations > 0,
    isOscarWinner: oscarWins > 0,
    oscarLabel,
    prestigeLabel,
    wins,
    nominations,
    totalLabel,
    headline
  };
}
