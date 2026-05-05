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
  'turkiye': 'Türkiye',

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
  'almanya': 'Germany',

  'österreich': 'Austria',
  'autriche': 'Austria',
  'avusturya': 'Austria',

  'schweiz': 'Switzerland',
  'suisse': 'Switzerland',
  'suiza': 'Switzerland',
  'svizzera': 'Switzerland',
  'isviçre': 'Switzerland',
  'isvicre': 'Switzerland',

  'frankreich': 'France',
  'francia': 'France',
  'fransa': 'France',

  'spanien': 'Spain',
  'espagne': 'Spain',
  'españa': 'Spain',
  'spagna': 'Spain',
  'ispanya': 'Spain',

  'italien': 'Italy',
  'italie': 'Italy',
  'italia': 'Italy',
  'italya': 'Italy',

  'belgien': 'Belgium',
  'belgique': 'Belgium',
  'bélgica': 'Belgium',
  'belgio': 'Belgium',
  'belçika': 'Belgium',

  'polen': 'Poland',
  'pologne': 'Poland',
  'polonia': 'Poland',
  'polonya': 'Poland',

  'schweden': 'Sweden',
  'suède': 'Sweden',
  'suecia': 'Sweden',
  'isveç': 'Sweden',
  'isvec': 'Sweden',

  'norwegen': 'Norway',
  'norvège': 'Norway',
  'noruega': 'Norway',
  'norveç': 'Norway',
  'norvec': 'Norway',

  'dänemark': 'Denmark',
  'danemark': 'Denmark',
  'dinamarca': 'Denmark',
  'danimarka': 'Denmark',

  'finnland': 'Finland',
  'finlande': 'Finland',
  'finlandia': 'Finland',
  'finlandiya': 'Finland',

  'griechenland': 'Greece',
  'grèce': 'Greece',
  'grecia': 'Greece',
  'yunanistan': 'Greece',

  'ungarn': 'Hungary',
  'hongrie': 'Hungary',
  'hungría': 'Hungary',
  'macaristan': 'Hungary',

  'rumänien': 'Romania',
  'roumanie': 'Romania',
  'rumanía': 'Romania',
  'romanya': 'Romania',

  'bulgarien': 'Bulgaria',
  'bulgarie': 'Bulgaria',
  'bulgaristan': 'Bulgaria',

  'serbien': 'Serbia',
  'serbie': 'Serbia',
  'sırbistan': 'Serbia',
  'sirbistan': 'Serbia',

  'kroatien': 'Croatia',
  'croatie': 'Croatia',
  'croacia': 'Croatia',
  'hırvatistan': 'Croatia',
  'hirvatistan': 'Croatia',

  'slowakei': 'Slovakia',
  'slovaquie': 'Slovakia',
  'eslovaquia': 'Slovakia',
  'slovakya': 'Slovakia',

  'slowenien': 'Slovenia',
  'slovénie': 'Slovenia',
  'eslovenia': 'Slovenia',
  'slovenya': 'Slovenia',

  'irland': 'Ireland',
  'irlande': 'Ireland',
  'irlanda': 'Ireland',

  'portugal': 'Portugal',
  'portekiz': 'Portugal',

  'ägypten': 'Egypt',
  'égypte': 'Egypt',
  'egipto': 'Egypt',
  'egitto': 'Egypt',
  'mısır': 'Egypt',
  'misir': 'Egypt',

  'südafrika': 'South Africa',
  'afrique du sud': 'South Africa',
  'sudáfrica': 'South Africa',
  'güney afrika': 'South Africa',
  'guney afrika': 'South Africa',

  'indien': 'India',
  'inde': 'India',
  'hindistan': 'India',

  'indonesien': 'Indonesia',
  'indonésie': 'Indonesia',
  'endonezya': 'Indonesia',

  'japan': 'Japan',
  'japon': 'Japan',
  'japón': 'Japan',
  'giappone': 'Japan',
  'japonya': 'Japan',

  'china': 'China',
  'chine': 'China',
  'çin': 'China',
  'cin': 'China',

  'brasilien': 'Brazil',
  'brésil': 'Brazil',
  'brasil': 'Brazil',
  'brasile': 'Brazil',
  'brezilya': 'Brazil',

  'mexiko': 'Mexico',
  'mexique': 'Mexico',
  'méxico': 'Mexico',
  'messico': 'Mexico',
  'meksika': 'Mexico',

  'argentinien': 'Argentina',
  'argentine': 'Argentina',
  'arjantin': 'Argentina',

  'kanada': 'Canada',

  'australien': 'Australia',
  'australie': 'Australia',
  'avustralya': 'Australia',

  'neuseeland': 'New Zealand',
  'nouvelle-zélande': 'New Zealand',
  'nueva zelanda': 'New Zealand',
  'yeni zelanda': 'New Zealand',

  'bosnien': 'Bosnia And Herzegovina',
  'bosnie': 'Bosnia And Herzegovina',
  'bosnia': 'Bosnia And Herzegovina',
  'bosna hersek': 'Bosnia And Herzegovina',

  'ukraine': 'Ukraine',
  'ucrania': 'Ukraine',
  'ukrayna': 'Ukraine',

  'saudi': 'Saudi Arabia',
  'saudi-arabien': 'Saudi Arabia',
  'arabie saoudite': 'Saudi Arabia',
  'arabia saudita': 'Saudi Arabia',
  'suudi arabistan': 'Saudi Arabia',

  'singapur': 'Singapore',
  'singapour': 'Singapore',

  'thailand': 'Thailand',
  'thaïlande': 'Thailand',
  'tailandia': 'Thailand',
  'tayland': 'Thailand',

  'vietnam': 'Vietnam',
  'viêt nam': 'Vietnam',

  'malaysia': 'Malaysia',
  'malaisie': 'Malaysia',
  'malasia': 'Malaysia',
  'malezya': 'Malaysia',

  'kolumbien': 'Colombia',
  'colombie': 'Colombia',
  'kolombiya': 'Colombia',

  'chile': 'Chile',
  'şili': 'Chile',
  'sili': 'Chile',

  'peru': 'Peru',
  'pérou': 'Peru',
  'perú': 'Peru',

  'hollanda': 'The Netherlands',
  'nederland': 'The Netherlands',

  'rusya': 'The Russian Federation',

  'gürcistan': 'Georgia',
  'gurcistan': 'Georgia',

  'ermenistan': 'Armenia',

  'azerbaycan': 'Azerbaijan',

  'güney kore': 'The Republic Of Korea',
  'guney kore': 'The Republic Of Korea',
  'kuzey kore': 'The Democratic Peoples Republic Of Korea',

  'irak': 'Iraq',

  'lübnan': 'Lebanon',
  'lubnan': 'Lebanon',

  'filistin': 'State Of Palestine',

  'fas': 'Morocco',

  'tunus': 'Tunisia',

  'cezayir': 'Algeria',

  'küba': 'Cuba',
  'kuba': 'Cuba',

  'izlanda': 'Iceland',

  'litvanya': 'Lithuania',
  'letonya': 'Latvia',
  'estonya': 'Estonia',

  'karadağ': 'Montenegro',
  'karadag': 'Montenegro',

  'arnavutluk': 'Albania',

  'kosova': 'Kosovo',

  'kıbrıs': 'Cyprus',
  'kibris': 'Cyprus',

  'lüksemburg': 'Luxembourg',
  'luksemburg': 'Luxembourg',

  'abd': 'The United States Of America',
  'amerika': 'The United States Of America',
  'amerika birleşik devletleri': 'The United States Of America',

  'birleşik krallık': 'The United Kingdom Of Great Britain And Northern Ireland',
  'ingiltere': 'The United Kingdom Of Great Britain And Northern Ireland',

  'birleşik arap emirlikleri': 'The United Arab Emirates',
  'bae': 'The United Arab Emirates',

  'afganistan': 'Afghanistan',
  'arnavutluk': 'Albania',
  'angola': 'Angola',
  'andorra': 'Andorra',
  'antigua ve barbuda': 'Antigua And Barbuda',
  'bahreyn': 'Bahrain',
  'bangladeş': 'Bangladesh',
  'banglades': 'Bangladesh',
  'barbados': 'Barbados',
  'belarus': 'Belarus',
  'beyaz rusya': 'Belarus',
  'belize': 'Belize',
  'benin': 'Benin',
  'bermuda': 'Bermuda',
  'butan': 'Bhutan',
  'bolivya': 'Bolivia',
  'botsvana': 'Botswana',
  'brunei': 'Brunei Darussalam',
  'burkina faso': 'Burkina Faso',
  'burundi': 'Burundi',
  'kamboçya': 'Cambodia',
  'kambocya': 'Cambodia',
  'kamerun': 'Cameroon',
  'yeşil burun adaları': 'Cabo Verde',
  'yesil burun adalari': 'Cabo Verde',
  'çad': 'Chad',
  'cad': 'Chad',
  'komorlar': 'The Comoros',
  'kongo': 'The Congo',
  'demokratik kongo cumhuriyeti': 'The Democratic Republic Of The Congo',
  'kosta rika': 'Costa Rica',
  'fildişi sahili': 'Coted Ivoire',
  'fildisi sahili': 'Coted Ivoire',
  'cibuti': 'Djibouti',
  'dominika': 'Dominica',
  'dominik cumhuriyeti': 'The Dominican Republic',
  'ekvador': 'Ecuador',
  'el salvador': 'El Salvador',
  'ekvator ginesi': 'Equatorial Guinea',
  'eritre': 'Eritrea',
  'etiyopya': 'Ethiopia',
  'falkland adaları': 'The Falkland Islands Malvinas',
  'falkland adalari': 'The Falkland Islands Malvinas',
  'faroe adaları': 'The Faroe Islands',
  'faroe adalari': 'The Faroe Islands',
  'fiji': 'Fiji',
  'fransız guyanası': 'French Guiana',
  'fransiz guyanasi': 'French Guiana',
  'fransız polinezyası': 'French Polynesia',
  'fransiz polinezyasi': 'French Polynesia',
  'gabon': 'Gabon',
  'gambiya': 'Gambia',
  'gana': 'Ghana',
  'cebelitarık': 'Gibraltar',
  'cebelitarik': 'Gibraltar',
  'grönland': 'Greenland',
  'gronland': 'Greenland',
  'grenada': 'Grenada',
  'guadeloupe': 'Guadeloupe',
  'guam': 'Guam',
  'guatemala': 'Guatemala',
  'gine': 'Guinea',
  'gine-bissau': 'Guinea Bissau',
  'guyana': 'Guyana',
  'haiti': 'Haiti',
  'vatikan': 'The Holy See',
  'honduras': 'Honduras',
  'hong kong': 'Hong Kong',
  'man adası': 'Isle Of Man',
  'man adasi': 'Isle Of Man',
  'israil': 'Israel',
  'jamaika': 'Jamaica',
  'ürdün': 'Jordan',
  'urdun': 'Jordan',
  'kazakistan': 'Kazakhstan',
  'kenya': 'Kenya',
  'kiribati': 'Kiribati',
  'kuveyt': 'Kuwait',
  'kırgızistan': 'Kyrgyzstan',
  'kirgizistan': 'Kyrgyzstan',
  'laos': 'The Lao Peoples Democratic Republic',
  'lesoto': 'Lesotho',
  'liberya': 'Liberia',
  'libya': 'Libya',
  'lihtenştayn': 'Liechtenstein',
  'lihtenstay': 'Liechtenstein',
  'madagaskar': 'Madagascar',
  'malavi': 'Malawi',
  'maldivler': 'Maldives',
  'mali': 'Mali',
  'malta': 'Malta',
  'marshall adaları': 'Marshall Islands',
  'marshall adalari': 'Marshall Islands',
  'martinik': 'Martinique',
  'moritanya': 'Mauritania',
  'mauritius': 'Mauritius',
  'mikronezya': 'Micronesia',
  'moldovya': 'The Republic Of Moldova',
  'monako': 'Monaco',
  'moğolistan': 'Mongolia',
  'mogolistan': 'Mongolia',
  'montserrat': 'Montserrat',
  'mozambik': 'Mozambique',
  'myanmar': 'Myanmar',
  'namibya': 'Namibia',
  'nauru': 'Nauru',
  'nepal': 'Nepal',
  'yeni kaledonya': 'New Caledonia',
  'nikaragua': 'Nicaragua',
  'nijer': 'The Niger',
  'nijerya': 'Nigeria',
  'umman': 'Oman',
  'pakistan': 'Pakistan',
  'palau': 'Palau',
  'panama': 'Panama',
  'papua yeni gine': 'Papua New Guinea',
  'paraguay': 'Paraguay',
  'filipinler': 'The Philippines',
  'porto riko': 'Puerto Rico',
  'katar': 'Qatar',
  'reunion': 'Reunion',
  'ruanda': 'Rwanda',
  'saint kitts ve nevis': 'Saint Kitts And Nevis',
  'saint lucia': 'Saint Lucia',
  'saint vincent ve grenadinler': 'Saint Vincent And The Grenadines',
  'samoa': 'Samoa',
  'san marino': 'San Marino',
  'são tomé ve príncipe': 'Sao Tome And Principe',
  'sao tome ve principe': 'Sao Tome And Principe',
  'senegal': 'Senegal',
  'seyşeller': 'Seychelles',
  'seyseller': 'Seychelles',
  'sierra leone': 'Sierra Leone',
  'solomon adaları': 'Solomon Islands',
  'solomon adalari': 'Solomon Islands',
  'somali': 'Somalia',
  'güney sudan': 'South Sudan',
  'guney sudan': 'South Sudan',
  'sri lanka': 'Sri Lanka',
  'sudan': 'The Sudan',
  'surinam': 'Suriname',
  'suriye': 'Syrian Arab Republic',
  'tacikistan': 'Tajikistan',
  'doğu timor': 'Timor Leste',
  'dogu timor': 'Timor Leste',
  'togo': 'Togo',
  'tonga': 'Tonga',
  'trinidad ve tobago': 'Trinidad And Tobago',
  'türkmenistan': 'Turkmenistan',
  'tuvalu': 'Tuvalu',
  'uganda': 'Uganda',
  'uruguay': 'Uruguay',
  'özbekistan': 'Uzbekistan',
  'ozbekistan': 'Uzbekistan',
  'vanuatu': 'Vanuatu',
  'venezuela': 'Bolivarian Republic Of Venezuela',
  'yemen': 'Yemen',
  'zambiya': 'Zambia',
  'zimbabve': 'Zimbabwe',
  'makedonya': 'Republic Of North Macedonia',
  'kuzey makedonya': 'Republic Of North Macedonia',
  'tanzanya': 'United Republic Of Tanzania',
  'çekya': 'Czechia',
  'cekya': 'Czechia',
  'çek cumhuriyeti': 'Czechia',
  'cek cumhuriyeti': 'Czechia',
  'bahamalar': 'The Bahamas',
  'orta afrika cumhuriyeti': 'The Central African Republic',
  'cook adaları': 'The Cook Islands',
  'cook adalari': 'The Cook Islands',
  'tayvan': 'Taiwan, Republic Of China',

  'afg': 'Afghanistan', 'alb': 'Albania', 'dza': 'Algeria', 'asm': 'American Samoa',
  'and': 'Andorra', 'ago': 'Angola', 'aia': 'Anguilla', 'atg': 'Antigua And Barbuda',
  'arg': 'Argentina', 'arm': 'Armenia', 'abw': 'Aruba', 'aus': 'Australia',
  'aut': 'Austria', 'aze': 'Azerbaijan',
  'bhs': 'The Bahamas', 'bhr': 'Bahrain', 'bgd': 'Bangladesh', 'brb': 'Barbados',
  'blr': 'Belarus', 'bel': 'Belgium', 'blz': 'Belize', 'ben': 'Benin', 'bmu': 'Bermuda',
  'btn': 'Bhutan', 'bol': 'Bolivia', 'bih': 'Bosnia And Herzegovina',
  'bwa': 'Botswana', 'bra': 'Brazil', 'brn': 'Brunei Darussalam', 'bgr': 'Bulgaria',
  'bfa': 'Burkina Faso', 'bdi': 'Burundi',
  'khm': 'Cambodia', 'cmr': 'Cameroon', 'can': 'Canada', 'cpv': 'Cabo Verde',
  'cym': 'The Cayman Islands', 'caf': 'The Central African Republic', 'tcd': 'Chad',
  'chl': 'Chile', 'chn': 'China', 'col': 'Colombia', 'com': 'The Comoros',
  'cog': 'The Congo', 'cod': 'The Democratic Republic Of The Congo',
  'cok': 'The Cook Islands', 'cri': 'Costa Rica', 'civ': 'Coted Ivoire',
  'hrv': 'Croatia', 'cub': 'Cuba', 'cuw': 'Curacao', 'cyp': 'Cyprus', 'cze': 'Czechia',
  'dnk': 'Denmark', 'dji': 'Djibouti', 'dma': 'Dominica', 'dom': 'The Dominican Republic',
  'ecu': 'Ecuador', 'egy': 'Egypt', 'slv': 'El Salvador', 'gnq': 'Equatorial Guinea',
  'eri': 'Eritrea', 'est': 'Estonia', 'eth': 'Ethiopia',
  'flk': 'The Falkland Islands Malvinas', 'fro': 'The Faroe Islands', 'fji': 'Fiji',
  'fin': 'Finland', 'fra': 'France', 'guf': 'French Guiana', 'pyf': 'French Polynesia',
  'gab': 'Gabon', 'gmb': 'Gambia', 'geo': 'Georgia', 'deu': 'Germany', 'gha': 'Ghana',
  'gib': 'Gibraltar', 'grc': 'Greece', 'grl': 'Greenland', 'grd': 'Grenada',
  'glp': 'Guadeloupe', 'gum': 'Guam', 'gtm': 'Guatemala', 'ggy': 'Guernsey',
  'gin': 'Guinea', 'gnb': 'Guinea Bissau', 'guy': 'Guyana',
  'hti': 'Haiti', 'vat': 'The Holy See', 'hnd': 'Honduras', 'hkg': 'Hong Kong',
  'hun': 'Hungary',
  'isl': 'Iceland', 'ind': 'India', 'idn': 'Indonesia', 'irn': 'Islamic Republic Of Iran',
  'irq': 'Iraq', 'irl': 'Ireland', 'imn': 'Isle Of Man', 'isr': 'Israel', 'ita': 'Italy',
  'jam': 'Jamaica', 'jpn': 'Japan', 'jey': 'Jersey', 'jor': 'Jordan',
  'kaz': 'Kazakhstan', 'ken': 'Kenya', 'kir': 'Kiribati',
  'prk': 'The Democratic Peoples Republic Of Korea', 'kor': 'The Republic Of Korea',
  'kwt': 'Kuwait', 'kgz': 'Kyrgyzstan',
  'lao': 'The Lao Peoples Democratic Republic', 'lva': 'Latvia', 'lbn': 'Lebanon',
  'lso': 'Lesotho', 'lbr': 'Liberia', 'lby': 'Libya', 'lie': 'Liechtenstein',
  'ltu': 'Lithuania', 'lux': 'Luxembourg',
  'mac': 'Macao', 'mkd': 'Republic Of North Macedonia', 'mdg': 'Madagascar',
  'mwi': 'Malawi', 'mys': 'Malaysia', 'mdv': 'Maldives', 'mli': 'Mali', 'mlt': 'Malta',
  'mhl': 'Marshall Islands', 'mtq': 'Martinique', 'mrt': 'Mauritania', 'mus': 'Mauritius',
  'myt': 'Mayotte', 'mex': 'Mexico', 'fsm': 'Micronesia', 'mda': 'The Republic Of Moldova',
  'mco': 'Monaco', 'mng': 'Mongolia', 'mne': 'Montenegro', 'msr': 'Montserrat',
  'mar': 'Morocco', 'moz': 'Mozambique', 'mmr': 'Myanmar',
  'nam': 'Namibia', 'nru': 'Nauru', 'npl': 'Nepal', 'nld': 'The Netherlands',
  'ncl': 'New Caledonia', 'nzl': 'New Zealand', 'nic': 'Nicaragua', 'ner': 'The Niger',
  'nga': 'Nigeria', 'niu': 'Niue', 'nfk': 'Norfolk Island', 'nor': 'Norway',
  'omn': 'Oman',
  'pak': 'Pakistan', 'plw': 'Palau', 'pse': 'State Of Palestine', 'pan': 'Panama',
  'png': 'Papua New Guinea', 'pry': 'Paraguay', 'per': 'Peru', 'phl': 'The Philippines',
  'pol': 'Poland', 'prt': 'Portugal', 'pri': 'Puerto Rico',
  'qat': 'Qatar',
  'reu': 'Reunion', 'rou': 'Romania', 'rus': 'The Russian Federation', 'rwa': 'Rwanda',
  'kna': 'Saint Kitts And Nevis', 'lca': 'Saint Lucia',
  'spm': 'Saint Pierre And Miquelon', 'vct': 'Saint Vincent And The Grenadines',
  'wsm': 'Samoa', 'smr': 'San Marino', 'stp': 'Sao Tome And Principe',
  'sau': 'Saudi Arabia', 'sen': 'Senegal', 'srb': 'Serbia', 'syc': 'Seychelles',
  'sle': 'Sierra Leone', 'sgp': 'Singapore', 'svk': 'Slovakia', 'svn': 'Slovenia',
  'slb': 'Solomon Islands', 'som': 'Somalia', 'zaf': 'South Africa', 'ssd': 'South Sudan',
  'esp': 'Spain', 'lka': 'Sri Lanka', 'sdn': 'The Sudan', 'sur': 'Suriname',
  'swe': 'Sweden', 'che': 'Switzerland', 'syr': 'Syrian Arab Republic',
  'twn': 'Taiwan, Republic Of China', 'tjk': 'Tajikistan',
  'tza': 'United Republic Of Tanzania', 'tha': 'Thailand', 'tls': 'Timor Leste',
  'tgo': 'Togo', 'tkl': 'Tokelau', 'ton': 'Tonga', 'tto': 'Trinidad And Tobago',
  'tun': 'Tunisia', 'tur': 'Türkiye', 'tkm': 'Turkmenistan', 'tca': 'Turks And Caicos',
  'tuv': 'Tuvalu',
  'uga': 'Uganda', 'ukr': 'Ukraine', 'are': 'The United Arab Emirates',
  'gbr': 'The United Kingdom Of Great Britain And Northern Ireland',
  'usa': 'The United States Of America',
  'ury': 'Uruguay', 'uzb': 'Uzbekistan',
  'vut': 'Vanuatu', 'ven': 'Bolivarian Republic Of Venezuela', 'vnm': 'Vietnam',
  'vgb': 'British Virgin Islands', 'vir': 'US Virgin Islands',
  'wlf': 'Wallis And Futuna', 'yem': 'Yemen', 'zmb': 'Zambia', 'zwe': 'Zimbabwe',
  'xkx': 'Kosovo',

  'ata': 'Antarctica',
  'atf': 'The French Southern Territories',
  'umi': 'The United States Minor Outlying Islands',
  'ala': 'Aland Islands',
  'shn': 'Ascension And Tristan Da Cunha Saint Helena',
  'bes': 'Bonaire',
  'iot': 'British Indian Ocean Territory',
};

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeTurkishLower(str: string): string {
  return str
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .replace(/i̇/g, 'i')
    .toLowerCase();
}

export function normalizeCountryFilter(input: string | undefined | null): Record<string, any> {
  if (!input || input === 'all' || input === 'null' || input === 'global') {
    return {};
  }

  const trimmed = input.trim();
  if (!trimmed) return {};

  const upper = trimmed.toUpperCase();
  if ((upper.length === 2 || upper.length === 3) && ISO_TO_DB[upper]) {
    const dbName = ISO_TO_DB[upper];
    return { country: { $regex: new RegExp(escapeRegex(dbName), 'i') } };
  }

  const lower = normalizeTurkishLower(trimmed);
  if (ALIAS_TO_DB[lower]) {
    const dbName = ALIAS_TO_DB[lower];
    return { country: { $regex: new RegExp(escapeRegex(dbName), 'i') } };
  }

  const stdLower = trimmed.toLowerCase();
  if (stdLower !== lower && ALIAS_TO_DB[stdLower]) {
    const dbName = ALIAS_TO_DB[stdLower];
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
  if ((upper.length === 2 || upper.length === 3) && ISO_TO_DB[upper]) {
    return ISO_TO_DB[upper];
  }

  const lower = normalizeTurkishLower(trimmed);
  if (ALIAS_TO_DB[lower]) {
    return ALIAS_TO_DB[lower];
  }

  const stdLower = trimmed.toLowerCase();
  if (stdLower !== lower && ALIAS_TO_DB[stdLower]) {
    return ALIAS_TO_DB[stdLower];
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
