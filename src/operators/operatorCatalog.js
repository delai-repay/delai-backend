const UK_RAIL_OPERATORS = Object.freeze([
  {
    key: "avanti_west_coast",
    displayName: "Avanti West Coast",
    aliases: ["avanti", "awc"],
  },
  {
    key: "c2c",
    displayName: "c2c",
    aliases: ["c2c rail"],
  },
  {
    key: "caledonian_sleeper",
    displayName: "Caledonian Sleeper",
    aliases: ["caledonian sleeper", "sleeper"],
  },
  {
    key: "chiltern_railways",
    displayName: "Chiltern Railways",
    aliases: ["chiltern"],
  },
  {
    key: "crosscountry",
    displayName: "CrossCountry",
    aliases: ["cross country", "xc"],
  },
  {
    key: "east_midlands_railway",
    displayName: "East Midlands Railway",
    aliases: ["east midlands", "emr"],
  },
  {
    key: "elizabeth_line",
    displayName: "Elizabeth line",
    aliases: ["elizabeth line", "crossrail"],
  },
  {
    key: "gatwick_express",
    displayName: "Gatwick Express",
    aliases: ["gatwick express"],
  },
  {
    key: "grand_central",
    displayName: "Grand Central",
    aliases: ["grand central railway"],
  },
  {
    key: "great_northern",
    displayName: "Great Northern",
    aliases: ["great northern rail"],
  },
  {
    key: "great_western_railway",
    displayName: "GWR",
    aliases: ["great western railway", "great western", "gwr"],
  },
  {
    key: "greater_anglia",
    displayName: "Greater Anglia",
    aliases: ["greater anglia", "ga"],
  },
  {
    key: "heathrow_express",
    displayName: "Heathrow Express",
    aliases: ["heathrow express", "hex"],
  },
  {
    key: "hull_trains",
    displayName: "Hull Trains",
    aliases: ["hull trains", "first hull trains"],
  },
  {
    key: "lner",
    displayName: "LNER",
    aliases: ["london north eastern railway", "lner"],
  },
  {
    key: "london_northwestern_railway",
    displayName: "London Northwestern Railway",
    aliases: ["london northwestern", "lnr"],
  },
  {
    key: "london_overground",
    displayName: "London Overground",
    aliases: ["overground", "tfl overground"],
  },
  {
    key: "lumo",
    displayName: "Lumo",
    aliases: ["lumo trains"],
  },
  {
    key: "merseyrail",
    displayName: "Merseyrail",
    aliases: ["mersey rail"],
  },
  {
    key: "northern",
    displayName: "Northern",
    aliases: ["northern trains", "northern rail"],
  },
  {
    key: "scotrail",
    displayName: "ScotRail",
    aliases: ["scot rail"],
  },
  {
    key: "south_western_railway",
    displayName: "South Western Railway",
    aliases: ["south western", "swr"],
  },
  {
    key: "southeastern",
    displayName: "Southeastern",
    aliases: ["south eastern"],
  },
  {
    key: "southern",
    displayName: "Southern",
    aliases: ["southern railway"],
  },
  {
    key: "stansted_express",
    displayName: "Stansted Express",
    aliases: ["stansted express"],
  },
  {
    key: "thameslink",
    displayName: "Thameslink",
    aliases: ["thameslink railway"],
  },
  {
    key: "transpennine_express",
    displayName: "TransPennine Express",
    aliases: ["trans pennine express", "tpe"],
  },
  {
    key: "transport_for_wales",
    displayName: "Transport for Wales",
    aliases: [
      "tfw",
      "transport for wales rail",
      "trafnidiaeth cymru",
    ],
  },
  {
    key: "west_midlands_railway",
    displayName: "West Midlands Railway",
    aliases: ["west midlands", "wmr"],
  },
]);

function normaliseOperatorName(operatorName) {
  return String(operatorName || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const operatorAliasIndex = new Map();

for (const operator of UK_RAIL_OPERATORS) {
  const names = [
    operator.key,
    operator.displayName,
    ...(operator.aliases || []),
  ];

  for (const name of names) {
    operatorAliasIndex.set(
      normaliseOperatorName(name),
      operator
    );
  }
}

function resolveOperator(operatorName) {
  const normalisedName = normaliseOperatorName(operatorName);

  if (!normalisedName) {
    return null;
  }

  return operatorAliasIndex.get(normalisedName) || null;
}

function getOperatorByKey(operatorKey) {
  return (
    UK_RAIL_OPERATORS.find(
      (operator) => operator.key === operatorKey
    ) || null
  );
}

function getAllOperators() {
  return UK_RAIL_OPERATORS.map((operator) => ({
    ...operator,
    aliases: [...operator.aliases],
  }));
}

export {
  UK_RAIL_OPERATORS,
  getAllOperators,
  getOperatorByKey,
  normaliseOperatorName,
  resolveOperator,
};