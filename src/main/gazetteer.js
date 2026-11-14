// Place names -> coordinates and region tags, used to put news headlines on the map.
// Order matters: when several places match, the one listed first wins.
// Each entry: [names[], lat, lon, region]

const PLACES = [
  // ---- Middle East
  [['gaza', 'gaza strip', 'rafah', 'khan younis'], 31.42, 34.37, 'middle_east'],
  [['west bank', 'jenin', 'nablus', 'ramallah', 'hebron'], 32.0, 35.25, 'middle_east'],
  [['jerusalem'], 31.77, 35.21, 'middle_east'],
  [['tel aviv'], 32.08, 34.78, 'middle_east'],
  [['israel', 'israeli', 'IDF', 'netanyahu'], 31.5, 34.9, 'middle_east'],
  [['lebanon', 'lebanese', 'beirut', 'hezbollah'], 33.89, 35.5, 'middle_east'],
  [['syria', 'syrian', 'damascus', 'aleppo', 'idlib'], 34.8, 38.99, 'middle_east'],
  [['iran', 'iranian', 'tehran', 'IRGC', 'khamenei'], 35.69, 51.39, 'middle_east'],
  [['iraq', 'iraqi', 'baghdad', 'mosul', 'erbil', 'basra'], 33.31, 44.36, 'middle_east'],
  [['yemen', 'yemeni', 'houthi', 'houthis', 'sanaa', 'hodeidah', 'aden'], 15.37, 44.19, 'middle_east'],
  [['red sea', 'bab el-mandeb', 'bab al-mandab'], 16.5, 41.0, 'middle_east'],
  [['strait of hormuz', 'hormuz'], 26.57, 56.25, 'middle_east'],
  [['persian gulf', 'gulf states'], 27.0, 51.0, 'middle_east'],
  [['saudi arabia', 'saudi', 'riyadh', 'aramco', 'MBS'], 24.71, 46.68, 'middle_east'],
  [['united arab emirates', 'UAE', 'dubai', 'abu dhabi'], 24.45, 54.38, 'middle_east'],
  [['qatar', 'qatari', 'doha'], 25.29, 51.53, 'middle_east'],
  [['kuwait', 'kuwaiti'], 29.37, 47.98, 'middle_east'],
  [['oman', 'omani', 'muscat'], 23.59, 58.41, 'middle_east'],
  [['bahrain'], 26.07, 50.56, 'middle_east'],
  [['jordan', 'jordanian', 'amman'], 31.95, 35.93, 'middle_east'],
  [['turkey', 'turkish', 'turkiye', 'ankara', 'istanbul', 'erdogan'], 39.93, 32.86, 'middle_east'],
  [['egypt', 'egyptian', 'cairo', 'suez', 'suez canal', 'sinai'], 30.04, 31.24, 'middle_east'],

  // ---- Russia / Ukraine / Europe
  [['kyiv', 'kiev'], 50.45, 30.52, 'russia_ukraine'],
  [['kharkiv'], 49.99, 36.23, 'russia_ukraine'],
  [['odesa', 'odessa'], 46.48, 30.72, 'russia_ukraine'],
  [['donetsk', 'donbas', 'bakhmut', 'avdiivka', 'pokrovsk'], 48.0, 37.8, 'russia_ukraine'],
  [['luhansk'], 48.57, 39.33, 'russia_ukraine'],
  [['zaporizhzhia'], 47.84, 35.14, 'russia_ukraine'],
  [['kherson'], 46.64, 32.61, 'russia_ukraine'],
  [['crimea', 'sevastopol'], 44.95, 34.1, 'russia_ukraine'],
  [['black sea'], 43.4, 34.0, 'russia_ukraine'],
  [['ukraine', 'ukrainian', 'zelensky', 'zelenskyy'], 49.0, 31.4, 'russia_ukraine'],
  [['moscow', 'kremlin'], 55.76, 37.62, 'russia_ukraine'],
  [['kursk'], 51.73, 36.19, 'russia_ukraine'],
  [['belgorod'], 50.6, 36.59, 'russia_ukraine'],
  [['russia', 'russian', 'putin'], 55.75, 37.6, 'russia_ukraine'],
  [['belarus', 'belarusian', 'minsk', 'lukashenko'], 53.9, 27.56, 'russia_ukraine'],
  [['moldova', 'transnistria'], 47.01, 28.86, 'europe'],
  [['poland', 'polish', 'warsaw'], 52.23, 21.01, 'europe'],
  [['baltic', 'lithuania', 'latvia', 'estonia'], 56.9, 24.1, 'europe'],
  [['finland', 'finnish', 'helsinki'], 60.17, 24.94, 'europe'],
  [['sweden', 'swedish', 'stockholm'], 59.33, 18.07, 'europe'],
  [['norway', 'norwegian', 'oslo'], 59.91, 10.75, 'europe'],
  [['germany', 'german', 'berlin', 'merz'], 52.52, 13.4, 'europe'],
  [['france', 'french', 'paris', 'macron'], 48.86, 2.35, 'europe'],
  [['united kingdom', 'britain', 'british', 'UK', 'london', 'starmer'], 51.51, -0.13, 'europe'],
  [['ireland', 'irish', 'dublin'], 53.35, -6.26, 'europe'],
  [['spain', 'spanish', 'madrid'], 40.42, -3.7, 'europe'],
  [['portugal', 'lisbon'], 38.72, -9.14, 'europe'],
  [['italy', 'italian', 'rome', 'meloni'], 41.9, 12.5, 'europe'],
  [['greece', 'greek', 'athens'], 37.98, 23.73, 'europe'],
  [['netherlands', 'dutch', 'amsterdam', 'the hague'], 52.37, 4.9, 'europe'],
  [['belgium', 'brussels', 'european union', 'EU', 'NATO'], 50.85, 4.35, 'europe'],
  [['switzerland', 'swiss', 'geneva', 'zurich'], 46.95, 7.45, 'europe'],
  [['austria', 'vienna'], 48.21, 16.37, 'europe'],
  [['hungary', 'hungarian', 'budapest', 'orban'], 47.5, 19.04, 'europe'],
  [['romania', 'romanian', 'bucharest'], 44.43, 26.1, 'europe'],
  [['serbia', 'serbian', 'belgrade', 'kosovo'], 44.79, 20.45, 'europe'],
  [['georgia tbilisi', 'tbilisi'], 41.72, 44.79, 'europe'],
  [['armenia', 'armenian', 'yerevan'], 40.18, 44.51, 'europe'],
  [['azerbaijan', 'baku', 'nagorno-karabakh'], 40.41, 49.87, 'europe'],

  // ---- Asia
  [['taiwan strait'], 24.5, 119.5, 'east_asia'],
  [['taiwan', 'taiwanese', 'taipei'], 25.03, 121.57, 'east_asia'],
  [['south china sea', 'spratly', 'scarborough shoal'], 12.0, 114.0, 'east_asia'],
  [['hong kong'], 22.32, 114.17, 'east_asia'],
  [['beijing', 'xi jinping', 'PLA'], 39.9, 116.4, 'east_asia'],
  [['shanghai'], 31.23, 121.47, 'east_asia'],
  [['china', 'chinese'], 35.0, 105.0, 'east_asia'],
  [['north korea', 'pyongyang', 'kim jong un'], 39.02, 125.75, 'east_asia'],
  [['south korea', 'seoul', 'korean'], 37.57, 126.98, 'east_asia'],
  [['japan', 'japanese', 'tokyo'], 35.68, 139.69, 'east_asia'],
  [['philippines', 'filipino', 'manila'], 14.6, 120.98, 'east_asia'],
  [['vietnam', 'vietnamese', 'hanoi'], 21.03, 105.85, 'east_asia'],
  [['thailand', 'thai', 'bangkok'], 13.76, 100.5, 'east_asia'],
  [['cambodia', 'phnom penh'], 11.56, 104.92, 'east_asia'],
  [['myanmar', 'burma', 'yangon', 'naypyidaw'], 19.76, 96.08, 'east_asia'],
  [['malaysia', 'kuala lumpur'], 3.14, 101.69, 'east_asia'],
  [['singapore'], 1.35, 103.82, 'east_asia'],
  [['indonesia', 'indonesian', 'jakarta'], -6.21, 106.85, 'east_asia'],
  [['australia', 'australian', 'sydney', 'canberra'], -35.28, 149.13, 'oceania'],
  [['new zealand', 'wellington', 'auckland'], -41.29, 174.78, 'oceania'],
  [['india', 'indian', 'new delhi', 'delhi', 'modi', 'mumbai'], 28.61, 77.21, 'south_asia'],
  [['kashmir'], 34.08, 74.8, 'south_asia'],
  [['pakistan', 'pakistani', 'islamabad', 'karachi', 'lahore'], 33.68, 73.05, 'south_asia'],
  [['afghanistan', 'afghan', 'kabul', 'taliban'], 34.53, 69.17, 'south_asia'],
  [['bangladesh', 'dhaka'], 23.81, 90.41, 'south_asia'],
  [['sri lanka', 'colombo'], 6.93, 79.86, 'south_asia'],
  [['nepal', 'kathmandu'], 27.72, 85.32, 'south_asia'],
  [['kazakhstan', 'astana'], 51.17, 71.45, 'central_asia'],

  // ---- Africa
  [['south sudan', 'juba'], 4.85, 31.58, 'africa'],
  [['sudan', 'sudanese', 'khartoum', 'darfur', 'el fasher', 'RSF'], 15.5, 32.56, 'africa'],
  [['ethiopia', 'ethiopian', 'addis ababa', 'tigray', 'amhara'], 9.03, 38.74, 'africa'],
  [['somalia', 'somali', 'mogadishu', 'al-shabaab'], 2.05, 45.32, 'africa'],
  [['kenya', 'kenyan', 'nairobi'], -1.29, 36.82, 'africa'],
  [['congo', 'DRC', 'kinshasa', 'goma', 'M23'], -1.68, 29.22, 'africa'],
  [['nigeria', 'nigerian', 'abuja', 'lagos'], 9.06, 7.49, 'africa'],
  [['sahel', 'mali', 'bamako', 'burkina faso', 'niger', 'niamey'], 14.5, 0.0, 'africa'],
  [['libya', 'libyan', 'tripoli', 'benghazi'], 32.89, 13.19, 'africa'],
  [['algeria', 'algiers'], 36.75, 3.06, 'africa'],
  [['morocco', 'rabat'], 34.02, -6.83, 'africa'],
  [['tunisia', 'tunis'], 36.81, 10.18, 'africa'],
  [['south africa', 'johannesburg', 'pretoria', 'cape town'], -25.75, 28.19, 'africa'],
  [['mozambique', 'maputo', 'cabo delgado'], -25.97, 32.57, 'africa'],
  [['zimbabwe', 'harare'], -17.83, 31.05, 'africa'],
  [['ghana', 'accra'], 5.6, -0.19, 'africa'],
  [['chad', "n'djamena"], 12.13, 15.06, 'africa'],

  // ---- Americas
  [['gulf of mexico', 'gulf of america'], 25.5, -90.0, 'gulf_of_mexico'],
  [['houston'], 29.76, -95.37, 'gulf_of_mexico'],
  [['new orleans', 'louisiana'], 29.95, -90.07, 'gulf_of_mexico'],
  [['texas'], 31.0, -99.0, 'americas'],
  [['florida', 'miami', 'tampa'], 27.66, -81.52, 'americas'],
  [['california', 'los angeles', 'san francisco'], 36.78, -119.42, 'americas'],
  [['washington', 'white house', 'pentagon', 'congress', 'trump', 'biden', 'senate'], 38.9, -77.04, 'americas'],
  [['new york', 'wall street'], 40.71, -74.0, 'americas'],
  [['united states', 'u.s.', 'US', 'american'], 39.8, -98.6, 'americas'],
  [['canada', 'canadian', 'ottawa', 'toronto', 'carney'], 45.42, -75.7, 'americas'],
  [['mexico', 'mexican', 'mexico city', 'sinaloa', 'cartel'], 19.43, -99.13, 'americas'],
  [['cuba', 'cuban', 'havana'], 23.11, -82.37, 'americas'],
  [['haiti', 'haitian', 'port-au-prince'], 18.59, -72.31, 'americas'],
  [['venezuela', 'venezuelan', 'caracas', 'maduro'], 10.48, -66.9, 'americas'],
  [['colombia', 'colombian', 'bogota'], 4.71, -74.07, 'americas'],
  [['ecuador', 'quito'], -0.18, -78.47, 'americas'],
  [['peru', 'peruvian', 'lima'], -12.05, -77.04, 'americas'],
  [['chile', 'chilean', 'santiago'], -33.45, -70.67, 'americas'],
  [['argentina', 'argentine', 'buenos aires', 'milei'], -34.6, -58.38, 'americas'],
  [['brazil', 'brazilian', 'brasilia', 'sao paulo', 'lula'], -15.79, -47.88, 'americas'],
  [['panama', 'panama canal'], 9.08, -79.68, 'americas'],
  [['greenland', 'nuuk'], 64.18, -51.72, 'americas'],
];

// Build matcher list once: longest names first so "south sudan" beats "sudan".
const MATCHERS = [];
PLACES.forEach(([names, lat, lon, region], idx) => {
  for (const n of names) {
    const esc = n.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // ALL-CAPS names (US, UK, IDF…) only match in capitals, so the word "us" is not the United States
    const exact = /[A-Z]/.test(n) && n === n.toUpperCase();
    MATCHERS.push({ idx, name: n.trim(), re: new RegExp(`(^|[^a-zA-Z])${esc}([^a-zA-Z]|$)`, exact ? '' : 'i'), lat, lon, region });
  }
});
MATCHERS.sort((a, b) => b.name.length - a.name.length);

function locate(text) {
  if (!text) return null;
  // PLACES lists cities and hot spots before their countries, so the earliest entry
  // that matches is the most specific place ("Russian drones hit Kyiv" -> Kyiv).
  let best = null;
  for (const m of MATCHERS) if ((!best || m.idx < best.idx) && m.re.test(text)) best = m;
  return best && { place: best.name, lat: best.lat, lon: best.lon, region: best.region };
}

module.exports = { locate };
