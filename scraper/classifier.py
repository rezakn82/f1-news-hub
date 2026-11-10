import re

CATEGORY_RULES = [
    (
        "FIA & Regulations",
        [
            r"\bfia\b", r"\bstewards?\b", r"\bpenalt(y|ies)\b", r"\bregulations?\b",
            r"\bdirective\b", r"\bconcorde\b", r"\bprotest\b", r"\bdisqualif",
            r"\billegal\b", r"\bcost cap\b", r"\bbudget cap\b", r"\bregolament",
            r"\bcommissari\b", r"\bpenalit[àa]\b", r"\bfederazione\b", r"\bsulayem\b",
            r"\bsummon", r"\binvestigat", r"\bparc ferm[eé]\b"
        ],
    ),
    (
        "Technical News",
        [
            r"\baero(dynamics?)?\b", r"\bfloor\b", r"\bdiffuser\b", r"\bsidepod",
            r"\bfront wing\b", r"\brear wing\b", r"\bsuspension\b", r"\bpower unit\b",
            r"\bengine\b", r"\bchassis\b", r"\bupgrade", r"\bwind tunnel\b",
            r"\bcfd\b", r"\bdownforce\b", r"\bdrag\b", r"\bbeam wing\b", r"\bbrake",
            r"\btyre deg", r"\btecnic[ao]\b", r"\baggiornament[oi]\b", r"\bfondo\b",
            r"\bsospension[ei]\b", r"\baerodinamic", r"\bmotore\b", r"\btelaio\b",
            r"\bpance\b", r"\bala anteriore\b", r"\bala posteriore\b", r"\banalisi tecnica\b"
        ],
    ),
    (
        "Transfers & Rumors",
        [
            r"\bcontract\b", r"\bsign(s|ed|ing)?\b", r"\btransfer\b", r"\brumou?rs?\b",
            r"\bseat\b", r"\bline-?up\b", r"\breplace", r"\bextension\b",
            r"\bmercato\b", r"\brinnovo\b", r"\bcontratto\b", r"\bfuturo\b",
            r"\bsedile\b", r"\bindiscrezion", r"\b2027\b"
        ],
    ),
    (
        "Race Weekend",
        [
            r"\bfp1\b", r"\bfp2\b", r"\bfp3\b", r"\bqualifying\b", r"\bpole\b",
            r"\bsprint\b", r"\brace report\b", r"\bgrand prix\b", r"\bgp\b",
            r"\bpodium\b", r"\bgrid\b", r"\bpit stop\b", r"\blap time",
            r"\bqualifiche\b", r"\bgara\b", r"\blibere\b", r"\bpodio\b",
            r"\bgriglia\b", r"\bcronaca\b", r"\brisultati\b", r"\bclassifica\b"
        ],
    ),
    (
        "Driver News",
        [
            r"\bverstappen\b", r"\bhamilton\b", r"\bleclerc\b", r"\bnorris\b",
            r"\bpiastri\b", r"\brussell\b", r"\bantonelli\b", r"\bsainz\b",
            r"\balonso\b", r"\bgasly\b", r"\balbon\b", r"\blawson\b", r"\bbearman\b",
            r"\bcolapinto\b", r"\bhadjar\b", r"\bbortoleto\b", r"\bhulkenberg\b",
            r"\bocon\b", r"\bstroll\b", r"\bbottas\b", r"\bperez\b"
        ],
    ),
    (
        "Team News",
        [
            r"\bferrari\b", r"\bmclaren\b", r"\bred bull\b", r"\bmercedes\b",
            r"\baston martin\b", r"\balpine\b", r"\bwilliams\b", r"\bhaas\b",
            r"\bracing bulls\b", r"\baudi\b", r"\bsauber\b", r"\bcadillac\b",
            r"\bvasseur\b", r"\bwolff\b", r"\bhorner\b", r"\bstella\b", r"\bkomatsu\b",
            r"\bnewey\b", r"\bmeckies\b", r"\bvowles\b", r"\bbinotto\b"
        ],
    ),
]

F1_KEYWORDS_REQUIRED = [
    r"\bf1\b", r"formula\s*1", r"formula\s*one", r"formula\s*uno", r"\bgrand prix\b",
    r"\bgp\b", r"\bferrari\b", r"\bmercedes\b", r"\bred bull\b", r"\bmclaren\b",
    r"\bverstappen\b", r"\bhamilton\b", r"\bleclerc\b", r"\bnorris\b", r"\bantonelli\b",
    r"\brussell\b", r"\bpiastri\b", r"\balonso\b", r"\bsainz\b", r"\bvasseur\b",
    r"\bwolff\b", r"\bfia\b", r"\bpirelli\b", r"\bmonza\b", r"\bsilverstone\b", r"\bmaranello\b"
]

NON_F1_SERIES = [
    r"\bmotogp\b", r"\bindycar\b", r"\bnascar\b", r"\bwrc\b", r"\bwec\b",
    r"\bsuperbike\b", r"\bformula e\b", r"\bserie a\b", r"\bchampions league\b"
]


def is_f1_relevant(title: str, description: str = "", url: str = "") -> bool:
    text = f"{title} {description} {url}".lower()
    title_lower = title.lower()
    has_f1 = any(re.search(pat, text) for pat in F1_KEYWORDS_REQUIRED)
    has_other_in_title = any(re.search(pat, title_lower) for pat in NON_F1_SERIES)
    if has_other_in_title and not re.search(r"\bf1\b|formula\s*1|formula\s*one", title_lower):
        return False
    return has_f1


def classify_article(title: str, description: str = "", default_category: str = "Latest News") -> str:
    combined = f"{title} {description}".lower()
    for category, patterns in CATEGORY_RULES:
        for pat in patterns:
            if re.search(pat, combined):
                return category
    return default_category or "Latest News"