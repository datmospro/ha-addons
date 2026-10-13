export const suits = [
  { id: "oros", name: "Oros", emoji: "💰" },
  { id: "copas", name: "Copas", emoji: "🏆" },
  { id: "espadas", name: "Espadas", emoji: "⚔️" },
  { id: "bastos", name: "Bastos", emoji: "🌿" },
];
export function playersFor(match) {
  return match.settings?.playerOrder?.length
    ? match.settings.playerOrder
    : match.teams.flatMap((t) =>
        (t.players || []).map((name) => ({ name, teamId: t.id })),
      );
}
export function dealerFor(match, count = match.history.length) {
  const players = playersFor(match);
  return players.length
    ? ((match.settings?.startingDealerIndex || 0) + count) % players.length
    : null;
}
export function normalizeHistory(match, history) {
  return history.map((entry, i) => ({
    ...entry,
    round: history.length - i,
    dealerIndex: dealerFor(match, history.length - i - 1),
    scoringTeamId: entry.skipped
      ? null
      : entry.success
        ? entry.teamId
        : match.teams.find((t) => t.id !== entry.teamId)?.id,
  }));
}
export function scoresFromHistory(teams, history) {
  return teams.map((team) => ({
    ...team,
    score: history.reduce((sum, entry) => {
      if (entry.skipped) return sum;
      const scoring = entry.success
        ? entry.teamId
        : teams.find((t) => t.id !== entry.teamId)?.id;
      return sum + (scoring === team.id ? Number(entry.bid) || 0 : 0);
    }, 0),
  }));
}
export function appendRound(match, auction, success, skipped = false) {
  // Legacy schema needs a team ID; skipped deals never award points to it.
  const entry = {
    round: match.history.length + 1,
    teamId: skipped ? match.teams[0].id : auction.teamId,
    bid: skipped ? 0 : Number(auction.bid),
    suit: skipped ? null : auction.suit,
    success: skipped ? false : success,
    skipped,
    dealerIndex: dealerFor(match),
    timestamp: new Date().toISOString(),
  };
  const history = normalizeHistory(match, [entry, ...match.history]);
  return { history, teams: scoresFromHistory(match.teams, history) };
}
