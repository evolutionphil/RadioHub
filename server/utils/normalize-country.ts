const ISO_TO_DB: Record<string, string> = {
  'AF': 'Afghanistan', 'AL': 'Albania', 'DZ': 'Algeria', 'AS': 'American Samoa',
  'AD': 'Andorra', 'AO': 'Angola', 'AI': 'Anguilla', 'AQ': 'Antarctica',
  'AG': 'Antigua And Barbuda', 'AR': 'Argentina', 'AM': 'Armenia', 'AW': 'Aruba',
  'AU': 'Australia', 'AT': 'Austria', 'AZ': 'Azerbaijan',
  'BS': 'The Bahamas', 'BH': 'Bahrain', 'BD': 'Bangladesh', 'BB': 'Barbados',
  'BY': 'Belarus', 'BE': 'Belgium', 'BZ': 'Belize', 'BJ': 'Benin', 'BM': 'Bermuda',
  'BT': 'Bhutan', 'BO': 'Bolivia', 'BA': 'Bosnia And Herzegovina',
  'BW': 'Botswana', 'BR': 'Brazil', 'BN': 'Brunei Darussalam', 'BG': 'Bulgaria',
  'BF': 'Burkina Faso', 'BI': 'Burundi',
  'KH': 'Cambodia', 'CM': 'Cameroon', 'CA': 'Canada', 'CV': 'Cabo Verde',
  'KY': 'The Cayman Islands', 'CF': 'The Central African Republic', 'TD': 'Chad',
  'CL': 'Chile', 'CN': 'China', 'CO': 'Colombia', 'KM': 'The Comoros',
  'CG': 'The Congo', 'CD': 'The Democratic Republic Of The Congo',
  'CK': 'The Cook Islands', 'CR': 'Costa Rica', 'CI': 'Coted Ivoire',
  'HR': 'Croatia', 'CU': 'Cuba', 'CW': 'Curacao', 'CY': 'Cyprus', 'CZ': 'Czechia',
  'DK': 'Denmark', 'DJ': 'Djibouti', 'DM': 'Dominica', 'DO': 'The Dominican Republic',
  'EC': 'Ecuador', 'EG': 'Egypt', 'SV': 'El Salvador', 'GQ': 'Equatorial Guinea',
  'ER': 'Eritrea', 'EE': 'Estonia', 'ET': 'Ethiopia',
  'FK': 'The Falkland Islands Malvinas', 'FO': 'The Faroe Islands', 'FJ': 'Fiji',
  'FI': 'Finland', 'FR': 'France', 'GF': 'French Guiana', 'PF': 'French Polynesia',
  'TF': 'The French Southern Territories',
  'GA': 'Gabon', 'GM': 'Gambia', 'GE': 'Georgia', 'DE': 'Germany', 'GH': 'Ghana',
  'GI': 'Gibraltar', 'GR': 'Greece', 'GL': 'Greenland', 'GD': 'Grenada',
  'GP': 'Guadeloupe', 'GU': 'Guam', 'GT': 'Guatemala', 'GG': 'Guernsey',
  'GN': 'Guinea', 'GW': 'Guinea Bissau', 'GY': 'Guyana',
  'HT': 'Haiti', 'VA': 'The Holy See', 'HN': 'Honduras', 'HK': 'Hong Kong',
  'HU': 'Hungary',
  'IS': 'Iceland', 'IN': 'India', 'ID': 'Indonesia', 'IR': 'Islamic Republic Of Iran',
  'IQ': 'Iraq', 'IE': 'Ireland', 'IM': 'Isle Of Man', 'IL': 'Israel', 'IT': 'Italy',
  'JM': 'Jamaica', 'JP': 'Japan', 'JE': 'Jersey', 'JO': 'Jordan',
  'KZ': 'Kazakhstan', 'KE': 'Kenya', 'KI': 'Kiribati',
  'KP': 'The Democratic Peoples Republic Of Korea', 'KR': 'The Republic Of Korea',
  'KW': 'Kuwait', 'KG': 'Kyrgyzstan',
  'LA': 'The Lao Peoples Democratic Republic', 'LV': 'Latvia', 'LB': 'Lebanon',
  'LS': 'Lesotho', 'LR': 'Liberia', 'LY': 'Libya', 'LI': 'Liechtenstein',
  'LT': 'Lithuania', 'LU': 'Luxembourg',
  'MO': 'Macao', 'MK': 'Republic Of North Macedonia', 'MG': 'Madagascar',
  'MW': 'Malawi', 'MY': 'Malaysia', 'MV': 'Maldives', 'ML': 'Mali', 'MT': 'Malta',
  'MH': 'Marshall Islands', 'MQ': 'Martinique', 'MR': 'Mauritania', 'MU': 'Mauritius',
  'YT': 'Mayotte', 'MX': 'Mexico', 'FM': 'Micronesia', 'MD': 'The Republic Of Moldova',
  'MC': 'Monaco', 'MN': 'Mongolia', 'ME': 'Montenegro', 'MS': 'Montserrat',
  'MA': 'Morocco', 'MZ': 'Mozambique', 'MM': 'Myanmar',
  'NA': 'Namibia', 'NR': 'Nauru', 'NP': 'Nepal', 'NL': 'The Netherlands',
  'NC': 'New Caledonia', 'NZ': 'New Zealand', 'NI': 'Nicaragua', 'NE': 'The Niger',
  'NG': 'Nigeria', 'NU': 'Niue', 'NF': 'Norfolk Island', 'NO': 'Norway',
  'OM': 'Oman',
  'PK': 'Pakistan', 'PW': 'Palau', 'PS': 'State Of Palestine', 'PA': 'Panama',
  'PG': 'Papua New Guinea', 'PY': 'Paraguay', 'PE': 'Peru', 'PH': 'The Philippines',
  'PL': 'Poland', 'PT': 'Portugal', 'PR': 'Puerto Rico',
  'QA': 'Qatar',
  'RE': 'Reunion', 'RO': 'Romania', 'RU': 'The Russian Federation', 'RW': 'Rwanda',
  'SH': 'Ascension And Tristan Da Cunha Saint Helena',
  'KN': 'Saint Kitts And Nevis', 'LC': 'Saint Lucia',
  'PM': 'Saint Pierre And Miquelon', 'VC': 'Saint Vincent And The Grenadines',
  'WS': 'Samoa', 'SM': 'San Marino', 'ST': 'Sao Tome And Principe',
  'SA': 'Saudi Arabia', 'SN': 'Senegal', 'RS': 'Serbia', 'SC': 'Seychelles',
  'SL': 'Sierra Leone', 'SG': 'Singapore', 'SK': 'Slovakia', 'SI': 'Slovenia',
  'SB': 'Solomon Islands', 'SO': 'Somalia', 'ZA': 'South Africa', 'SS': 'South Sudan',
  'ES': 'Spain', 'LK': 'Sri Lanka', 'SD': 'The Sudan', 'SR': 'Suriname',
  'SE': 'Sweden', 'CH': 'Switzerland', 'SY': 'Syrian Arab Republic',
  'TW': 'Taiwan, Republic Of China', 'TJ': 'Tajikistan',
  'TZ': 'United Republic Of Tanzania', 'TH': 'Thailand', 'TL': 'Timor Leste',
  'TG': 'Togo', 'TK': 'Tokelau', 'TO': 'Tonga', 'TT': 'Trinidad And Tobago',
  'TN': 'Tunisia', 'TR': 'Türkiye', 'TM': 'Turkmenistan', 'TC': 'Turks And Caicos',
  'TV': 'Tuvalu',
  'UG': 'Uganda', 'UA': 'Ukraine', 'AE': 'The United Arab Emirates',
  'GB': 'The United Kingdom Of Great Britain And Northern Ireland',
  'US': 'The United States Of America',
  'UM': 'The United States Minor Outlying Islands', 'UY': 'Uruguay', 'UZ': 'Uzbekistan',
  'VU': 'Vanuatu', 'VE': 'Bolivarian Republic Of Venezuela', 'VN': 'Vietnam',
  'VG': 'British Virgin Islands', 'VI': 'US Virgin Islands',
  'WF': 'Wallis And Futuna', 'YE': 'Yemen', 'ZM': 'Zambia', 'ZW': 'Zimbabwe',
  'XK': 'Kosovo', 'BQ': 'Bonaire', 'AX': 'Aland Islands',
};

const ALIAS_TO_DB: Record<string, string> = {
  'turkey': 'Türkiye',
  'turkei': 'Türkiye',
  'türkei': 'Türkiye',
  'turquie': 'Türkiye',
  'turquía': 'Türkiye',
  'turchia': 'Türkiye',
  'türkiye': 'Türkiye',

  'russia': 'The Russian Federation',
  'russland': 'The Russian Federation',
  'russie': 'The Russian Federation',
  'rusia': 'The Russian Federation',
  'russian federation': 'The Russian Federation',

  'united states': 'The United States Of America',
  'usa': 'The United States Of America',
  'united states of america': 'The United States Of America',
  'vereinigte staaten': 'The United States Of America',
  'états-unis': 'The United States Of America',
  'estados unidos': 'The United States Of America',
  'stati uniti': 'The United States Of America',

  'united kingdom': 'The United Kingdom Of Great Britain And Northern Ireland',
  'uk': 'The United Kingdom Of Great Britain And Northern Ireland',
  'great britain': 'The United Kingdom Of Great Britain And Northern Ireland',
  'england': 'The United Kingdom Of Great Britain And Northern Ireland',
  'vereinigtes königreich': 'The United Kingdom Of Great Britain And Northern Ireland',
  'royaume-uni': 'The United Kingdom Of Great Britain And Northern Ireland',
  'reino unido': 'The United Kingdom Of Great Britain And Northern Ireland',
  'gran bretagna': 'The United Kingdom Of Great Britain And Northern Ireland',

  'netherlands': 'The Netherlands',
  'holland': 'The Netherlands',
  'niederlande': 'The Netherlands',
  'pays-bas': 'The Netherlands',
  'países bajos': 'The Netherlands',
  'paesi bassi': 'The Netherlands',

  'czech republic': 'Czechia',
  'czech': 'Czechia',
  'tschechien': 'Czechia',
  'république tchèque': 'Czechia',
  'república checa': 'Czechia',

  'south korea': 'The Republic Of Korea',
  'korea': 'The Republic Of Korea',
  'republic of korea': 'The Republic Of Korea',

  'north korea': 'The Democratic Peoples Republic Of Korea',

  'iran': 'Islamic Republic Of Iran',
  'persia': 'Islamic Republic Of Iran',

  'venezuela': 'Bolivarian Republic Of Venezuela',

  'taiwan': 'Taiwan, Republic Of China',

  'uae': 'The United Arab Emirates',
  'emirates': 'The United Arab Emirates',
  'united arab emirates': 'The United Arab Emirates',

  'philippines': 'The Philippines',

  'dominican republic': 'The Dominican Republic',

  'north macedonia': 'Republic Of North Macedonia',
  'macedonia': 'Republic Of North Macedonia',

  'moldova': 'The Republic Of Moldova',

  'syria': 'Syrian Arab Republic',

  'congo': 'The Congo',
  'dr congo': 'The Democratic Republic Of The Congo',
  'drc': 'The Democratic Republic Of The Congo',

  'tanzania': 'United Republic Of Tanzania',

  'palestine': 'State Of Palestine',

  'laos': 'The Lao Peoples Democratic Republic',

  'ivory coast': 'Coted Ivoire',
  'côte d\'ivoire': 'Coted Ivoire',

  'vatican': 'The Holy See',
  'vatican city': 'The Holy See',

  'deutschland': 'Germany',
  'allemagne': 'Germany',
  'alemania': 'Germany',
  'germania': 'Germany',

  'österreich': 'Austria',
  'autriche': 'Austria',

  'schweiz': 'Switzerland',
  'suisse': 'Switzerland',
  'suiza': 'Switzerland',
  'svizzera': 'Switzerland',

  'frankreich': 'France',
  'francia': 'France',

  'spanien': 'Spain',
  'espagne': 'Spain',
  'españa': 'Spain',
  'spagna': 'Spain',

  'italien': 'Italy',
  'italie': 'Italy',
  'italia': 'Italy',

  'belgien': 'Belgium',
  'belgique': 'Belgium',
  'bélgica': 'Belgium',
  'belgio': 'Belgium',

  'polen': 'Poland',
  'pologne': 'Poland',
  'polonia': 'Poland',

  'schweden': 'Sweden',
  'suède': 'Sweden',
  'suecia': 'Sweden',

  'norwegen': 'Norway',
  'norvège': 'Norway',
  'noruega': 'Norway',

  'dänemark': 'Denmark',
  'danemark': 'Denmark',
  'dinamarca': 'Denmark',

  'finnland': 'Finland',
  'finlande': 'Finland',
  'finlandia': 'Finland',

  'griechenland': 'Greece',
  'grèce': 'Greece',
  'grecia': 'Greece',

  'ungarn': 'Hungary',
  'hongrie': 'Hungary',
  'hungría': 'Hungary',

  'rumänien': 'Romania',
  'roumanie': 'Romania',
  'rumanía': 'Romania',

  'bulgarien': 'Bulgaria',
  'bulgarie': 'Bulgaria',

  'serbien': 'Serbia',
  'serbie': 'Serbia',

  'kroatien': 'Croatia',
  'croatie': 'Croatia',
  'croacia': 'Croatia',

  'slowakei': 'Slovakia',
  'slovaquie': 'Slovakia',
  'eslovaquia': 'Slovakia',

  'slowenien': 'Slovenia',
  'slovénie': 'Slovenia',
  'eslovenia': 'Slovenia',

  'irland': 'Ireland',
  'irlande': 'Ireland',
  'irlanda': 'Ireland',

  'portugal': 'Portugal',

  'ägypten': 'Egypt',
  'égypte': 'Egypt',
  'egipto': 'Egypt',
  'egitto': 'Egypt',

  'südafrika': 'South Africa',
  'afrique du sud': 'South Africa',
  'sudáfrica': 'South Africa',

  'indien': 'India',
  'inde': 'India',

  'indonesien': 'Indonesia',
  'indonésie': 'Indonesia',

  'japan': 'Japan',
  'japon': 'Japan',
  'japón': 'Japan',
  'giappone': 'Japan',

  'china': 'China',
  'chine': 'China',

  'brasilien': 'Brazil',
  'brésil': 'Brazil',
  'brasil': 'Brazil',
  'brasile': 'Brazil',

  'mexiko': 'Mexico',
  'mexique': 'Mexico',
  'méxico': 'Mexico',
  'messico': 'Mexico',

  'argentinien': 'Argentina',
  'argentine': 'Argentina',

  'kanada': 'Canada',

  'australien': 'Australia',
  'australie': 'Australia',

  'neuseeland': 'New Zealand',
  'nouvelle-zélande': 'New Zealand',
  'nueva zelanda': 'New Zealand',

  'bosnien': 'Bosnia And Herzegovina',
  'bosnie': 'Bosnia And Herzegovina',
  'bosnia': 'Bosnia And Herzegovina',

  'ukraine': 'Ukraine',
  'ucrania': 'Ukraine',

  'saudi': 'Saudi Arabia',
  'saudi-arabien': 'Saudi Arabia',
  'arabie saoudite': 'Saudi Arabia',
  'arabia saudita': 'Saudi Arabia',

  'singapur': 'Singapore',
  'singapour': 'Singapore',

  'thailand': 'Thailand',
  'thaïlande': 'Thailand',
  'tailandia': 'Thailand',

  'vietnam': 'Vietnam',
  'viêt nam': 'Vietnam',

  'malaysia': 'Malaysia',
  'malaisie': 'Malaysia',
  'malasia': 'Malaysia',

  'kolumbien': 'Colombia',
  'colombie': 'Colombia',

  'chile': 'Chile',

  'peru': 'Peru',
  'pérou': 'Peru',
  'perú': 'Peru',
};

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeCountryFilter(input: string | undefined | null): Record<string, any> {
  if (!input || input === 'all' || input === 'null' || input === 'global') {
    return {};
  }

  const trimmed = input.trim();
  if (!trimmed) return {};

  const upper = trimmed.toUpperCase();
  if (upper.length === 2 && ISO_TO_DB[upper]) {
    const dbName = ISO_TO_DB[upper];
    return { country: { $regex: new RegExp(escapeRegex(dbName), 'i') } };
  }

  const lower = trimmed.toLowerCase();
  if (ALIAS_TO_DB[lower]) {
    const dbName = ALIAS_TO_DB[lower];
    return { country: { $regex: new RegExp(escapeRegex(dbName), 'i') } };
  }

  return { country: { $regex: new RegExp(escapeRegex(trimmed), 'i') } };
}

export function resolveToDbName(input: string | undefined | null): string | null {
  if (!input || input === 'all' || input === 'null' || input === 'global') {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) return null;

  const upper = trimmed.toUpperCase();
  if (upper.length === 2 && ISO_TO_DB[upper]) {
    return ISO_TO_DB[upper];
  }

  const lower = trimmed.toLowerCase();
  if (ALIAS_TO_DB[lower]) {
    return ALIAS_TO_DB[lower];
  }

  return trimmed;
}

export function getCountryRegex(input: string | undefined | null): RegExp | null {
  const filter = normalizeCountryFilter(input);
  if (filter.country?.$regex) {
    return filter.country.$regex as RegExp;
  }
  return null;
}

const DB_TO_ISO: Record<string, string> = {};
for (const [code, dbName] of Object.entries(ISO_TO_DB)) {
  DB_TO_ISO[dbName.toLowerCase()] = code;
}

const NATIVE_NAMES: Record<string, string> = {
  'AF': 'افغانستان', 'AL': 'Shqipëria', 'DZ': 'الجزائر', 'AD': 'Andorra',
  'AO': 'Angola', 'AR': 'Argentina', 'AM': 'Հայաստան', 'AU': 'Australia',
  'AT': 'Österreich', 'AZ': 'Azərbaycan',
  'BH': 'البحرين', 'BD': 'বাংলাদেশ', 'BY': 'Беларусь', 'BE': 'België',
  'BA': 'Bosna i Hercegovina', 'BR': 'Brasil', 'BG': 'България',
  'KH': 'កម្ពុជា', 'CA': 'Canada', 'CL': 'Chile', 'CN': '中国', 'CO': 'Colombia',
  'HR': 'Hrvatska', 'CU': 'Cuba', 'CY': 'Κύπρος', 'CZ': 'Česko',
  'DK': 'Danmark', 'DO': 'República Dominicana',
  'EC': 'Ecuador', 'EG': 'مصر', 'SV': 'El Salvador', 'EE': 'Eesti', 'ET': 'ኢትዮጵያ',
  'FI': 'Suomi', 'FR': 'France',
  'GE': 'საქართველო', 'DE': 'Deutschland', 'GH': 'Ghana', 'GR': 'Ελλάδα',
  'GT': 'Guatemala', 'HT': 'Haïti', 'HN': 'Honduras', 'HK': '香港', 'HU': 'Magyarország',
  'IS': 'Ísland', 'IN': 'भारत', 'ID': 'Indonesia', 'IR': 'ایران', 'IQ': 'العراق',
  'IE': 'Éire', 'IL': 'ישראל', 'IT': 'Italia',
  'JM': 'Jamaica', 'JP': '日本', 'JO': 'الأردن',
  'KZ': 'Қазақстан', 'KE': 'Kenya', 'KP': '조선', 'KR': '대한민국', 'KW': 'الكويت', 'KG': 'Кыргызстан',
  'LV': 'Latvija', 'LB': 'لبنان', 'LY': 'ليبيا', 'LT': 'Lietuva', 'LU': 'Luxembourg',
  'MO': '澳門', 'MK': 'Северна Македонија', 'MY': 'Malaysia', 'MT': 'Malta',
  'MX': 'México', 'MD': 'Moldova', 'MC': 'Monaco', 'MN': 'Монгол', 'ME': 'Crna Gora',
  'MA': 'المغرب', 'MZ': 'Moçambique', 'MM': 'မြန်မာ',
  'NA': 'Namibia', 'NP': 'नेपाल', 'NL': 'Nederland', 'NZ': 'New Zealand',
  'NI': 'Nicaragua', 'NG': 'Nigeria', 'NO': 'Norge',
  'OM': 'عُمان', 'PK': 'پاکستان', 'PS': 'فلسطين', 'PA': 'Panamá',
  'PY': 'Paraguay', 'PE': 'Perú', 'PH': 'Pilipinas', 'PL': 'Polska', 'PT': 'Portugal',
  'PR': 'Puerto Rico', 'QA': 'قطر',
  'RO': 'România', 'RU': 'Россия', 'RW': 'Rwanda',
  'SA': 'المملكة العربية السعودية', 'SN': 'Sénégal', 'RS': 'Србија',
  'SG': 'Singapore', 'SK': 'Slovensko', 'SI': 'Slovenija', 'SO': 'Soomaaliya',
  'ZA': 'South Africa', 'ES': 'España', 'LK': 'ශ්‍රී ලංකාව',
  'SD': 'السودان', 'SE': 'Sverige', 'CH': 'Schweiz', 'SY': 'سوريا',
  'TW': '臺灣', 'TJ': 'Тоҷикистон', 'TZ': 'Tanzania', 'TH': 'ประเทศไทย',
  'TN': 'تونس', 'TR': 'Türkiye', 'TM': 'Türkmenistan',
  'UG': 'Uganda', 'UA': 'Україна', 'AE': 'الإمارات العربية المتحدة',
  'GB': 'United Kingdom', 'US': 'United States', 'UY': 'Uruguay', 'UZ': 'Oʻzbekiston',
  'VE': 'Venezuela', 'VN': 'Việt Nam', 'YE': 'اليمن', 'ZM': 'Zambia', 'ZW': 'Zimbabwe',
  'XK': 'Kosova',
};

const ENGLISH_NAMES: Record<string, string> = {
  'AF': 'Afghanistan', 'AL': 'Albania', 'DZ': 'Algeria', 'AS': 'American Samoa',
  'AD': 'Andorra', 'AO': 'Angola', 'AI': 'Anguilla', 'AQ': 'Antarctica',
  'AG': 'Antigua and Barbuda', 'AR': 'Argentina', 'AM': 'Armenia', 'AW': 'Aruba',
  'AU': 'Australia', 'AT': 'Austria', 'AZ': 'Azerbaijan',
  'BS': 'Bahamas', 'BH': 'Bahrain', 'BD': 'Bangladesh', 'BB': 'Barbados',
  'BY': 'Belarus', 'BE': 'Belgium', 'BZ': 'Belize', 'BJ': 'Benin', 'BM': 'Bermuda',
  'BT': 'Bhutan', 'BO': 'Bolivia', 'BA': 'Bosnia and Herzegovina', 'BQ': 'Bonaire',
  'BW': 'Botswana', 'BR': 'Brazil', 'BN': 'Brunei', 'BG': 'Bulgaria',
  'BF': 'Burkina Faso', 'BI': 'Burundi',
  'KH': 'Cambodia', 'CM': 'Cameroon', 'CA': 'Canada', 'CV': 'Cape Verde',
  'KY': 'Cayman Islands', 'CF': 'Central African Republic', 'TD': 'Chad',
  'CL': 'Chile', 'CN': 'China', 'CO': 'Colombia', 'KM': 'Comoros',
  'CG': 'Congo', 'CD': 'DR Congo', 'CK': 'Cook Islands', 'CR': 'Costa Rica',
  'CI': 'Ivory Coast', 'HR': 'Croatia', 'CU': 'Cuba', 'CW': 'Curaçao',
  'CY': 'Cyprus', 'CZ': 'Czech Republic',
  'DK': 'Denmark', 'DJ': 'Djibouti', 'DM': 'Dominica', 'DO': 'Dominican Republic',
  'EC': 'Ecuador', 'EG': 'Egypt', 'SV': 'El Salvador', 'GQ': 'Equatorial Guinea',
  'ER': 'Eritrea', 'EE': 'Estonia', 'ET': 'Ethiopia',
  'FK': 'Falkland Islands', 'FO': 'Faroe Islands', 'FJ': 'Fiji',
  'FI': 'Finland', 'FR': 'France', 'GF': 'French Guiana', 'PF': 'French Polynesia',
  'TF': 'French Southern Territories',
  'GA': 'Gabon', 'GM': 'Gambia', 'GE': 'Georgia', 'DE': 'Germany', 'GH': 'Ghana',
  'GI': 'Gibraltar', 'GR': 'Greece', 'GL': 'Greenland', 'GD': 'Grenada',
  'GP': 'Guadeloupe', 'GU': 'Guam', 'GT': 'Guatemala', 'GG': 'Guernsey',
  'GN': 'Guinea', 'GW': 'Guinea-Bissau', 'GY': 'Guyana',
  'HT': 'Haiti', 'VA': 'Vatican City', 'HN': 'Honduras', 'HK': 'Hong Kong',
  'HU': 'Hungary',
  'IS': 'Iceland', 'IN': 'India', 'ID': 'Indonesia', 'IR': 'Iran',
  'IQ': 'Iraq', 'IE': 'Ireland', 'IM': 'Isle of Man', 'IL': 'Israel', 'IT': 'Italy',
  'JM': 'Jamaica', 'JP': 'Japan', 'JE': 'Jersey', 'JO': 'Jordan',
  'KZ': 'Kazakhstan', 'KE': 'Kenya', 'KI': 'Kiribati',
  'KP': 'North Korea', 'KR': 'South Korea',
  'KW': 'Kuwait', 'KG': 'Kyrgyzstan',
  'LA': 'Laos', 'LV': 'Latvia', 'LB': 'Lebanon',
  'LS': 'Lesotho', 'LR': 'Liberia', 'LY': 'Libya', 'LI': 'Liechtenstein',
  'LT': 'Lithuania', 'LU': 'Luxembourg',
  'MO': 'Macao', 'MK': 'North Macedonia', 'MG': 'Madagascar',
  'MW': 'Malawi', 'MY': 'Malaysia', 'MV': 'Maldives', 'ML': 'Mali', 'MT': 'Malta',
  'MH': 'Marshall Islands', 'MQ': 'Martinique', 'MR': 'Mauritania', 'MU': 'Mauritius',
  'YT': 'Mayotte', 'MX': 'Mexico', 'FM': 'Micronesia', 'MD': 'Moldova',
  'MC': 'Monaco', 'MN': 'Mongolia', 'ME': 'Montenegro', 'MS': 'Montserrat',
  'MA': 'Morocco', 'MZ': 'Mozambique', 'MM': 'Myanmar',
  'NA': 'Namibia', 'NR': 'Nauru', 'NP': 'Nepal', 'NL': 'Netherlands',
  'NC': 'New Caledonia', 'NZ': 'New Zealand', 'NI': 'Nicaragua', 'NE': 'Niger',
  'NG': 'Nigeria', 'NU': 'Niue', 'NF': 'Norfolk Island', 'NO': 'Norway',
  'OM': 'Oman',
  'PK': 'Pakistan', 'PW': 'Palau', 'PS': 'Palestine', 'PA': 'Panama',
  'PG': 'Papua New Guinea', 'PY': 'Paraguay', 'PE': 'Peru', 'PH': 'Philippines',
  'PL': 'Poland', 'PT': 'Portugal', 'PR': 'Puerto Rico',
  'QA': 'Qatar',
  'RE': 'Réunion', 'RO': 'Romania', 'RU': 'Russia', 'RW': 'Rwanda',
  'SH': 'Saint Helena', 'KN': 'Saint Kitts and Nevis', 'LC': 'Saint Lucia',
  'PM': 'Saint Pierre and Miquelon', 'VC': 'Saint Vincent and the Grenadines',
  'WS': 'Samoa', 'SM': 'San Marino', 'ST': 'São Tomé and Príncipe',
  'SA': 'Saudi Arabia', 'SN': 'Senegal', 'RS': 'Serbia', 'SC': 'Seychelles',
  'SL': 'Sierra Leone', 'SG': 'Singapore', 'SK': 'Slovakia', 'SI': 'Slovenia',
  'SB': 'Solomon Islands', 'SO': 'Somalia', 'ZA': 'South Africa', 'SS': 'South Sudan',
  'ES': 'Spain', 'LK': 'Sri Lanka', 'SD': 'Sudan', 'SR': 'Suriname',
  'SE': 'Sweden', 'CH': 'Switzerland', 'SY': 'Syria',
  'TW': 'Taiwan', 'TJ': 'Tajikistan', 'TZ': 'Tanzania', 'TH': 'Thailand',
  'TL': 'Timor-Leste', 'TG': 'Togo', 'TK': 'Tokelau', 'TO': 'Tonga',
  'TT': 'Trinidad and Tobago', 'TN': 'Tunisia', 'TR': 'Turkey', 'TM': 'Turkmenistan',
  'TC': 'Turks and Caicos', 'TV': 'Tuvalu',
  'UG': 'Uganda', 'UA': 'Ukraine', 'AE': 'United Arab Emirates',
  'GB': 'United Kingdom', 'US': 'United States',
  'UM': 'US Minor Outlying Islands', 'UY': 'Uruguay', 'UZ': 'Uzbekistan',
  'VU': 'Vanuatu', 'VE': 'Venezuela', 'VN': 'Vietnam',
  'VG': 'British Virgin Islands', 'VI': 'US Virgin Islands',
  'WF': 'Wallis and Futuna', 'YE': 'Yemen', 'ZM': 'Zambia', 'ZW': 'Zimbabwe',
  'XK': 'Kosovo', 'BQ': 'Bonaire', 'AX': 'Åland Islands',
  'IO': 'British Indian Ocean Territory',
};

function isoToFlag(code: string): string {
  return String.fromCodePoint(
    ...code.toUpperCase().split('').map(c => 127397 + c.charCodeAt(0))
  );
}

export function dbNameToIso(dbName: string): string | null {
  if (!dbName) return null;
  const lower = dbName.toLowerCase().trim();
  if (DB_TO_ISO[lower]) return DB_TO_ISO[lower];
  const stripped = lower.replace(/^the\s+/i, '');
  if (DB_TO_ISO[stripped]) return DB_TO_ISO[stripped];
  for (const [isoLower, code] of Object.entries(DB_TO_ISO)) {
    const isoStripped = isoLower.replace(/^the\s+/i, '');
    if (stripped === isoStripped) return code;
  }
  return null;
}

export interface CountryInfo {
  name: string;
  nativeName: string;
  code: string;
  flag: string;
  flagUrl: string;
  stationCount?: number;
}

export function getCountryInfo(dbName: string, stationCount?: number): CountryInfo | null {
  const code = dbNameToIso(dbName);
  if (!code) return null;
  const englishName = ENGLISH_NAMES[code] || dbName;
  const nativeName = NATIVE_NAMES[code] || englishName;
  return {
    name: englishName,
    nativeName,
    code,
    flag: isoToFlag(code),
    flagUrl: `https://flagcdn.com/w40/${code.toLowerCase()}.png`,
    ...(stationCount !== undefined ? { stationCount } : {}),
  };
}

export function getAllCountryInfoFromDb(countries: Array<{ name: string; count: number }>): CountryInfo[] {
  const results: CountryInfo[] = [];
  for (const { name, count } of countries) {
    const info = getCountryInfo(name, count);
    if (info) results.push(info);
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}
