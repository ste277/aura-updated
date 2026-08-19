import { getKarana, getNakshatra, getTithi, getYoga } from '../../vedic/src/panchangElements';
import type { SolarWindowType } from '../../panchang/src/windows';

export type MuhurtaActivityFamily =
  | 'DEEP_WORK'
  | 'WORKOUT'
  | 'LEARNING'
  | 'MEDITATION'
  | 'RELATIONSHIP'
  | 'JOURNEY_START'
  | 'SOCIAL'
  | 'MEAL'
  | 'FINANCE'
  | 'NEW_BEGINNING'
  | 'ADMIN'
  | 'WELLBEING'
  | 'FOCUSED_WORK';

export interface PanchangaSnapshot {
  tithi: string;
  nakshatra: string;
  yoga: string;
  karana: string;
}

export interface MuhurtaEvaluation {
  family: MuhurtaActivityFamily;
  panchanga: PanchangaSnapshot;
  modifier: number;
  blockers: string[];
  supports: string[];
  summary: string;
}

const FAVORABLE_YOGAS = new Set(['Priti', 'Ayushman', 'Saubhagya', 'Shobhana', 'Sukarma', 'Dhriti', 'Harshana', 'Siddhi', 'Shiva', 'Siddha', 'Sadhya', 'Shubha', 'Shukla', 'Brahma', 'Indra']);
const DIFFICULT_YOGAS = new Set(['Atiganda', 'Shula', 'Ganda', 'Vyaghapata', 'Vyatipata', 'Vajra', 'Parigha', 'Vaidhriti']);
const FAVORABLE_KARANAS = new Set(['Bava', 'Balava', 'Kaulava', 'Taitila', 'Garaja', 'Vanija']);

const RULES: Record<MuhurtaActivityFamily, {
  preferredNakshatras: string[];
  avoidNakshatras: string[];
  preferredTithiPatterns: RegExp[];
  avoidTithiPatterns: RegExp[];
  note: string;
}> = {
  DEEP_WORK: {
    preferredNakshatras: ['Rohini', 'Mrigashira', 'Hasta', 'Chitra', 'Anuradha', 'Shravana', 'Revati'],
    avoidNakshatras: ['Ardra', 'Ashlesha', 'Jyeshtha', 'Mula'],
    preferredTithiPatterns: [/Panchami/, /Saptami/, /Dashami/, /Ekadashi/, /Trayodashi/],
    avoidTithiPatterns: [/Amavasya/, /Chaturdashi/],
    note: 'supports sustained focus',
  },
  WORKOUT: {
    preferredNakshatras: ['Krittika', 'Mrigashira', 'Chitra', 'Dhanishta', 'Shatabhisha'],
    avoidNakshatras: ['Ashlesha', 'Jyeshtha', 'Revati'],
    preferredTithiPatterns: [/Tritiya/, /Panchami/, /Saptami/, /Dashami/],
    avoidTithiPatterns: [/Amavasya/, /Chaturdashi/],
    note: 'supports physical output',
  },
  LEARNING: {
    preferredNakshatras: ['Rohini', 'Mrigashira', 'Punarvasu', 'Pushya', 'Hasta', 'Anuradha', 'Shravana', 'Revati'],
    avoidNakshatras: ['Ardra', 'Ashlesha', 'Mula'],
    preferredTithiPatterns: [/Panchami/, /Saptami/, /Ekadashi/, /Trayodashi/],
    avoidTithiPatterns: [/Amavasya/],
    note: 'supports study and retention',
  },
  MEDITATION: {
    preferredNakshatras: ['Punarvasu', 'Pushya', 'Hasta', 'Anuradha', 'Shravana', 'Revati'],
    avoidNakshatras: ['Bharani', 'Krittika', 'Ardra'],
    preferredTithiPatterns: [/Ekadashi/, /Purnima/, /Pratipada/],
    avoidTithiPatterns: [],
    note: 'supports quiet inward work',
  },
  RELATIONSHIP: {
    preferredNakshatras: ['Rohini', 'Mrigashira', 'Uttara Phalguni', 'Hasta', 'Swati', 'Anuradha', 'Revati'],
    avoidNakshatras: ['Bharani', 'Ardra', 'Ashlesha', 'Jyeshtha', 'Mula'],
    preferredTithiPatterns: [/Dvitiya/, /Tritiya/, /Panchami/, /Saptami/, /Dashami/, /Trayodashi/],
    avoidTithiPatterns: [/Amavasya/, /Chaturdashi/],
    note: 'supports ease and connection',
  },
  JOURNEY_START: {
    preferredNakshatras: ['Ashwini', 'Mrigashira', 'Punarvasu', 'Hasta', 'Anuradha', 'Shravana', 'Dhanishta', 'Revati'],
    avoidNakshatras: ['Bharani', 'Krittika', 'Ashlesha', 'Jyeshtha', 'Mula'],
    preferredTithiPatterns: [/Dvitiya/, /Tritiya/, /Panchami/, /Saptami/, /Dashami/, /Ekadashi/],
    avoidTithiPatterns: [/Amavasya/, /Chaturdashi/],
    note: 'supports a smoother start',
  },
  SOCIAL: {
    preferredNakshatras: ['Rohini', 'Mrigashira', 'Uttara Phalguni', 'Hasta', 'Swati', 'Anuradha', 'Revati'],
    avoidNakshatras: ['Ashlesha', 'Jyeshtha'],
    preferredTithiPatterns: [/Dvitiya/, /Tritiya/, /Panchami/, /Saptami/, /Dashami/],
    avoidTithiPatterns: [],
    note: 'supports enjoyment and social flow',
  },
  MEAL: {
    preferredNakshatras: ['Rohini', 'Mrigashira', 'Pushya', 'Hasta', 'Anuradha', 'Revati'],
    avoidNakshatras: [],
    preferredTithiPatterns: [/Dvitiya/, /Tritiya/, /Panchami/, /Saptami/, /Dashami/],
    avoidTithiPatterns: [],
    note: 'supports comfort and nourishment',
  },
  FINANCE: {
    preferredNakshatras: ['Rohini', 'Pushya', 'Uttara Phalguni', 'Hasta', 'Anuradha', 'Uttara Ashadha', 'Shravana', 'Revati'],
    avoidNakshatras: ['Bharani', 'Ardra', 'Ashlesha', 'Jyeshtha', 'Mula'],
    preferredTithiPatterns: [/Dvitiya/, /Tritiya/, /Panchami/, /Saptami/, /Dashami/, /Ekadashi/, /Trayodashi/],
    avoidTithiPatterns: [/Amavasya/, /Chaturdashi/],
    note: 'supports clear commitments',
  },
  NEW_BEGINNING: {
    preferredNakshatras: ['Ashwini', 'Rohini', 'Mrigashira', 'Pushya', 'Hasta', 'Anuradha', 'Uttara Ashadha', 'Shravana', 'Revati'],
    avoidNakshatras: ['Bharani', 'Ardra', 'Ashlesha', 'Jyeshtha', 'Mula'],
    preferredTithiPatterns: [/Dvitiya/, /Tritiya/, /Panchami/, /Saptami/, /Dashami/, /Ekadashi/, /Trayodashi/],
    avoidTithiPatterns: [/Amavasya/, /Chaturdashi/],
    note: 'supports auspicious starts',
  },
  ADMIN: {
    preferredNakshatras: ['Hasta', 'Chitra', 'Swati', 'Shravana', 'Dhanishta'],
    avoidNakshatras: [],
    preferredTithiPatterns: [/Chaturthi/, /Shasthi/, /Dashami/],
    avoidTithiPatterns: [],
    note: 'supports routine cleanup',
  },
  WELLBEING: {
    preferredNakshatras: ['Rohini', 'Punarvasu', 'Pushya', 'Hasta', 'Anuradha', 'Revati'],
    avoidNakshatras: ['Ardra', 'Ashlesha'],
    preferredTithiPatterns: [/Dvitiya/, /Panchami/, /Ekadashi/, /Purnima/],
    avoidTithiPatterns: [],
    note: 'supports recovery and steadiness',
  },
  FOCUSED_WORK: {
    preferredNakshatras: ['Rohini', 'Mrigashira', 'Hasta', 'Chitra', 'Anuradha', 'Shravana', 'Revati'],
    avoidNakshatras: ['Ardra', 'Ashlesha', 'Jyeshtha', 'Mula'],
    preferredTithiPatterns: [/Panchami/, /Saptami/, /Dashami/, /Ekadashi/, /Trayodashi/],
    avoidTithiPatterns: [/Amavasya/, /Chaturdashi/],
    note: 'supports focused execution',
  },
};

export function classifyMuhurtaActivity(taskTitle: string): MuhurtaActivityFamily {
  const title = taskTitle.toLowerCase();
  if (/(journey|travel|trip|flight|train|vacation|relocat|move to a new home)/.test(title)) return 'JOURNEY_START';
  if (/(date|dating|romantic|relationship|partner|proposal|anniversary)/.test(title)) return 'RELATIONSHIP';
  if (/(party|celebration|concert|movie|night out|social|friends)/.test(title)) return 'SOCIAL';
  if (/(meal|dinner|lunch|breakfast|food)/.test(title)) return 'MEAL';
  if (/(financial|finance|investment|invest|loan|property|purchase|contract|transfer money|open account)/.test(title)) return 'FINANCE';
  if (/(start|begin|launch|open|new project|new business|new job|new course|renovation|new habit|marriage|wedding)/.test(title)) return 'NEW_BEGINNING';
  if (/(meditat|breath|mindful|prayer)/.test(title)) return 'MEDITATION';
  if (/(learn|course|read|book|exam|language|practice|certification|study)/.test(title)) return 'LEARNING';
  if (/(workout|training|lift|run|gym|exercise|heavy)/.test(title)) return 'WORKOUT';
  if (/(deep work|focus|coding|code|research|write|writing)/.test(title)) return 'DEEP_WORK';
  if (/(walk|cycling|swim|yoga|stretch|massage|spa|journal|sleep|rest|recover)/.test(title)) return 'WELLBEING';
  if (/(admin|email|inbox|invoice|cleanup|organize|errand|filing|paperwork|docs|document)/.test(title)) return 'ADMIN';
  return 'FOCUSED_WORK';
}

export function getPanchangaSnapshot(date: Date): PanchangaSnapshot {
  return {
    tithi: getTithi(date).name,
    nakshatra: getNakshatra(date).name,
    yoga: getYoga(date).name,
    karana: getKarana(date).name,
  };
}

export function evaluateMuhurta(params: {
  taskTitle: string;
  date: Date;
  windowType: SolarWindowType;
  family?: MuhurtaActivityFamily;
}): MuhurtaEvaluation {
  const family = params.family ?? classifyMuhurtaActivity(params.taskTitle);
  const rules = RULES[family];
  const panchanga = getPanchangaSnapshot(params.date);
  const supports: string[] = [];
  const blockers: string[] = [];
  let modifier = 0;

  if (rules.preferredNakshatras.includes(panchanga.nakshatra)) {
    modifier += 8;
    supports.push(`${panchanga.nakshatra} ${rules.note}`);
  } else if (rules.avoidNakshatras.includes(panchanga.nakshatra)) {
    modifier -= 10;
    blockers.push(`${panchanga.nakshatra} is less supportive for this activity`);
  }

  if (rules.preferredTithiPatterns.some((pattern) => pattern.test(panchanga.tithi))) {
    modifier += 5;
    supports.push(`${panchanga.tithi} is a helpful tithi`);
  } else if (rules.avoidTithiPatterns.some((pattern) => pattern.test(panchanga.tithi))) {
    modifier -= 8;
    blockers.push(`${panchanga.tithi} is better for lower-stakes work`);
  }

  if (FAVORABLE_YOGAS.has(panchanga.yoga)) {
    modifier += 4;
    supports.push(`${panchanga.yoga} yoga adds support`);
  } else if (DIFFICULT_YOGAS.has(panchanga.yoga)) {
    modifier -= 6;
    blockers.push(`${panchanga.yoga} yoga adds friction`);
  }

  if (panchanga.karana === 'Vishti') {
    modifier -= 8;
    blockers.push('Vishti karana is avoided for important starts');
  } else if (FAVORABLE_KARANAS.has(panchanga.karana)) {
    modifier += 3;
    supports.push(`${panchanga.karana} karana is workable`);
  }

  if (params.windowType === 'RAHU_KALAM' || params.windowType === 'YAMA') {
    modifier -= family === 'ADMIN' || family === 'SOCIAL' ? 4 : 12;
    blockers.push(`${formatWindow(params.windowType)} is a high-friction period`);
  } else if (params.windowType === 'ABHIJIT') {
    modifier += 8;
    supports.push('Abhijit Muhurta is broadly favorable');
  } else if (params.windowType === 'BRAHMA' && (family === 'MEDITATION' || family === 'LEARNING' || family === 'DEEP_WORK')) {
    modifier += 7;
    supports.push('Brahma Muhurta supports quiet mental work');
  } else if (params.windowType === 'GULIKA' && (family === 'ADMIN' || family === 'LEARNING' || family === 'SOCIAL')) {
    modifier += 4;
    supports.push('Gulika supports steady follow-through');
  }

  return {
    family,
    panchanga,
    modifier,
    blockers,
    supports,
    summary: buildSummary(supports, blockers),
  };
}

function buildSummary(supports: string[], blockers: string[]): string {
  if (blockers.length > 0 && supports.length > 0) return `${supports[0]}; ${blockers[0]}.`;
  if (supports.length > 0) return `${supports[0]}.`;
  if (blockers.length > 0) return `${blockers[0]}.`;
  return 'Panchanga factors are neutral for this activity.';
}

function formatWindow(type: SolarWindowType): string {
  if (type === 'RAHU_KALAM') return 'Rahu Kalam';
  if (type === 'YAMA') return 'Yama Gandam';
  if (type === 'ABHIJIT') return 'Abhijit Muhurta';
  if (type === 'BRAHMA') return 'Brahma Muhurta';
  if (type === 'GULIKA') return 'Gulika Kalam';
  return 'Neutral Flow';
}
