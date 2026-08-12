import {
  SearchRelativeLongitude,
  Body,
  AstroTime,
  Ecliptic,
  GeoVector,
} from 'astronomy-engine';

export const NAKSHATRA_NAMES = [
  'Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra',
  'Punarvasu', 'Pushya', 'Ashlesha', 'Magha', 'Purva Phalguni', 'Uttara Phalguni',
  'Hasta', 'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha',
  'Mula', 'Purva Ashadha', 'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Shatabhisha',
  'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati',
];

export const TITHI_NAMES = [
  'Shukla Pratipada', 'Shukla Dvitiya', 'Shukla Tritiya', 'Shukla Chaturthi', 'Shukla Panchami',
  'Shukla Shasthi', 'Shukla Saptami', 'Shukla Ashtami', 'Shukla Navami', 'Shukla Dashami',
  'Shukla Ekadashi', 'Shukla Dvadashi', 'Shukla Trayodashi', 'Shukla Chaturdashi', 'Purnima',
  'Krishna Pratipada', 'Krishna Dvitiya', 'Krishna Tritiya', 'Krishna Chaturthi', 'Krishna Panchami',
  'Krishna Shasthi', 'Krishna Saptami', 'Krishna Ashtami', 'Krishna Navami', 'Krishna Dashami',
  'Krishna Ekadashi', 'Krishna Dvadashi', 'Krishna Trayodashi', 'Krishna Chaturdashi', 'Amavasya',
];

export const YOGA_NAMES = [
  'Vishkambha', 'Priti', 'Ayushman', 'Saubhagya', 'Shobhana', 'Atiganda', 'Sukarma', 'Dhriti',
  'Shula', 'Ganda', 'Vriddhi', 'Dhruva', 'Vyaghapata', 'Harshana', 'Vajra', 'Siddhi',
  'Vyatipata', 'Variyan', 'Parigha', 'Shiva', 'Siddha', 'Sadhya', 'Shubha', 'Shukla',
  'Brahma', 'Indra', 'Vaidhriti',
];

export const KARANA_NAMES = [
  'Bava', 'Balava', 'Kaulava', 'Taitila', 'Garaja', 'Vanija', 'Vishti',
  'Shakuni', 'Chatushpada', 'Naga', 'Kintughna',
];

/** Lahiri Ayanamsa approximation in degrees */
export function lahiriAyanamsa(date: Date): number {
  const astroTime = new AstroTime(date);
  const t = (astroTime.ut - 51544.5) / 36525;
  return 23.85 + 1.4 * t;
}

/** Get Sidereal Longitude of Moon/Sun */
export function getSiderealLongitude(body: Body, date: Date): number {
  const astroTime = new AstroTime(date);
  const vec = GeoVector(body, astroTime, true);
  const ecl = Ecliptic(vec);
  const ayanamsa = lahiriAyanamsa(date);
  return (ecl.elon - ayanamsa + 360) % 360;
}

export function getTithi(date: Date): { index: number; name: string } {
  const moonDeg = getSiderealLongitude(Body.Moon, date);
  const sunDeg = getSiderealLongitude(Body.Sun, date);
  const diff = (moonDeg - sunDeg + 360) % 360;
  const zeroIndex = Math.floor(diff / 12);
  const index = zeroIndex + 1;
  return { index, name: TITHI_NAMES[zeroIndex] ?? `Tithi ${index}` };
}

export function getNakshatra(date: Date): { index: number; name: string } {
  const moonDeg = getSiderealLongitude(Body.Moon, date);
  const span = 360 / 27; // 13.3333°
  const zeroIndex = Math.floor(moonDeg / span);
  const index = zeroIndex + 1;
  return { index, name: NAKSHATRA_NAMES[zeroIndex] ?? `Nakshatra ${index}` };
}

export function getYoga(date: Date): { index: number; name: string } {
  const moonDeg = getSiderealLongitude(Body.Moon, date);
  const sunDeg = getSiderealLongitude(Body.Sun, date);
  const sum = (moonDeg + sunDeg) % 360;
  const span = 360 / 27;
  const zeroIndex = Math.floor(sum / span);
  const index = zeroIndex + 1;
  return { index, name: YOGA_NAMES[zeroIndex] ?? `Yoga ${index}` };
}

export function getKarana(date: Date): { index: number; name: string } {
  const moonDeg = getSiderealLongitude(Body.Moon, date);
  const sunDeg = getSiderealLongitude(Body.Sun, date);
  const diff = (moonDeg - sunDeg + 360) % 360;
  const halfTithi = Math.floor(diff / 6) + 1; // 1 to 60 half-tithis

  // Classical Karana sequence assignment:
  // Half-Tithi 1: Kintughna
  // Half-Tithis 2-57: Cycle of 7 movable karanas (Bava through Vishti) 8 times
  // Half-Tithi 58: Shakuni
  // Half-Tithi 59: Chatushpada
  // Half-Tithi 60: Naga
  let name = '';
  if (halfTithi === 1) {
    name = 'Kintughna';
  } else if (halfTithi >= 58) {
    const fixedIndex = halfTithi - 58; // 0=Shakuni, 1=Chatushpada, 2=Naga
    name = KARANA_NAMES[7 + fixedIndex];
  } else {
    const movableIndex = (halfTithi - 2) % 7;
    name = KARANA_NAMES[movableIndex];
  }

  return { index: halfTithi, name };
}

/**
 * Finds exact next transition date.
 * TITHI uses SearchRelativeLongitude.
 * NAKSHATRA uses targeted binary search over Moon sidereal longitude.
 */
export function findNextTransition(date: Date, targetType: 'TITHI' | 'NAKSHATRA'): Date {
  const astroTime = new AstroTime(date);

  if (targetType === 'TITHI') {
    const res = SearchRelativeLongitude(Body.Moon, 12, astroTime);
    return res.date;
  }

  // Nakshatra transition search: Find exact time Moon crosses into next 13°20' segment
  const currentMoonDeg = getSiderealLongitude(Body.Moon, date);
  const span = 360 / 27; // 13.333333333°
  const targetIndex = Math.floor(currentMoonDeg / span) + 1;
  const targetDeg = (targetIndex * span) % 360;

  // Search window: Moon moves ~13.2°/day, so transition is within 28 hours max
  let low = date.getTime();
  let high = date.getTime() + 28 * 3600 * 1000;

  for (let i = 0; i < 20; i++) {
    const mid = Math.floor((low + high) / 2);
    const midDeg = getSiderealLongitude(Body.Moon, new Date(mid));

    // Check crossed boundary handling 360/0 wrap
    let diff = midDeg - currentMoonDeg;
    if (diff < 0) diff += 360;

    const targetDiff = targetDeg - currentMoonDeg;
    const normTargetDiff = targetDiff < 0 ? targetDiff + 360 : targetDiff;

    if (diff >= normTargetDiff) {
      high = mid;
    } else {
      low = mid;
    }
  }

  return new Date(Math.floor((low + high) / 2));
}
