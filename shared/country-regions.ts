// Static country → world-region slug map.
// Mirrors WORLD_REGIONS in server/routes/regions-recommendations-routes.ts so
// the client can deep-link into /regions/{regionSlug}/{countrySlug} without an
// extra API round trip. When a country exists in multiple regions
// (e.g. Turkey, Cyprus, Armenia), we pick its primary regional grouping.

export const COUNTRY_TO_REGION_SLUG: Record<string, string> = {
  // Africa
  Algeria: "africa", Angola: "africa", Benin: "africa", Botswana: "africa",
  "Burkina Faso": "africa", Burundi: "africa", Cameroon: "africa",
  "Cape Verde": "africa", "Central African Republic": "africa", Chad: "africa",
  Comoros: "africa", Congo: "africa", "DR Congo": "africa", Djibouti: "africa",
  Egypt: "africa", "Equatorial Guinea": "africa", Eritrea: "africa",
  Ethiopia: "africa", Gabon: "africa", Gambia: "africa", Ghana: "africa",
  Guinea: "africa", "Guinea-Bissau": "africa", "Ivory Coast": "africa",
  Kenya: "africa", Lesotho: "africa", Liberia: "africa", Libya: "africa",
  Madagascar: "africa", Malawi: "africa", Mali: "africa", Mauritania: "africa",
  Mauritius: "africa", Morocco: "africa", Mozambique: "africa",
  Namibia: "africa", Niger: "africa", Nigeria: "africa", Rwanda: "africa",
  "Sao Tome and Principe": "africa", Senegal: "africa", Seychelles: "africa",
  "Sierra Leone": "africa", Somalia: "africa", "South Africa": "africa",
  "South Sudan": "africa", Sudan: "africa", Swaziland: "africa",
  Tanzania: "africa", Togo: "africa", Tunisia: "africa", Uganda: "africa",
  Zambia: "africa", Zimbabwe: "africa",

  // Asia
  Afghanistan: "asia", Armenia: "asia", Azerbaijan: "asia", Bahrain: "asia",
  Bangladesh: "asia", Bhutan: "asia", Brunei: "asia", Cambodia: "asia",
  China: "asia", Cyprus: "asia", Georgia: "asia", India: "asia",
  Indonesia: "asia", Iran: "asia", Iraq: "asia", Israel: "asia",
  Japan: "asia", Jordan: "asia", Kazakhstan: "asia", Kuwait: "asia",
  Kyrgyzstan: "asia", Laos: "asia", Lebanon: "asia", Malaysia: "asia",
  Maldives: "asia", Mongolia: "asia", Myanmar: "asia", Nepal: "asia",
  "North Korea": "asia", Oman: "asia", Pakistan: "asia", Palestine: "asia",
  Philippines: "asia", Qatar: "asia", "Saudi Arabia": "asia",
  Singapore: "asia", "South Korea": "asia", "Sri Lanka": "asia",
  Syria: "asia", Taiwan: "asia", Tajikistan: "asia", Thailand: "asia",
  "Timor-Leste": "asia", Turkey: "asia", Turkmenistan: "asia",
  "United Arab Emirates": "asia", Uzbekistan: "asia", Vietnam: "asia",
  Yemen: "asia",

  // Europe
  Albania: "europe", Andorra: "europe", Austria: "europe", Belarus: "europe",
  Belgium: "europe", "Bosnia and Herzegovina": "europe", Bulgaria: "europe",
  Croatia: "europe", "Czech Republic": "europe", Denmark: "europe",
  Estonia: "europe", Finland: "europe", France: "europe", Germany: "europe",
  Greece: "europe", Hungary: "europe", Iceland: "europe", Ireland: "europe",
  Italy: "europe", Kosovo: "europe", Latvia: "europe", Liechtenstein: "europe",
  Lithuania: "europe", Luxembourg: "europe", Malta: "europe", Moldova: "europe",
  Monaco: "europe", Montenegro: "europe", Netherlands: "europe",
  "North Macedonia": "europe", Norway: "europe", Poland: "europe",
  Portugal: "europe", Romania: "europe", Russia: "europe", "San Marino": "europe",
  Serbia: "europe", Slovakia: "europe", Slovenia: "europe", Spain: "europe",
  Sweden: "europe", Switzerland: "europe", Ukraine: "europe",
  "United Kingdom": "europe", "Vatican City": "europe",

  // North America
  "Antigua and Barbuda": "north-america", Bahamas: "north-america",
  Barbados: "north-america", Belize: "north-america", Canada: "north-america",
  "Costa Rica": "north-america", Cuba: "north-america", Dominica: "north-america",
  "Dominican Republic": "north-america", "El Salvador": "north-america",
  Grenada: "north-america", Guatemala: "north-america", Haiti: "north-america",
  Honduras: "north-america", Jamaica: "north-america", Mexico: "north-america",
  Nicaragua: "north-america", Panama: "north-america",
  "Saint Kitts and Nevis": "north-america", "Saint Lucia": "north-america",
  "Saint Vincent and the Grenadines": "north-america",
  "Trinidad and Tobago": "north-america", "United States": "north-america",

  // South America
  Argentina: "south-america", Bolivia: "south-america", Brazil: "south-america",
  Chile: "south-america", Colombia: "south-america", Ecuador: "south-america",
  "French Guiana": "south-america", Guyana: "south-america",
  Paraguay: "south-america", Peru: "south-america", Suriname: "south-america",
  Uruguay: "south-america", Venezuela: "south-america",

  // Oceania
  Australia: "oceania", Fiji: "oceania", Kiribati: "oceania",
  "Marshall Islands": "oceania", Micronesia: "oceania", Nauru: "oceania",
  "New Zealand": "oceania", Palau: "oceania", "Papua New Guinea": "oceania",
  Samoa: "oceania", "Solomon Islands": "oceania", Tonga: "oceania",
  Tuvalu: "oceania", Vanuatu: "oceania",
};

// Common country-name aliases returned by the upstream radio feed →
// canonical names used as keys in COUNTRY_TO_REGION_SLUG.
export const COUNTRY_NAME_ALIASES: Record<string, string> = {
  "The United States Of America": "United States",
  "The Russian Federation": "Russia",
  Czechia: "Czech Republic",
  "Türkiye": "Turkey",
  "People's Republic of China": "China",
  "Taiwan, Republic Of China": "Taiwan",
  "The Philippines": "Philippines",
  "Great Britain": "United Kingdom",
  "Vatican City State": "Vatican City",
  Vatican: "Vatican City",
};

export function canonicalizeCountry(name: string): string {
  return COUNTRY_NAME_ALIASES[name] || name;
}

export function getRegionSlugForCountry(name: string): string | undefined {
  return COUNTRY_TO_REGION_SLUG[canonicalizeCountry(name)];
}

export function countrySlug(name: string): string {
  return canonicalizeCountry(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
