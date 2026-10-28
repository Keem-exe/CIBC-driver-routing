"""
Offline geography for Jamaica: an address gazetteer and a main-road network.

Coordinates are approximate (town / neighbourhood centres), which is enough to
cluster stops and order routes. Nothing is sent to an external geocoder.
"""

import re

KSA = ("KINGSTON", "SAINT ANDREW")  # one metro area, treated as one parish

PARISH_CENTRES = {
    "KINGSTON": (17.9700, -76.7920), "SAINT ANDREW": (18.0125, -76.7975),
    "SAINT CATHERINE": (17.9910, -76.9570), "CLARENDON": (17.9650, -77.2450),
    "MANCHESTER": (18.0420, -77.5070), "SAINT ELIZABETH": (18.0530, -77.7000),
    "WESTMORELAND": (18.2190, -78.1330), "HANOVER": (18.4510, -78.1730),
    "SAINT JAMES": (18.4710, -77.9190), "TRELAWNY": (18.4930, -77.6560),
    "SAINT ANN": (18.4070, -77.1040), "SAINT MARY": (18.3700, -76.8900),
    "PORTLAND": (18.1760, -76.4500), "SAINT THOMAS": (17.8800, -76.4100),
}

# Kingston postal districts ("KINGSTON 10", "KGN 5", ...).
KINGSTON_DISTRICTS = {
    1: (17.9660, -76.7920), 2: (17.9750, -76.7750), 3: (17.9850, -76.7700),
    4: (17.9850, -76.7850), 5: (18.0050, -76.7850), 6: (18.0220, -76.7680),
    7: (18.0150, -76.7450), 8: (18.0450, -76.7950), 9: (18.0750, -76.7950),
    10: (18.0120, -76.7970), 11: (17.9950, -76.8250), 12: (17.9850, -76.8100),
    13: (17.9680, -76.8150), 14: (17.9750, -76.8050), 15: (17.9650, -76.8200),
    16: (17.9700, -76.7550), 17: (17.9520, -76.7200), 18: (17.9370, -76.8400),
    19: (18.0400, -76.8150), 20: (18.0220, -76.8350),
}
DISTRICT_RE = re.compile(r"\b(?:KINGSTON|KINGSTION|KINSGTON|KINGSTRON|KGN|KING)\s*(\d{1,2})\b")

# (name, lat, lon, parishes, keywords). Earlier entries win within a level.
AREAS = [
    ("Norman Manley Airport", 17.9360, -76.7880, KSA, ["NORMAN MANLEY INTL", "NORMAN MANLEY INTERNATIONAL", "NORMAN MANLEY INT", "NMIA", "PALISADOES"]),
    ("Sangster Airport", 18.5030, -77.9130, ("SAINT JAMES",), ["SANGSTER", "SANGSTERS", "SANGSER", "MBJ"]),
    ("New Kingston", 18.0075, -76.7850, KSA, ["NEW KINGSTON", "KNUTSFORD", "KNUSTFORD", "OXFORD ROAD", "DOMINICA DRIVE", "ST LUCIA"]),
    ("Half Way Tree", 18.0125, -76.7975, KSA, ["HALF WAY TREE", "HALFWAY TREE", "HWT", "MOLYNES", "DUKHARAN", "EASTWOOD PARK", "WATERLOO"]),
    ("Cross Roads", 17.9980, -76.7830, KSA, ["CROSS ROADS", "SLIPE", "LADY MUSGRAVE"]),
    ("Liguanea", 18.0220, -76.7680, KSA, ["LIGUANEA", "BARBICAN", "OLD HOPE", "HOPE ROAD", "WINCHESTER", "SOVEREIGN CENTRE", "SOVEREIGN CENTER"]),
    ("Papine", 18.0170, -76.7430, KSA, ["PAPINE", "MONA", "CHANDOS"]),
    ("Constant Spring", 18.0350, -76.7970, KSA, ["CONSTANT SPRING", "CONST SPRING", "C SPRING", "CONSTANTSPRING", "MANOR PARK", "MANOR CENTRE"]),
    ("Mannings Hill", 18.0500, -76.8000, KSA, ["MANNINGS HILL", "MANNING HILL", "MANNINGS HILLS", "HAVENDALE"]),
    ("Red Hills", 18.0350, -76.8200, KSA, ["RED HILLS", "MEADOWBROOK"]),
    ("Stony Hill", 18.0780, -76.7960, KSA, ["STONY HILL", "TEMPLE HALL", "GOLDEN SPRING"]),
    ("Duhaney Park", 18.0200, -76.8400, KSA, ["DUHANEY", "WASHINGTON DRIVE", "WASHINGTON BOULEVARD", "BOULEVARD SHOPPING", "BOULEVARD SUPER"]),
    ("Spanish Town Road", 17.9950, -76.8250, KSA, ["SPANISH TOWN ROAD", "SPANISH TOWN RD", "WALTHAM PARK", "BELL ROAD", "ASHENHEIM", "HAGLEY PARK", "HABLEY PARK"]),
    ("Newport West", 17.9650, -76.8150, KSA, ["NEWPORT WEST", "NEWPORT BOULEVARD", "NEWPORT BLVD", "NEWPORTBOULEVA", "MARCUS GARVEY", "MAXFIELD", "FOURTH AVENUE"]),
    ("Downtown Kingston", 17.9680, -76.7930, KSA, ["CSO", "DOWNTOWN", "KING STREET", "HARBOUR STREET", "ORANGE STREET", "CHURCH STREET", "DUKE STREET", "OCEAN BOULEVARD", "WATERFRONT", "VICTORIA PIER", "PORT ROYAL STREET", "PRINCESS STREET", "WEST PARADE", "EAST QUEENS", "WEST QUEEN", "LUKE LANE", "PEECHON", "NETHERSOLE"]),
    ("Rollington Town", 17.9780, -76.7700, KSA, ["WINDWARD", "WINWARD", "ROLLINGTON", "DEANERY", "SOUTH CAMP", "JACKSON ROAD"]),
    ("Harbour View", 17.9520, -76.7200, KSA, ["HARBOUR VIEW", "REEF AVENUE"]),
    ("Bull Bay", 17.9450, -76.6800, KSA + ("SAINT MARY",), ["BULL BAY", "9 MILE", "NINE MILES", "NONE MILES"]),
    ("Ironshore", 18.5050, -77.8650, ("SAINT JAMES",), ["IRONSHORE", "IRON SHORE", "WHITTER VILLAGE", "WHITTER VIL", "BLUE DIAMOND", "BLUE DIMOND", "BLUE DIAMOMD", "PROVIDENCE", "MAHOE BAY", "HALF MOON", "HALFMOON"]),
    ("Rose Hall", 18.5150, -77.8250, ("SAINT JAMES",), ["ROSEHALL", "ROSE HALL", "IBEROSTAR", "CORAL GARDENS", "SECRETS RESORTS"]),
    ("Bogue / Fairview", 18.4580, -77.9350, ("SAINT JAMES",), ["BOGUE", "FAIRVIEW", "FAIRFIELD", "CATHERINE HALL", "CATHERINE HAL"]),
    ("Freeport", 18.4630, -77.9450, ("SAINT JAMES",), ["FREEPORT", "SOUTHERN CROSS", "M19 SOUTHERN", "COCONUT WAY"]),
    ("Montego Bay Hip Strip", 18.4800, -77.9230, ("SAINT JAMES",), ["GLOUCESTER", "QUEENS DRIVE", "KENT AVENUE", "KENT AVE", "DOCTORS CAVE", "JIMMY CLIFF"]),
    ("Mount Salem", 18.4600, -77.9050, ("SAINT JAMES",), ["MOUNT SALEM", "MT SALEM", "ROSE HEIGHTS", "GLENDEVON", "CATHERINE MOUNT", "CATHERINEMOUNT"]),
    ("Reading", 18.4450, -77.9550, ("SAINT JAMES",), ["READING", "WESTGATE", "NORWOOD", "WESTGREEN"]),
    ("Ocho Rios Centre", 18.4070, -77.1040, ("SAINT ANN",), ["TAJ MAHAL", "TAJMAHAL", "ISLAND VILLAGE", "ISLAND VILLA", "DACOSTA DRIVE", "MILFORD", "EXCHANGE", "CARIB BEACH", "REXO PLAZA", "SANDCASTLES"]),
    ("Portmore", 17.9550, -76.8800, ("SAINT CATHERINE",), ["PORTMORE MALL", "PORTMORE PINES", "PORTMORE TOWN", "INDEPENDENCE CITY", "IND CITY", "NAGGO HEAD", "CONGREVE", "CONGRIEVE", "GREGORY PARK", "SOVEREIGN VILLAGE", "CEDAR MANOR", "DYKE ROAD", "COOKSON PEN", "SONRISE"]),
    ("Greater Portmore", 17.9450, -76.9050, ("SAINT CATHERINE",), ["GREATER PORTMORE", "BRAETON", "BREATON", "BRETON", "SUNSHINE OUTLET", "HELLSHIRE"]),
    ("Bridgeport", 17.9580, -76.8650, ("SAINT CATHERINE",), ["BRIDGEPORT", "BRIDGPORT", "PORT HENDERSON"]),
    ("White Marl", 18.0030, -76.9200, ("SAINT CATHERINE",), ["WHITE MARL", "WHITEMARL"]),
]

TOWNS = [
    ("Montego Bay", 18.4710, -77.9190, ("SAINT JAMES",), ["MONTEGO BAY", "MONTEGO", "MOBAY", "MONTEO BAY", "MONTGEO BAY", "MONETGO BAY", "MONTEGI BAY", "MONTEG", "BARNETT", "BARNET STREET", "HOWARD COOKE", "CREEK STREET", "FORT STREET", "CHURCHILL AVE", "RAILWAY LANE", "FUSTIC", "CLAUDE CLARKE", "FISH LANE", "HARBOUR CITY", "DUMFRIES", "FLANKERS"]),
    ("Granville", 18.4300, -77.9000, ("SAINT JAMES",), ["GRANVILLE"]),
    ("Cambridge", 18.3000, -77.8900, ("SAINT JAMES",), ["CAMBRIDGE"]),
    ("Greenwood", 18.5000, -77.7700, ("SAINT JAMES",), ["GREENWOOD"]),
    ("Round Hill", 18.4620, -78.0050, ("HANOVER", "SAINT JAMES"), ["ROUND HILL"]),
    ("Lucea", 18.4510, -78.1730, ("HANOVER",), ["LUCEA", "GRAND PALLADIUM"]),
    ("Hopewell", 18.4430, -78.0300, ("HANOVER",), ["HOPEWELL", "HOPWELL", "TRYALL", "GREAT RIVER"]),
    ("Green Island", 18.3830, -78.2700, ("HANOVER",), ["GREEN ISLAND", "GREENISLAND", "PRINCESS GRAND", "ORANGE BAY"]),
    ("Sandy Bay", 18.4450, -78.0800, ("HANOVER",), ["SANDY BAY", "MOSQUITO COVE"]),
    ("Negril", 18.2680, -78.3480, ("WESTMORELAND",), ["NEGRIL", "NEGFRIL", "NEGFRILPO", "WEST END", "ROYALTON", "NORMAN MANLEY BLVD", "NORMAN MANLEY BOULEVARD", "NORMAN MANLEYBOULEVARD", "RED GROUND"]),
    ("Savanna-la-Mar", 18.2190, -78.1330, ("WESTMORELAND",), ["SAVANNA LA MAR", "SAVANNA LA MA", "SAVANA LA MAR", "SAVANNA", "BECKFORD STREET", "BECKFORD PLAZA", "GREAT GEORGE", "LLANDILO", "BIG BRIDGE", "BARTLETTS", "DUNBARS RIVER", "STRATHBOGIE", "FARM PEN", "PARADISE ROAD", "SMITHFIELD"]),
    ("Little London", 18.2500, -78.2100, ("WESTMORELAND",), ["LITTLE LONDON"]),
    ("Grange Hill", 18.3200, -78.1800, ("WESTMORELAND",), ["GRANGE HILL"]),
    ("Frome", 18.3000, -78.1500, ("WESTMORELAND",), ["FROME", "GEORGES PLAIN"]),
    ("Roaring River", 18.2700, -78.1000, ("WESTMORELAND",), ["ROARING RIVER"]),
    ("Whitehouse", 18.0830, -77.9600, ("WESTMORELAND",), ["WHITEHOUSE"]),
    ("Santa Cruz", 18.0530, -77.7000, ("SAINT ELIZABETH",), ["SANTA CRUZ"]),
    ("Black River", 18.0260, -77.8500, ("SAINT ELIZABETH",), ["BLACK RIVER", "SCHOOL STREET BLACK"]),
    ("Southfield", 17.8800, -77.6600, ("SAINT ELIZABETH",), ["SOUTHFIELD", "TOP HILL"]),
    ("Junction", 17.9300, -77.6100, ("SAINT ELIZABETH",), ["JUNCTION"]),
    ("Sandy Ground", 17.9900, -77.7900, ("SAINT ELIZABETH",), ["SANDY GROUND", "FYFFES PE"]),
    ("Falmouth", 18.4930, -77.6560, ("TRELAWNY",), ["FALMOUTH", "FAMOUTH", "FALMOTH", "COOPERS PEN", "COOPER PEN", "NEW COURT", "FLORENCE HALL", "RIU AQUARELLE"]),
    ("Martha Brae", 18.4650, -77.6450, ("TRELAWNY",), ["MARTHA BRAE"]),
    ("Duncans", 18.4700, -77.5300, ("TRELAWNY",), ["DUNCANS"]),
    ("Coral Spring", 18.4900, -77.5700, ("TRELAWNY",), ["MOUNTAIN SPRING", "CORAL SPRING", "BLUE WATERS"]),
    ("Salt Marsh", 18.4970, -77.7000, ("TRELAWNY",), ["SALT MARSH"]),
    ("Wiltshire", 18.4200, -77.6600, ("TRELAWNY",), ["WILTSHIRE"]),
    ("Warsop", 18.2900, -77.6200, ("TRELAWNY",), ["WARSOP"]),
    ("Ocho Rios", 18.4070, -77.1040, ("SAINT ANN",), ["OCHO RIOS", "OCHO RIO", "OCH RIOS", "OCHI", "MAMMEE BAY", "MOON PALACE", "DUNNS RIVER", "DUNN S RIVER", "WHITE RIVER", "BUCKFIELD", "BUCKSFIELD", "HOG HOLE", "HARRISON TOWN", "NEWLIN", "EVELYN"]),
    ("Drax Hall", 18.4300, -77.1700, ("SAINT ANN",), ["DRAX HALL", "DRAXHAL"]),
    ("St Ann's Bay", 18.4350, -77.2000, ("SAINT ANN",), ["ST ANNS BAY", "ST ANN S BAY", "ST ANNS", "BRAVO STREET", "BRAVO STR", "ADDISON PARK", "STEER TOWN"]),
    ("Runaway Bay", 18.4570, -77.3300, ("SAINT ANN",), ["RUNAWAY BAY", "RUNNAWAY BAY", "SALEM"]),
    ("Discovery Bay", 18.4600, -77.4000, ("SAINT ANN",), ["DISCOVERY BAY", "DISCOVER BAY"]),
    ("Browns Town", 18.3900, -77.3700, ("SAINT ANN",), ["BROWNS TOWN"]),
    ("Claremont", 18.3300, -77.1800, ("SAINT ANN",), ["CLAREMONT"]),
    ("Port Maria", 18.3700, -76.8900, ("SAINT MARY",), ["PORT MARIA", "STENNETT STREET", "STENNET ST", "BANANA STREET"]),
    ("Highgate", 18.2700, -76.8900, ("SAINT MARY",), ["HIGHGATE"]),
    ("Annotto Bay", 18.2720, -76.7700, ("SAINT MARY", "SAINT ANN"), ["ANNOTTO BAY"]),
    ("Port Antonio", 18.1760, -76.4500, ("PORTLAND",), ["PORT ANTONIO", "PORT ANTIONI", "PORT ANTO", "PO ANTONI", "ANTONIO", "BOUNDBROOK", "BOUNBROOK", "WEST STREET", "WILLIAM STREET", "WILLIAMS STREET", "HARBOUR ST", "HARB ST", "FOLLY ROAD", "BRYAN S BAY", "SOMMERS TOWN", "FORT GEORGE", "BLAKE STREET", "ALLAN AVENUE", "WEST PALM", "MARKET SQUARE"]),
    ("San San", 18.1700, -76.4000, ("PORTLAND",), ["SAN SAN"]),
    ("Boston Bay", 18.1500, -76.3600, ("PORTLAND",), ["BOSTON"]),
    ("Buff Bay", 18.2330, -76.6600, ("PORTLAND",), ["BUFF BAY", "WINDSOR CASTLE"]),
    ("Hope Bay", 18.2000, -76.5700, ("PORTLAND",), ["HOPE BAY", "HOPEBAY"]),
    ("St Margaret's Bay", 18.2000, -76.5200, ("PORTLAND",), ["ST MARGARETS"]),
    ("Manchioneal", 18.0400, -76.2800, ("PORTLAND",), ["MANCHIONEAL"]),
    ("Long Bay", 18.0900, -76.3200, ("PORTLAND",), ["LONG BAY"]),
    ("Priestman's River", 18.1300, -76.3400, ("PORTLAND",), ["PRIESTMAN"]),
    ("Morant Bay", 17.8800, -76.4100, ("SAINT THOMAS",), ["MORANT BAY", "MORANT B"]),
    ("Mandeville", 18.0420, -77.5070, ("MANCHESTER",), ["MANDEVILLE", "CALEDONIA", "WARD AVENUE", "VILLA ROAD", "NASHVILLE", "BRUMALIA", "PERTH RD", "GROVE COURT", "GROVE RD", "RACE COURSE", "MAY DAY"]),
    ("Williamsfield", 18.0700, -77.4700, ("MANCHESTER",), ["WILLIAMSFIELD"]),
    ("Christiana", 18.1720, -77.4900, ("MANCHESTER",), ["CHRISTIANA"]),
    ("May Pen", 17.9650, -77.2450, ("CLARENDON",), ["MAY PEN", "MAYPEN", "MAY P", "STORK STREET", "BARGAIN VILLAGE", "BARGAIN PLAZA", "SEVENS ROAD", "MANCHESTER AVENU", "MUIRHEAD", "MUIR PARK", "BROMANTY"]),
    ("Denbigh", 17.9770, -77.2600, ("CLARENDON",), ["DENBIGH"]),
    ("Mineral Heights", 17.9600, -77.2250, ("CLARENDON",), ["MINERAL HEIGHTS", "MINERAL HEIGHT", "ALUMINIUM WAY"]),
    ("Lionel Town", 17.8100, -77.2400, ("CLARENDON",), ["LIONEL TOWN"]),
    ("Toll Gate", 17.9900, -77.3300, ("CLARENDON",), ["TOLL GATE"]),
    ("Spaulding", 18.1600, -77.4500, ("CLARENDON",), ["SPAULDING"]),
    ("Portland Cottage", 17.7500, -77.1700, ("CLARENDON",), ["PORTLAND COTTAGE"]),
    ("Spanish Town", 17.9910, -76.9570, ("SAINT CATHERINE",), ["SPANISH TOWN", "SPANISHTOWN", "SANISH TOWN", "SPANISH TOW", "SPANISH", "SYDENHAM", "SYNDNAM", "ELTHAM", "YOUNG STREET", "YOUNG ST", "BRUNSWICK", "CORLETTS", "WELLINGTON STREET", "BURKE ROAD", "ANGELS PLAZA", "CUMBERLAND", "OASIS SHOPPING", "CHEVALIER"]),
    ("Portmore", 17.9550, -76.8800, ("SAINT CATHERINE",), ["PORTMORE", "PORTMOR", "PORTSMOUTH"]),
    ("Linstead", 18.1370, -77.0300, ("SAINT CATHERINE",), ["LINSTEAD"]),
    ("Old Harbour", 17.9400, -77.1100, ("SAINT CATHERINE",), ["OLD HARBOUR", "BUSHY PARK", "BUSHY", "NEW HARBOUR"]),
    ("Ewarton", 18.1800, -77.0800, ("SAINT CATHERINE",), ["EWARTON"]),
    ("Bog Walk", 18.1000, -77.0050, ("SAINT CATHERINE",), ["BOG WALK", "BOGWALK"]),
]

# Main-road hubs and the roads between them (Dijkstra runs over this graph).
HUBS = {
    "Kingston": (18.0120, -76.7970), "Downtown": (17.9680, -76.7930), "Papine": (18.0170, -76.7430),
    "Stony Hill": (18.0780, -76.7960), "Portmore": (17.9550, -76.8800), "Spanish Town": (17.9910, -76.9570),
    "Old Harbour": (17.9400, -77.1100), "May Pen": (17.9650, -77.2450), "Lionel Town": (17.8100, -77.2400),
    "Williamsfield": (18.0700, -77.4700), "Mandeville": (18.0420, -77.5070), "Christiana": (18.1720, -77.4900),
    "Santa Cruz": (18.0530, -77.7000), "Junction": (17.9300, -77.6100), "Black River": (18.0260, -77.8500),
    "Whitehouse": (18.0830, -77.9600), "Savanna-la-Mar": (18.2190, -78.1330), "Little London": (18.2500, -78.2100),
    "Negril": (18.2680, -78.3480), "Green Island": (18.3830, -78.2700), "Lucea": (18.4510, -78.1730),
    "Hopewell": (18.4430, -78.0300), "Montego Bay": (18.4710, -77.9190), "Montpelier": (18.3700, -77.9300),
    "Cambridge": (18.3000, -77.8900), "Ironshore": (18.5050, -77.8650), "Falmouth": (18.4930, -77.6560),
    "Duncans": (18.4700, -77.5300), "Discovery Bay": (18.4600, -77.4000), "Runaway Bay": (18.4570, -77.3300),
    "Browns Town": (18.3900, -77.3700), "St Ann's Bay": (18.4350, -77.2000), "Ocho Rios": (18.4070, -77.1040),
    "Moneague": (18.2700, -77.1200), "Claremont": (18.3300, -77.1800), "Ewarton": (18.1800, -77.0800),
    "Linstead": (18.1370, -77.0300), "Bog Walk": (18.1000, -77.0050), "Port Maria": (18.3700, -76.8900),
    "Highgate": (18.2700, -76.8900), "Annotto Bay": (18.2720, -76.7700), "Castleton": (18.1800, -76.8200),
    "Buff Bay": (18.2330, -76.6600), "Hope Bay": (18.2000, -76.5700), "Port Antonio": (18.1760, -76.4500),
    "Boston Bay": (18.1500, -76.3600), "Manchioneal": (18.0400, -76.2800), "Morant Bay": (17.8800, -76.4100),
    "Bull Bay": (17.9450, -76.6800), "Harbour View": (17.9520, -76.7200), "Norman Manley Airport": (17.9360, -76.7880),
}
ROADS = [
    ("Kingston", "Downtown"), ("Kingston", "Papine"), ("Kingston", "Stony Hill"), ("Kingston", "Spanish Town"),
    ("Downtown", "Portmore"), ("Portmore", "Spanish Town"), ("Downtown", "Harbour View"),
    ("Harbour View", "Norman Manley Airport"), ("Harbour View", "Bull Bay"), ("Papine", "Harbour View"),
    ("Bull Bay", "Morant Bay"), ("Morant Bay", "Manchioneal"), ("Manchioneal", "Boston Bay"),
    ("Boston Bay", "Port Antonio"), ("Port Antonio", "Hope Bay"), ("Hope Bay", "Buff Bay"),
    ("Buff Bay", "Annotto Bay"), ("Annotto Bay", "Castleton"), ("Castleton", "Stony Hill"),
    ("Annotto Bay", "Port Maria"), ("Highgate", "Port Maria"), ("Highgate", "Castleton"),
    ("Port Maria", "Ocho Rios"), ("Spanish Town", "Bog Walk"), ("Bog Walk", "Linstead"),
    ("Linstead", "Ewarton"), ("Ewarton", "Moneague"), ("Moneague", "Ocho Rios"), ("Moneague", "Claremont"),
    ("Claremont", "St Ann's Bay"), ("Ocho Rios", "St Ann's Bay"), ("St Ann's Bay", "Runaway Bay"),
    ("Runaway Bay", "Browns Town"), ("Browns Town", "Claremont"), ("Runaway Bay", "Discovery Bay"),
    ("Discovery Bay", "Duncans"), ("Duncans", "Falmouth"), ("Falmouth", "Ironshore"),
    ("Ironshore", "Montego Bay"), ("Montego Bay", "Hopewell"), ("Hopewell", "Lucea"),
    ("Lucea", "Green Island"), ("Green Island", "Negril"), ("Negril", "Little London"),
    ("Little London", "Savanna-la-Mar"), ("Savanna-la-Mar", "Whitehouse"), ("Whitehouse", "Black River"),
    ("Black River", "Santa Cruz"), ("Santa Cruz", "Mandeville"), ("Santa Cruz", "Junction"),
    ("Junction", "Mandeville"), ("Mandeville", "Williamsfield"), ("Williamsfield", "May Pen"),
    ("May Pen", "Old Harbour"), ("Old Harbour", "Spanish Town"), ("May Pen", "Lionel Town"),
    ("Mandeville", "Christiana"), ("Christiana", "Browns Town"), ("Montego Bay", "Montpelier"),
    ("Montpelier", "Savanna-la-Mar"), ("Montpelier", "Cambridge"), ("Cambridge", "Santa Cruz"),
]


def normalise(text):
    text = (text or "").upper().replace("&", " AND ").replace("'", "")
    return " " + " ".join(re.sub(r"[^A-Z0-9]+", " ", text).split()) + " "


def _compile(entries):
    return [(name, lat, lon, parishes, [normalise(k) for k in kws]) for name, lat, lon, parishes, kws in entries]


_AREAS, _TOWNS = _compile(AREAS), _compile(TOWNS)


def locate(address, parish):
    """
    Resolve an address to (lat, lon, place, precision, parish_mismatch).
    Candidates in order of specificity: area/landmark, Kingston postal district,
    town. A candidate inside the stated parish wins; if none is, the most
    specific candidate is used and the row is flagged as a parish mismatch.
    """
    addr, parish = normalise(address), (parish or "").strip().upper()
    candidates = []
    for name, lat, lon, parishes, kws in _AREAS:
        if any(k in addr for k in kws):
            candidates.append(((lat, lon), name, "area", parishes))
    m = DISTRICT_RE.search(addr)
    if m and int(m.group(1)) in KINGSTON_DISTRICTS:
        n = int(m.group(1))
        candidates.append((KINGSTON_DISTRICTS[n], f"Kingston {n}", "district", KSA))
    for name, lat, lon, parishes, kws in _TOWNS:
        if any(k in addr for k in kws):
            candidates.append(((lat, lon), name, "town", parishes))
    if " KINGSTON " in addr or " KGN " in addr:
        candidates.append((PARISH_CENTRES["SAINT ANDREW"], "Kingston", "town", KSA))

    for point, name, precision, parishes in candidates:
        if parish in parishes:
            return point[0], point[1], name, precision, False
    if candidates:
        point, name, precision, _ = candidates[0]
        return point[0], point[1], name, precision, bool(parish)
    if parish in PARISH_CENTRES:
        lat, lon = PARISH_CENTRES[parish]
        return lat, lon, parish.title(), "parish", False
    return None, None, None, None, False
