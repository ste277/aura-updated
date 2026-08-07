import { getNatalChart } from './natalChart';

export interface TransitInsight {
  graha: string;
  natalRashi: number;
  transitRashi: number;
  houseFromMoon: number;
  isBenefic: boolean;
  insight: string;
}

export function calculateDailyTransits(
  birthDate: Date,
  birthLat: number,
  birthLng: number,
  currentDate: Date = new Date(),
  currentLat: number = 13.0827,
  currentLng: number = 80.2707
): TransitInsight[] {
  const natalChart = getNatalChart(birthDate);
  const natalMoon = natalChart.find((g) => g.graha === 'Moon');
  if (!natalMoon) return [];

  const transitChart = getNatalChart(currentDate);

  return transitChart.map((tGraha) => {
    const houseFromMoon = ((tGraha.rashiIndex - natalMoon.rashiIndex + 12) % 12) + 1;
    const isBenefic = checkTransitFavorability(tGraha.graha, houseFromMoon);

    return {
      graha: tGraha.graha,
      natalRashi: natalChart.find((g) => g.graha === tGraha.graha)?.rashiIndex ?? 0,
      transitRashi: tGraha.rashiIndex,
      houseFromMoon,
      isBenefic,
      insight: getTransitSummary(tGraha.graha, houseFromMoon, isBenefic),
    };
  });
}

function checkTransitFavorability(graha: string, house: number): boolean {
  const rules: Record<string, number[]> = {
    Sun: [3, 6, 10, 11],
    Moon: [1, 3, 6, 7, 10, 11],
    Mars: [3, 6, 11],
    Mercury: [2, 3, 4, 6, 8, 10, 11],
    Jupiter: [2, 5, 7, 9, 11],
    Venus: [1, 2, 3, 4, 5, 8, 9, 11, 12],
    Saturn: [3, 6, 11],
    Rahu: [3, 6, 11],
    Ketu: [3, 6, 11],
  };
  return rules[graha]?.includes(house) ?? false;
}

function getTransitSummary(graha: string, house: number, isBenefic: boolean): string {
  if (isBenefic) {
    const positiveCopy: Record<string, string> = {
      Sun: `Sun in House ${house} brings clear executive drive, energy, and success in official matters.`,
      Moon: `Moon in House ${house} grants mental clarity, high vitality, and smooth personal momentum.`,
      Mercury: `Mercury in House ${house} accelerates analytical thinking, communication, and swift execution.`,
      Venus: `Venus in House ${house} enhances creative harmony, rapport, and comfortable workflow.`,
      Mars: `Mars in House ${house} provides bold energy to tackle backlogs and execute complex tasks.`,
      Jupiter: `Jupiter in House ${house} brings wisdom, expansion, and favorable guidance across decisions.`,
      Saturn: `Saturn in House ${house} rewards disciplined labor with long-term stability and success.`,
      Rahu: `Rahu in House ${house} unlocks unconventional breakthroughs and ambitious expansion.`,
      Ketu: `Ketu in House ${house} grants keen intuitive focus and sharp problem-solving capacity.`,
    };
    return positiveCopy[graha] ?? `${graha} transiting House ${house} brings favorable focus and momentum.`;
  }

  const cautionCopy: Record<string, string> = {
    Sun: `Sun in House ${house} advises moderation against authority conflicts or physical fatigue.`,
    Moon: `Moon in House ${house} suggests pacing emotional reactivity during quick decision-making.`,
    Mercury: `Mercury in House ${house} recommends double-checking documentation and technical comms.`,
    Venus: `Venus in House ${house} cautions against overindulgence or minor interpersonal friction.`,
    Mars: `Mars in House ${house} warns against hasty actions or impulsive confrontation.`,
    Jupiter: `Jupiter in House ${house} prompts careful financial planning and avoiding overcommitment.`,
    Saturn: `Saturn in House ${house} indicates potential delays—focus on steady, patience-tested effort.`,
    Rahu: `Rahu in House ${house} warns against distraction, over-promising, or speculative risks.`,
    Ketu: `Ketu in House ${house} advises guarding against detachment or miscommunication.`,
  };
  return cautionCopy[graha] ?? `${graha} transiting House ${house} suggests mindfulness during execution.`;
}