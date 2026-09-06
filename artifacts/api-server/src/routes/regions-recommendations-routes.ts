import type { Express } from "express";
import { pgCatalog } from "../data/postgres-catalog-store";
import {
  pgCityCounts,
  pgGlobalCityCounts,
  pgDiverseStations,
} from "../data/postgres-discovery-operations";
import { logger } from "../utils/logger";
import CacheManager from "../cache";
import {
  pgStartMaintenanceJob,
  pgMaintenanceJobs,
  pgSaveMaintenanceJob,
} from "../data/postgres-maintenance-store";
import { safeFetch, INTERNAL_SERVICE_PORTS } from "../utils/safe-fetch";

// REGIONS DATA STRUCTURE
const WORLD_REGIONS = {
  africa: {
    name: "Africa",
    slug: "africa",
    countries: [
      "Algeria",
      "Angola",
      "Benin",
      "Botswana",
      "Burkina Faso",
      "Burundi",
      "Cameroon",
      "Cape Verde",
      "Central African Republic",
      "Chad",
      "Comoros",
      "Congo",
      "DR Congo",
      "Djibouti",
      "Egypt",
      "Equatorial Guinea",
      "Eritrea",
      "Ethiopia",
      "Gabon",
      "Gambia",
      "Ghana",
      "Guinea",
      "Guinea-Bissau",
      "Ivory Coast",
      "Kenya",
      "Lesotho",
      "Liberia",
      "Libya",
      "Madagascar",
      "Malawi",
      "Mali",
      "Mauritania",
      "Mauritius",
      "Morocco",
      "Mozambique",
      "Namibia",
      "Niger",
      "Nigeria",
      "Rwanda",
      "Sao Tome and Principe",
      "Senegal",
      "Seychelles",
      "Sierra Leone",
      "Somalia",
      "South Africa",
      "South Sudan",
      "Sudan",
      "Swaziland",
      "Tanzania",
      "Togo",
      "Tunisia",
      "Uganda",
      "Zambia",
      "Zimbabwe",
    ],
  },
  asia: {
    name: "Asia",
    slug: "asia",
    countries: [
      "Afghanistan",
      "Armenia",
      "Azerbaijan",
      "Bahrain",
      "Bangladesh",
      "Bhutan",
      "Brunei",
      "Cambodia",
      "China",
      "Cyprus",
      "Georgia",
      "India",
      "Indonesia",
      "Iran",
      "Iraq",
      "Israel",
      "Japan",
      "Jordan",
      "Kazakhstan",
      "Kuwait",
      "Kyrgyzstan",
      "Laos",
      "Lebanon",
      "Malaysia",
      "Maldives",
      "Mongolia",
      "Myanmar",
      "Nepal",
      "North Korea",
      "Oman",
      "Pakistan",
      "Palestine",
      "Philippines",
      "Qatar",
      "Saudi Arabia",
      "Singapore",
      "South Korea",
      "Sri Lanka",
      "Syria",
      "Taiwan",
      "Tajikistan",
      "Thailand",
      "Timor-Leste",
      "Turkey",
      "Turkmenistan",
      "United Arab Emirates",
      "Uzbekistan",
      "Vietnam",
      "Yemen",
    ],
  },
  europe: {
    name: "Europe",
    slug: "europe",
    countries: [
      "Albania",
      "Andorra",
      "Armenia",
      "Austria",
      "Azerbaijan",
      "Belarus",
      "Belgium",
      "Bosnia and Herzegovina",
      "Bulgaria",
      "Croatia",
      "Cyprus",
      "Czech Republic",
      "Denmark",
      "Estonia",
      "Finland",
      "France",
      "Georgia",
      "Germany",
      "Greece",
      "Hungary",
      "Iceland",
      "Ireland",
      "Italy",
      "Kosovo",
      "Latvia",
      "Liechtenstein",
      "Lithuania",
      "Luxembourg",
      "Malta",
      "Moldova",
      "Monaco",
      "Montenegro",
      "Netherlands",
      "North Macedonia",
      "Norway",
      "Poland",
      "Portugal",
      "Romania",
      "Russia",
      "San Marino",
      "Serbia",
      "Slovakia",
      "Slovenia",
      "Spain",
      "Sweden",
      "Switzerland",
      "Turkey",
      "Ukraine",
      "United Kingdom",
      "Vatican City",
    ],
  },
  "north-america": {
    name: "North America",
    slug: "north-america",
    countries: [
      "Antigua and Barbuda",
      "Bahamas",
      "Barbados",
      "Belize",
      "Canada",
      "Costa Rica",
      "Cuba",
      "Dominica",
      "Dominican Republic",
      "El Salvador",
      "Grenada",
      "Guatemala",
      "Haiti",
      "Honduras",
      "Jamaica",
      "Mexico",
      "Nicaragua",
      "Panama",
      "Saint Kitts and Nevis",
      "Saint Lucia",
      "Saint Vincent and the Grenadines",
      "Trinidad and Tobago",
      "United States",
    ],
  },
  "south-america": {
    name: "South America",
    slug: "south-america",
    countries: [
      "Argentina",
      "Bolivia",
      "Brazil",
      "Chile",
      "Colombia",
      "Ecuador",
      "French Guiana",
      "Guyana",
      "Paraguay",
      "Peru",
      "Suriname",
      "Uruguay",
      "Venezuela",
    ],
  },
  oceania: {
    name: "Oceania",
    slug: "oceania",
    countries: [
      "Australia",
      "Fiji",
      "Kiribati",
      "Marshall Islands",
      "Micronesia",
      "Nauru",
      "New Zealand",
      "Palau",
      "Papua New Guinea",
      "Samoa",
      "Solomon Islands",
      "Tonga",
      "Tuvalu",
      "Vanuatu",
    ],
  },
};

const COUNTRY_CITIES: { [key: string]: string[] } = {
  Turkey: [
    "Istanbul",
    "Ankara",
    "Izmir",
    "Bursa",
    "Antalya",
    "Adana",
    "Gaziantep",
    "Konya",
    "Kayseri",
    "Diyarbakir",
    "Eskisehir",
    "Mersin",
  ],
  Germany: [
    "Berlin",
    "Munich",
    "Hamburg",
    "Cologne",
    "Frankfurt",
    "Stuttgart",
    "Düsseldorf",
    "Dortmund",
    "Essen",
    "Leipzig",
    "Bremen",
    "Dresden",
  ],
  "United States": [
    "New York",
    "Los Angeles",
    "Chicago",
    "Houston",
    "Phoenix",
    "Philadelphia",
    "San Antonio",
    "San Diego",
    "Dallas",
    "San Jose",
    "Austin",
    "Jacksonville",
  ],
  "United Kingdom": [
    "London",
    "Birmingham",
    "Manchester",
    "Glasgow",
    "Liverpool",
    "Leeds",
    "Sheffield",
    "Edinburgh",
    "Bristol",
    "Cardiff",
    "Belfast",
    "Newcastle",
  ],
  France: [
    "Paris",
    "Marseille",
    "Lyon",
    "Toulouse",
    "Nice",
    "Nantes",
    "Strasbourg",
    "Montpellier",
    "Bordeaux",
    "Lille",
    "Rennes",
    "Reims",
  ],
  Italy: [
    "Rome",
    "Milan",
    "Naples",
    "Turin",
    "Palermo",
    "Genoa",
    "Bologna",
    "Florence",
    "Bari",
    "Catania",
    "Venice",
    "Verona",
  ],
  Spain: [
    "Madrid",
    "Barcelona",
    "Valencia",
    "Seville",
    "Zaragoza",
    "Málaga",
    "Murcia",
    "Palma",
    "Las Palmas",
    "Bilbao",
    "Alicante",
    "Córdoba",
  ],
  Austria: [
    "Wien",
    "Vienna",
    "Salzburg",
    "Graz",
    "Steiermark",
    "Linz",
    "Oberösterreich",
    "Innsbruck",
    "Tirol",
    "Klagenfurt",
    "Kärnten",
    "Villach",
    "Wels",
    "Sankt Pölten",
    "Niederösterreich",
    "Dornbirn",
    "Vorarlberg",
    "Bregenz",
    "Feldkirch",
    "Wiener Neustadt",
    "Steyr",
    "Leonding",
    "Klosterneuburg",
    "Baden",
    "Wolfsberg",
    "Leoben",
    "Krems",
  ],
  Canada: [
    "Toronto",
    "Montreal",
    "Vancouver",
    "Calgary",
    "Edmonton",
    "Ottawa",
    "Winnipeg",
    "Quebec City",
    "Hamilton",
    "Kitchener",
    "London",
    "Victoria",
  ],
  Australia: [
    "Sydney",
    "Melbourne",
    "Brisbane",
    "Perth",
    "Adelaide",
    "Gold Coast",
    "Newcastle",
    "Canberra",
    "Central Coast",
    "Geelong",
    "Hobart",
    "Townsville",
  ],
  Brazil: [
    "São Paulo",
    "Rio de Janeiro",
    "Brasília",
    "Salvador",
    "Fortaleza",
    "Belo Horizonte",
    "Manaus",
    "Curitiba",
    "Recife",
    "Porto Alegre",
    "Belém",
    "Goiânia",
  ],
  Russia: [
    "Moscow",
    "Saint Petersburg",
    "Novosibirsk",
    "Yekaterinburg",
    "Nizhny Novgorod",
    "Kazan",
    "Chelyabinsk",
    "Omsk",
    "Samara",
    "Rostov-on-Don",
    "Ufa",
    "Krasnoyarsk",
  ],
  India: [
    "Mumbai",
    "Delhi",
    "Bangalore",
    "Hyderabad",
    "Chennai",
    "Kolkata",
    "Pune",
    "Ahmedabad",
    "Jaipur",
    "Surat",
    "Lucknow",
    "Kanpur",
  ],
  Japan: [
    "Tokyo",
    "Yokohama",
    "Osaka",
    "Nagoya",
    "Sapporo",
    "Fukuoka",
    "Kobe",
    "Kawasaki",
    "Kyoto",
    "Saitama",
    "Hiroshima",
    "Sendai",
  ],
  China: [
    "Beijing",
    "Shanghai",
    "Guangzhou",
    "Shenzhen",
    "Tianjin",
    "Wuhan",
    "Dongguan",
    "Chengdu",
    "Nanjing",
    "Foshan",
    "Shenyang",
    "Hangzhou",
  ],
  Ukraine: [
    "Kyiv",
    "Kharkiv",
    "Odessa",
    "Dnipro",
    "Donetsk",
    "Zaporizhzhia",
    "Lviv",
    "Kryvyi Rih",
    "Mykolaiv",
    "Mariupol",
    "Luhansk",
    "Vinnytsya",
    "Makiivka",
    "Sevastopol",
    "Simferopol",
    "Chernihiv",
    "Poltava",
    "Cherkasy",
    "Zhytomyr",
    "Sumy",
    "Khmelnytskyi",
    "Chernivtsi",
    "Rivne",
    "Kremenchuk",
    "Ivano-Frankivsk",
    "Ternopil",
    "Lutsk",
    "Bila Tserkva",
    "Uzhgorod",
  ],
  "Czech Republic": [
    "Prague",
    "Brno",
    "Ostrava",
    "Plzen",
    "Liberec",
    "Olomouc",
    "Usti nad Labem",
    "Hradec Kralove",
    "Ceske Budejovice",
    "Pardubice",
    "Havirov",
    "Zlin",
    "Most",
    "Kladno",
    "Opava",
    "Frydek-Mistek",
    "Karvina",
    "Jihlava",
    "Teplice",
    "Decin",
  ],
};

const COUNTRY_NAME_MAPPING: { [key: string]: string[] } = {
  "Czech Republic": ["Czechia", "Czech Republic"],
  Russia: ["The Russian Federation", "Russia"],
  "United States": ["The United States Of America", "United States"],
  Turkey: ["Turkey", "Türkiye"],
  China: ["China", "People's Republic of China"],
  Taiwan: ["Taiwan, Republic Of China", "Taiwan"],
  Philippines: ["The Philippines", "Philippines"],
  "United Kingdom": ["United Kingdom", "Great Britain"],
  "Vatican City": ["Vatican City State", "Vatican City", "Vatican"],
};

const CITY_ALTERNATIVE_NAMES: { [key: string]: string[] } = {
  Wien: ["Wien", "Vienna"],
  Vienna: ["Wien", "Vienna"],
  München: ["München", "Munich"],
  Munich: ["München", "Munich"],
  Köln: ["Köln", "Cologne"],
  Cologne: ["Köln", "Cologne"],
  Praha: ["Praha", "Prague"],
  Prague: ["Praha", "Prague"],
  Roma: ["Roma", "Rome"],
  Rome: ["Roma", "Rome"],
  Milano: ["Milano", "Milan"],
  Milan: ["Milano", "Milan"],
  Firenze: ["Firenze", "Florence"],
  Florence: ["Firenze", "Florence"],
  Lisboa: ["Lisboa", "Lisbon"],
  Lisbon: ["Lisboa", "Lisbon"],
  Moskva: ["Moskva", "Moscow"],
  Moscow: ["Moskva", "Moscow"],
};

function getCountrySearchPatterns(countryName: string): string[] {
  return COUNTRY_NAME_MAPPING[countryName] || [countryName];
}

export function registerRegionsRecommendationsRoutes(app: Express, deps: any) {
  const { requireAdmin, normalizeCountryFilter } = deps;

  // Get global popular cities - CACHED
  app.get("/api/cities/global", async (req, res) => {
    const cacheKey = "global_cities_v1";
    const CacheManager = (await import("../cache")).default;
    try {
      // INCIDENT 2026-05-15 v10.2 — wrap the 30-aggregate fan-out in
      // single-flight + SWR. With ~10 major countries × 3 cities this
      // route fires 30 sequential $count aggregates on cold miss; under
      // SSR fanout that was multiplying into hundreds of concurrent
      // aggregates and contributing to multiplanner contention. SWR
      // (1h fresh / 24h stale) keeps response instant even mid-refresh.
      const topGlobalCities = await CacheManager.getOrSetSWR<any[]>(
        cacheKey,
        async () => {
          const majorCountries = [
            "United States",
            "Germany",
            "United Kingdom",
            "France",
            "Italy",
            "Spain",
            "Canada",
            "Australia",
            "Austria",
            "Netherlands",
          ];
          return pgGlobalCityCounts(
            majorCountries.flatMap((countryName) =>
              (COUNTRY_CITIES[countryName] || [])
                .slice(0, 3)
                .map((name) => ({
                  name,
                  country: countryName,
                  countries: getCountrySearchPatterns(countryName),
                })),
            ),
          );
        },
        { freshTtl: 3600, staleTtl: 86400 },
      );

      res.json({
        success: true,
        data: { cities: topGlobalCities },
      });
    } catch (error: any) {
      // INCIDENT 2026-05-15 v10.2 — structured code/codeName + SWR fallback.
      logger.error(
        `❌ /api/cities/global failed: code=${error?.code || "unknown"} codeName=${error?.codeName || "unknown"} msg=${error?.message || error}`,
      );
      // INCIDENT 2026-05-15 v10.2 — catch-path must read SWR envelope
      // (`<key>:swr`), not the dead base key, to actually surface
      // last-known-good when the loader threw.
      let stale: any[] | null = null;
      try {
        stale = await CacheManager.getSWR<any[]>(cacheKey);
      } catch {}
      res.set("Cache-Control", "no-store");
      res.json({
        success: true,
        data: { cities: Array.isArray(stale) ? stale : [] },
      });
    }
  });

  // Get precomputed cities for a country
  app.get("/api/cities/precomputed", async (req, res) => {
    try {
      const { country } = req.query;

      if (!country || typeof country !== "string") {
        return void res.status(400).json({
          success: false,
          error: "Country parameter is required",
        });
      }

      const { PrecomputedCitiesService } =
        await import("../services/precomputed-cities");
      const data = await PrecomputedCitiesService.getCitiesForCountry(country);

      res.json({
        success: true,
        data: {
          cities: data.cities,
          totalCountryStations: data.totalCountryStations,
          cached: data.computedAt < Date.now() - 1000,
        },
      });
    } catch (error: any) {
      logger.error(
        `❌ /api/cities/precomputed failed: code=${error?.code || "unknown"} msg=${error?.message || error}`,
      );
      res.set("Cache-Control", "no-store");
      res.json({
        success: true,
        data: { cities: [], totalCountryStations: 0, cached: false },
      });
    }
  });

  // Get all world regions
  app.get("/api/regions", (req, res) => {
    try {
      const regions = Object.keys(WORLD_REGIONS).map((key) => ({
        slug: key,
        name: (WORLD_REGIONS as any)[key].name,
        countryCount: (WORLD_REGIONS as any)[key].countries.length,
      }));

      res.json({
        success: true,
        data: regions,
      });
    } catch (error: any) {
      logger.error(
        `❌ /api/regions failed: code=${error?.code || "unknown"} msg=${error?.message || error}`,
      );
      res.set("Cache-Control", "no-store");
      res.json({ success: true, data: [] });
    }
  });

  // Get countries in a specific region
  // INCIDENT 2026-05-16 v12 — wrapped in single-flight cache (5min TTL)
  // for consistency with the country/city sub-routes and to absorb any
  // surge of organic SSR fanout. The compute itself is pure JS (no DB)
  // so the cache also lets us serve from memory under load.
  app.get("/api/regions/:regionSlug", async (req, res) => {
    const { regionSlug } = req.params;
    try {
      const region = (WORLD_REGIONS as any)[regionSlug];
      if (!region) {
        return void res.status(404).json({
          success: false,
          error: "Region not found",
        });
      }
      const cacheKey = `regions:list:${regionSlug}`;
      const payload = await CacheManager.getOrSetSingleFlight(
        cacheKey,
        async () => {
          const counts = await pgCatalog().groupCount("country");
          const accurateCountMap = new Map(
            counts
              .filter((row) => row._id)
              .map((row) => [row._id!.toLowerCase(), row.count]),
          );
          const countries = region.countries.map((countryName: string) => {
            const searchPatterns = getCountrySearchPatterns(countryName);

            const totalCount = [
              ...new Set(
                searchPatterns.map((pattern) => pattern.toLowerCase()),
              ),
            ].reduce(
              (sum, pattern) => sum + (accurateCountMap.get(pattern) || 0),
              0,
            );
            return {
              name: countryName,
              slug: countryName
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "-")
                .replace(/--+/g, "-")
                .replace(/^-|-$/g, ""),
              stationCount: totalCount,
            };
          });

          const countriesWithStations = countries.filter(
            (country: any) => country.stationCount > 0,
          );
          countriesWithStations.sort(
            (a: any, b: any) => b.stationCount - a.stationCount,
          );

          return {
            success: true,
            data: {
              region: { name: region.name, slug: regionSlug },
              countries: countriesWithStations,
            },
          };
        },
        { ttl: 300 },
      );
      res.json(payload);
    } catch (error: any) {
      logger.error(
        `❌ /api/regions/:slug failed: code=${error?.code || "unknown"} msg=${error?.message || error}`,
      );
      res.set("Cache-Control", "no-store");
      res.json({
        success: true,
        data: { region: { name: "", slug: regionSlug }, countries: [] },
      });
    }
  });

  // Get cities in a specific country
  app.get("/api/regions/:regionSlug/:countrySlug", async (req, res) => {
    const { regionSlug, countrySlug } = req.params;
    const cacheKey = `regions:country:${regionSlug}:${countrySlug}`;
    try {
      const region = (WORLD_REGIONS as any)[regionSlug];

      if (!region) {
        return void res.status(404).json({
          success: false,
          error: "Region not found",
        });
      }

      const countryName = region.countries.find(
        (country: string) =>
          country
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "-")
            .replace(/--+/g, "-")
            .replace(/^-|-$/g, "") === countrySlug,
      );

      if (!countryName) {
        return void res.status(404).json({
          success: false,
          error: "Country not found",
        });
      }

      // INCIDENT 2026-05-16 v12 — single-flight + tighter maxTimeMS.
      // Previously every cold miss fanned out (cities.length + 1)
      // aggregates each with a 15s budget. Under SSR fanout (multiple
      // languages × parallel CDN expirations) this was the primary
      // pool-drain source after /api/stations. Single-flight coalesces
      // concurrent misses into ONE compute, 8s budget keeps the pool
      // freeing fast, 5-minute cache TTL absorbs steady traffic.
      const payload = await CacheManager.getOrSetSingleFlight(
        cacheKey,
        async () => {
          const cities = COUNTRY_CITIES[countryName] || [];
          const counts = await pgCityCounts(
            getCountrySearchPatterns(countryName),
            cities.map((name) => ({
              name,
              terms: CITY_ALTERNATIVE_NAMES[name] || [name],
            })),
          );
          const citiesWithCounts = counts.cities.map((city) => ({
            ...city,
            slug: city.name
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "-")
              .replace(/--+/g, "-")
              .replace(/^-|-$/g, ""),
          }));
          const stationsWithoutCity = counts.unassigned;
          const citiesWithStations = citiesWithCounts.filter(
            (city) => city.stationCount > 0,
          );
          citiesWithStations.sort((a, b) => b.stationCount - a.stationCount);

          const finalCities = [];
          if (stationsWithoutCity > 0) {
            finalCities.push({
              name: "ALL",
              slug: "all",
              stationCount: stationsWithoutCity,
            });
          }
          finalCities.push(...citiesWithStations);

          return {
            success: true,
            data: {
              region: { name: region.name, slug: regionSlug },
              country: { name: countryName, slug: countrySlug },
              cities: finalCities,
            },
          };
        },
        { ttl: 300 },
      );

      res.json(payload);
    } catch (error: any) {
      logger.error(
        `❌ /api/regions/:slug/:country failed: code=${error?.code || "unknown"} msg=${error?.message || error}`,
      );
      let stale: any = null;
      try {
        stale = await CacheManager.get(cacheKey);
      } catch {}
      res.set("Cache-Control", "no-store");
      res.json(
        stale ?? {
          success: true,
          data: {
            region: { name: "", slug: regionSlug },
            country: { name: "", slug: countrySlug },
            cities: [],
          },
        },
      );
    }
  });

  // Get stations by region/country/city
  // EXPRESS 5 OPTIONAL-PARAM FIX (2026-07-04): the optional group must
  // include the leading slash — `{/:citySlug}` — or the slash stays
  // REQUIRED and the no-city form only matches with a double slash
  // (`/france//stations`). The old `/{:citySlug}/` pattern made
  // /api/regions/europe/france/stations return 404, which the SPA surfaced
  // as "Bölgeler yüklenemedi" on every country-stations page.
  app.get(
    "/api/regions/:regionSlug/:countrySlug{/:citySlug}/stations",
    async (req, res) => {
      try {
        const { regionSlug, countrySlug, citySlug } = req.params;
        const limit = Math.max(
          1,
          Math.min(500, parseInt(String(req.query.limit), 10) || 50),
        );
        const offset = Math.max(
          0,
          Math.min(1000000, parseInt(String(req.query.offset), 10) || 0),
        );
        const sortBy = [
          "votes",
          "name",
          "clickCount",
          "bitrate",
          "updatedAt",
        ].includes(String(req.query.sortBy))
          ? String(req.query.sortBy)
          : "votes";
        const order = req.query.order === "asc" ? "asc" : "desc";

        const region = (WORLD_REGIONS as any)[regionSlug];
        if (!region) {
          return void res.status(404).json({
            success: false,
            error: "Region not found",
          });
        }

        const countryName = region.countries.find(
          (country: string) =>
            country
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "-")
              .replace(/--+/g, "-")
              .replace(/^-|-$/g, "") === countrySlug,
        );

        if (!countryName) {
          return void res.status(404).json({
            success: false,
            error: "Country not found",
          });
        }

        const searchPatterns = getCountrySearchPatterns(countryName);
        const countryOrConditions = searchPatterns.map((pattern) => ({
          country: {
            $regex: `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
            $options: "i",
          },
        }));

        const stationFilter: any = {
          $or: countryOrConditions,
        };

        let cityName = null;
        if (citySlug) {
          if (citySlug === "all") {
            logger.log(
              "🏙️ Fetching ALL stations (without specific city data) for country:",
              countryName,
            );
            const cities = COUNTRY_CITIES[countryName] || [];
            const cityExcludeConditions: any[] = [];
            for (const city of cities) {
              let citySearchTerms = CITY_ALTERNATIVE_NAMES[city] || [city];
              if (city === "Wien" || city === "Vienna") {
                citySearchTerms = ["Wien", "Vienna", "vienna", "wien"];
              }
              citySearchTerms.forEach((term) => {
                cityExcludeConditions.push(
                  { name: { $not: { $regex: new RegExp(term, "i") } } },
                  { tags: { $not: { $regex: new RegExp(term, "i") } } },
                );
              });
            }
            if (cityExcludeConditions.length > 0) {
              stationFilter.$and = [
                { $or: countryOrConditions },
                { $and: cityExcludeConditions },
              ];
              delete stationFilter.$or;
            }
          } else {
            const cities = COUNTRY_CITIES[countryName] || [];
            cityName = cities.find(
              (city) =>
                city
                  .toLowerCase()
                  .replace(/[^a-z0-9]/g, "-")
                  .replace(/--+/g, "-")
                  .replace(/^-|-$/g, "") === citySlug,
            );
            if (!cityName) {
              return void res.status(404).json({
                success: false,
                error: "City not found",
              });
            }
            let citySearchTerms = CITY_ALTERNATIVE_NAMES[cityName] || [
              cityName,
            ];
            if (cityName === "Wien" || cityName === "Vienna") {
              citySearchTerms = ["Wien", "Vienna", "vienna", "wien"];
            }
            const cityConditions = citySearchTerms.flatMap((term) => [
              { name: { $regex: new RegExp(term, "i") } },
              { tags: { $regex: new RegExp(term, "i") } },
            ]);
            stationFilter.$and = [
              { $or: countryOrConditions },
              { $or: cityConditions },
            ];
            delete stationFilter.$or;
          }
        }

        // INCIDENT 2026-05-16 v12 — add explicit maxTimeMS (8s) on both
        // queries. Previously these had no per-query budget and inherited
        // the socketTimeoutMS(45s) ceiling, meaning ONE slow regex
        // countDocuments could pin a connection for 45s. 8s is plenty
        // for an indexed find + count and lets the pool recycle fast.
        const stationsCacheKey = `regions:stations:${regionSlug}:${countrySlug}:${citySlug || "none"}:${sortBy}:${order}:${limit}:${offset}`;
        const payload = await CacheManager.getOrSetSingleFlight(
          stationsCacheKey,
          async () => {
            const [stations, total] = await Promise.all([
              pgCatalog().find(stationFilter, {
                sort: { [sortBy]: order === "desc" ? -1 : 1 },
                offset,
                limit,
              }),
              pgCatalog().count(stationFilter),
            ]);
            return {
              success: true,
              data: {
                stations,
                total,
                limit: Number(limit),
                offset: Number(offset),
                countryName,
                cityName,
              },
            };
          },
          { ttl: 300 },
        );

        res.json(payload);
      } catch (error: any) {
        logger.error(
          `❌ /api/regions/:slug/:country/:city/stations failed: code=${error?.code || "unknown"} msg=${error?.message || error}`,
        );
        res.set("Cache-Control", "no-store");
        res.json({
          success: true,
          data: {
            stations: [],
            total: 0,
            limit: Number(req.query.limit || 50),
            offset: Number(req.query.offset || 0),
            countryName: "",
            cityName: null,
          },
        });
      }
    },
  );

  // Dedicated Recommendations
  app.get("/api/recommendations/dedicated", async (req, res) => {
    try {
      const { country, genre, limit = 10 } = req.query;
      const { RecommendationEngine } =
        await import("../services/recommendation-engine");
      const recommendations = await (
        RecommendationEngine as any
      ).getDedicatedRecommendations(
        country as string,
        genre as string,
        Number(limit),
      );
      res.json(recommendations);
    } catch (error: any) {
      logger.error(
        `❌ /api/recommendations/dedicated failed: code=${error?.code || "unknown"} msg=${error?.message || error}`,
      );
      res.set("Cache-Control", "no-store");
      res.json([]);
    }
  });

  app.get("/api/recommendations/diverse", async (req, res) => {
    const limit = Math.max(
      1,
      Math.min(parseInt(req.query.limit as string) || 20, 50),
    );
    const country = (req.query.country as string) || null;
    const cacheKey = `recommendations:diverse:${country || "all"}:${limit}`;
    try {
      // INCIDENT 2026-05-15 v10.2 — single-flight + SWR. This route
      // fans out 10 $sample aggregates in parallel; without coalescing
      // a homepage SSR burst could trigger 100+ concurrent computes.
      const result = await CacheManager.getOrSetSWR<{
        stations: any[];
        total: number;
      }>(
        cacheKey,
        async () => {
          const uniqueStations = await pgDiverseStations(country, limit);
          return { stations: uniqueStations, total: uniqueStations.length };
        },
        { freshTtl: 300, staleTtl: 3600 },
      );
      res.json(result);
    } catch (error: any) {
      logger.error(
        `❌ /api/recommendations/diverse failed: code=${error?.code || "unknown"} codeName=${error?.codeName || "unknown"} msg=${error?.message || error}`,
      );
      // INCIDENT 2026-05-15 v10.2 — read SWR envelope on fallback path.
      let stale: any = null;
      try {
        stale = await CacheManager.getSWR(cacheKey);
      } catch {}
      res.set("Cache-Control", "no-store");
      res.json(stale ?? { stations: [], total: 0 });
    }
  });

  const emptyHealthProgress = () => ({
    running: false,
    totalStations: 0,
    tested: 0,
    working: 0,
    broken: 0,
    hls: 0,
    timeout: 0,
    startTime: null,
    endTime: null,
    duration: 0,
    currentBatch: 0,
    batchSize: 50,
    requestTimeout: 10000,
  });
  app.post("/api/admin/start-health-check", requireAdmin, async (req, res) => {
    try {
      const totalStations = await pgCatalog().count();
      const progress: any = {
        ...emptyHealthProgress(),
        running: true,
        totalStations,
        startTime: new Date(),
      };
      const results = {
        summary: {},
        brokenStations: [],
        hlsStations: [],
        completedAt: null,
      };
      const { job, token } = await pgStartMaintenanceJob("health_check", {
        progress,
        results,
        message: "Health check started",
      });
      void runHealthCheck(job.id, token, progress, req.body?.limit).catch(
        async (error) => {
          progress.running = false;
          await pgSaveMaintenanceJob(
            job.id,
            token,
            {
              progress,
              error: (error as Error).message,
              message: "Health check failed",
            },
            "failed",
          ).catch(() => {});
        },
      );
      res.json({
        message: "Health check started",
        totalStations,
        jobId: job.id,
      });
    } catch (error: any) {
      res
        .status(error.code === "23505" ? 409 : 500)
        .json({
          error:
            error.code === "23505"
              ? "Health check already running"
              : "Failed to start health check",
        });
    }
  });
  app.get(
    "/api/admin/health-check-progress",
    requireAdmin,
    async (_req, res) => {
      try {
        const job = (await pgMaintenanceJobs("health_check"))[0];
        res.json({
          progress: job
            ? { ...job.progress, running: job.status === "running" }
            : emptyHealthProgress(),
          results: job?.results || {
            summary: {},
            brokenStations: [],
            hlsStations: [],
            completedAt: null,
          },
        });
      } catch {
        res
          .status(500)
          .json({ error: "Failed to fetch health check progress" });
      }
    },
  );
  async function runHealthCheck(
    id: string,
    token: string,
    progress: any,
    testLimit?: number,
  ): Promise<void> {
    const brokenStations: any[] = [],
      hlsStations: any[] = [];
    const limit = Math.min(
      progress.totalStations,
      Math.max(1, Math.trunc(Number(testLimit)) || progress.totalStations),
    );
    let cursor = "";
    while (progress.tested < limit) {
      if (!(await pgSaveMaintenanceJob(id, token, { progress }))) return;
      const stations = await pgCatalog().find(
        { _id: { $gt: cursor } },
        {
          sort: { _id: 1 },
          fields: ["_id", "name", "url"],
          limit: Math.min(progress.batchSize, limit - progress.tested),
        },
      );
      if (!stations.length) break;
      progress.currentBatch++;
      await Promise.all(
        stations.map((station) =>
          testStationConnectivity(
            station,
            progress,
            brokenStations,
            hlsStations,
          ),
        ),
      );
      progress.tested += stations.length;
      cursor = stations[stations.length - 1]._id;
      brokenStations.length = Math.min(brokenStations.length, 100);
      hlsStations.length = Math.min(hlsStations.length, 100);
    }
    progress.running = false;
    progress.endTime = new Date();
    progress.duration = Date.now() - new Date(progress.startTime).getTime();
    const results = {
      summary: {
        total: progress.tested,
        working: progress.working,
        broken: progress.broken,
        hls: progress.hls,
        timeout: progress.timeout,
      },
      brokenStations,
      hlsStations,
      completedAt: progress.endTime,
    };
    await pgSaveMaintenanceJob(
      id,
      token,
      { progress, results, message: "Health check completed" },
      "completed",
    );
  }
  async function testStationConnectivity(
    station: any,
    progress: any,
    broken: any[],
    hls: any[],
  ): Promise<void> {
    for (let retry = 0; retry < 2; retry++) {
      try {
        const options = {
          blockedPorts: INTERNAL_SERVICE_PORTS,
          timeoutMs: progress.requestTimeout,
        };
        const headers = {
          "User-Agent": "MegaRadio-Station-Health/1.0",
          Accept: "audio/*,application/ogg,*/*",
          "Icy-MetaData": "1",
        };
        let response: Response;
        try {
          response = await safeFetch(
            station.url,
            { method: "HEAD", headers },
            options,
          );
        } catch {
          response = await safeFetch(
            station.url,
            { method: "GET", headers: { ...headers, Range: "bytes=0-2047" } },
            options,
          );
        }
        const finalUrl = response.url,
          contentType = response.headers.get("content-type") || "",
          icyName = response.headers.get("icy-name");
        // Never leave a GET fallback's unbounded radio stream occupying a socket.
        await response.body?.cancel().catch(() => {});
        if (isHLSStream(finalUrl, contentType)) {
          progress.hls++;
          hls.push({
            id: station._id,
            name: station.name,
            url: station.url,
            finalUrl,
            contentType,
            reason: "HLS/m3u8 stream detected",
          });
          return;
        }
        if (validateStreamResponse(response, contentType, finalUrl, icyName)) {
          progress.working++;
          return;
        }
        if (retry === 0) continue;
        progress.broken++;
        broken.push({
          id: station._id,
          name: station.name,
          url: station.url,
          finalUrl,
          status: response.status,
          contentType,
          icyName: icyName || "N/A",
          reason:
            "Invalid stream: HTTP " +
            response.status +
            ", Content-Type: " +
            (contentType || "unknown"),
        });
        return;
      } catch (error: any) {
        if (retry === 0) continue;
        if (error.name === "AbortError" || error.name === "TimeoutError")
          progress.timeout++;
        else progress.broken++;
        broken.push({
          id: station._id,
          name: station.name,
          url: station.url,
          reason: "Network error: " + error.message + " (after 2 attempts)",
        });
      }
    }
  }
  function validateStreamResponse(
    response: any,
    contentType: string,
    finalUrl: string,
    icyName: string | null,
  ) {
    if (!response.ok) return false;
    const status = response.status;
    const contentLower = contentType.toLowerCase();
    const urlLower = finalUrl.toLowerCase();
    return (
      contentLower.includes("audio/") ||
      contentLower.includes("application/ogg") ||
      contentLower.includes("application/octet-stream") ||
      contentLower.includes("audio/x-scpls") ||
      contentLower.includes("audio/x-mpegurl") ||
      icyName ||
      response.headers.get("icy-genre") ||
      response.headers.get("icy-br") ||
      status === 206 ||
      urlLower.includes("/stream") ||
      urlLower.includes("icecast") ||
      urlLower.includes("shoutcast") ||
      !response.headers.get("content-length") ||
      parseInt(response.headers.get("content-length") || "0") > 50000
    );
  }

  function isHLSStream(url: string, contentType: string) {
    const urlLower = url.toLowerCase();
    const contentLower = contentType.toLowerCase();
    if (
      urlLower.includes(".m3u8") ||
      urlLower.includes("/hls/") ||
      urlLower.includes("manifest.m3u8") ||
      urlLower.includes("playlist.m3u8") ||
      (urlLower.includes("/live/") && urlLower.includes(".m3u8"))
    ) {
      return true;
    }
    if (
      contentLower.includes("application/vnd.apple.mpegurl") ||
      contentLower.includes("application/x-mpegurl") ||
      contentLower.includes("audio/mpegurl") ||
      (contentLower.includes("text/plain") && urlLower.includes("m3u8"))
    ) {
      return true;
    }
    return false;
  }
}
