#!/usr/bin/env python3
"""
VAULT — News Scenario Bank Generator
=====================================
Generates the pre-written news bank the engine sequences at runtime (ZERO runtime
AI). Each scenario is a human-readable story PLUS hidden sector effects + duration.

THE HARD RULES (enforced by construction):
  1. A story NEVER states a recommendation ("buy X", "sell Y").
  2. A story NEVER mentions AI, traders, or "the market will react".
  3. The story describes a WORLD EVENT. The player reads it and infers. The hidden
     `effects` move sector demand; AI traders read effects (not words) and act, so
     behavior lines up with the story without anything being announced.

Output: ./data/news.json  (list of scenarios)
Run:    python3 generate_news.py
"""
import json, os, random
random.seed(11)
OUT = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(OUT, exist_ok=True)

# sectors must match sectors.json
SECTORS = ["construction","logistics","automotive","technology","energy",
           "agriculture","manufacturing","medical","hospitality","consumer",
           "textiles","luxury"]

# Invented recurring entities so the world feels continuous across stories.
# (Brands like these also exist in brands.json; news can name fictional players.)
FIRMS = {
    "logistics":   ["Atlas Freight","Meridian Haul","Vantor Logistics","Cardinal Carriers"],
    "construction":["Halcrow Build Group","Ironcrest Contracting","Stonebridge Developments"],
    "automotive":  ["Marrowgear Motors","Veldt Drive","Kessel Automotive"],
    "technology":  ["Veldt Systems","Corvon Compute","Aperture Networks"],
    "energy":      ["Cindral Power","Boreas Energy","Greywater Utilities"],
    "agriculture": ["Harrow Agro","Greenmarsh Farms","Tillage Co-op"],
    "manufacturing":["Forgewright Industrial","Brunhaus Mfg","Carrow Works"],
    "medical":     ["Thal Medical","Ardent Health Supply","Vossen Devices"],
    "hospitality": ["Carrow Hospitality","Maison Group","Hearthstone Resorts"],
    "consumer":    ["Drust Goods","Wold Retail","Bramm Brands"],
    "textiles":    ["Fenn Mills","Garrweave","Orne Fabrics"],
    "luxury":      ["Halcyon Maison","Thronehaus","Erret & Co."],
}
REGIONS = ["the eastern corridor","the gulf ports","the northern belt","the inland hubs",
           "the western basin","the capital region","the river valley","the coastal zone"]

def firm(sec, r): return r.choice(FIRMS[sec])
def region(r): return r.choice(REGIONS)
def label(s): return s.capitalize() if s!="luxury" else "luxury"

# =============================================================================
# STORY TEMPLATES.  Each template is a function (r)->scenario for a given sector
# (or sector pair). It returns: kick, head, body, effects{sector:delta}, dur.
# Deltas are small & bounded; engine eases sector indices toward them over `dur`.
# Positive = demand up (story implies more buying of that sector's goods).
# Negative = demand down. NOTHING in `body` says so.
# =============================================================================

POS, NEG = "pos", "neg"

# generic single-sector POSITIVE catalysts (template, [eligible sectors])
def t_expansion(r, s):
    f = firm(s,r); reg = region(r)
    return dict(kick="Industry",
        head=f"{f} unveils major {label(s)} expansion across {reg}",
        body=f"{f} confirmed a large-scale buildout this morning, with aggressive hiring and procurement slated to begin within weeks. Suppliers in {reg} are bracing for a surge in orders as the program ramps.",
        effects={s:+round(r.uniform(.16,.26),3)}, dur=r.choice([4,5,5,6]))

def t_policy(r, s):
    return dict(kick="Policy",
        head=f"Lawmakers pass package favoring {label(s)} over coming seasons",
        body=f"A long-debated spending package cleared its final vote overnight, directing sustained public funds toward {label(s)} programs. Operators say the certainty alone is enough to unlock projects that had been sitting on the shelf.",
        effects={s:+round(r.uniform(.18,.28),3)}, dur=r.choice([5,6,6]))

def t_shortage(r, s):
    return dict(kick="Materials",
        head=f"Supply of key {label(s)} inputs tightens as disruption drags on",
        body=f"A prolonged disruption has squeezed availability of critical {label(s)} inputs, with lead times stretching and buyers watching inventories nervously. No quick resolution appears to be in sight.",
        effects={s:+round(r.uniform(.10,.18),3)}, dur=r.choice([3,4]))

def t_demand_spike(r, s):
    return dict(kick=label(s).capitalize(),
        head=f"Unexpected wave of demand catches {label(s)} suppliers flat-footed",
        body=f"A sharp, unplanned spike in {label(s)} orders has left several suppliers scrambling to keep shelves stocked. Analysts are split on whether the run-up will hold or fade by season's end.",
        effects={s:+round(r.uniform(.12,.22),3)}, dur=r.choice([3,4]))

# generic single-sector NEGATIVE catalysts
def t_glut(r, s):
    return dict(kick="Markets",
        head=f"{label(s).capitalize()} oversupply pulls prices off recent highs",
        body=f"A wave of new capacity has flooded the {label(s)} space faster than buyers can absorb it. Operators that leaned into the boom are now trimming the excess they'd built up.",
        effects={s:-round(r.uniform(.14,.22),3)}, dur=r.choice([3,4,4]))

def t_recall(r, s):
    f = firm(s,r)
    return dict(kick=label(s).capitalize(),
        head=f"{f} issues sweeping recall, rattling {label(s)} confidence",
        body=f"{f} announced a broad recall after fault reports surfaced in its flagship line. The news cast a chill over the wider {label(s)} category heading into a closely watched stretch.",
        effects={s:-round(r.uniform(.16,.24),3)}, dur=r.choice([3,4]))

def t_slump(r, s):
    return dict(kick="Markets",
        head=f"{label(s).capitalize()} activity slumps on cost and rate jitters",
        body=f"Fresh figures show {label(s)} activity falling sharply as higher costs spook operators. Several large commitments were quietly shelved pending clearer conditions.",
        effects={s:-round(r.uniform(.14,.20),3)}, dur=r.choice([4,5]))

def t_normalize(r, s):
    return dict(kick="Logistics" if s=="logistics" else "Markets",
        head=f"{label(s).capitalize()} backlog clears faster than forecast",
        body=f"The strain that had gripped {label(s)} for months has eased ahead of schedule, and conditions are normalizing. Operators are unwinding the surge capacity they'd leaned on.",
        effects={s:-round(r.uniform(.10,.16),3)}, dur=r.choice([3,4]))

# CROSS-SECTOR cascades — the rich ones (one event, two sectors move)
CROSS_PAIRS = [
    ("construction","energy",  "A grid-and-infrastructure program ties construction to power buildout"),
    ("logistics","construction","A distribution-network rollout pulls both freight and buildout demand"),
    ("automotive","energy",    "An EV push lifts both vehicle and power-storage demand"),
    ("technology","energy",    "A data-center wave drives compute and the power to run it"),
    ("agriculture","logistics","A bumper harvest strains storage and freight capacity"),
    ("manufacturing","construction","A reshoring drive fuels factory and facility buildout"),
    ("hospitality","consumer", "A tourism surge lifts food service and everyday goods"),
    ("medical","manufacturing","A health-system stockpiling push pulls device manufacturing"),
    ("textiles","consumer",    "An apparel cycle lifts raw cloth and finished goods together"),
    ("luxury","consumer",      "A wealth-effect quarter lifts both the top end and broad retail"),
]
def t_cross(r, pair):
    a,b,desc = pair
    reg = region(r); f = firm(a,r)
    big = +round(r.uniform(.18,.26),3); small = +round(r.uniform(.06,.12),3)
    return dict(kick="Industry",
        head=f"{f} program links {label(a)} and {label(b)} in {reg}",
        body=f"{desc.capitalize()}. {f} said the initiative, centered on {reg}, would run for several seasons and draw heavily on connected supply chains. Knock-on demand is expected to spread beyond the headline sector.",
        effects={a:big, b:small}, dur=r.choice([4,5,6]))

# CROSS negative (one sector down drags an adjacent one slightly)
CROSS_NEG = [
    ("automotive","manufacturing","An auto downturn ripples into parts manufacturing"),
    ("construction","energy","A building slowdown softens tied power demand"),
    ("logistics","consumer","A freight glut signals cooling consumer flow"),
]
def t_cross_neg(r, pair):
    a,b,desc = pair; reg = region(r)
    return dict(kick="Markets",
        head=f"{label(a).capitalize()} pullback spills into {label(b)}",
        body=f"{desc.capitalize()}. The softness that began in {label(a)} is bleeding into {label(b)} as orders thin across {reg}. Operators are watching to see how far it spreads.",
        effects={a:-round(r.uniform(.14,.20),3), b:-round(r.uniform(.05,.10),3)}, dur=r.choice([3,4]))

# LUXURY-specific flavor (auctions / collectibles)
def t_auction(r, _s="luxury"):
    return dict(kick="Luxury",
        head="Record gavel: a rare piece shatters its auction estimate",
        body="A closely watched evening sale produced a result several multiples above its low estimate, reigniting chatter about the very top of the collectibles market. Specialists say confidence at the high end tends to feed on itself.",
        effects={"luxury":+round(r.uniform(.16,.24),3)}, dur=r.choice([3,4]))

# QUIET days (no effect) — texture so not every cycle is a catalyst
def t_quiet(r, _s=None):
    flavors = [
        ("Markets","A quiet session across the floor","No major catalysts moved the market today. Trading was thin and prices drifted on their own momentum."),
        ("Markets","Holiday lull keeps activity subdued","With much of the trade away, volumes thinned to a trickle. Few were willing to commit ahead of the coming week."),
        ("Weather","Storms snarl movement in scattered regions","Severe weather briefly disrupted activity in parts of the country, but operators expect normal conditions to resume shortly."),
    ]
    k,h,b = r.choice(flavors)
    return dict(kick=k, head=h, body=b, effects={}, dur=1)

# =============================================================================
# BUILD THE BANK
# =============================================================================
def build():
    r = random.Random(11)
    bank = []

    POS_TEMPLATES = [t_expansion, t_policy, t_shortage, t_demand_spike]
    NEG_TEMPLATES = [t_glut, t_recall, t_slump, t_normalize]

    # 1. positive single-sector stories — a couple per sector
    for s in SECTORS:
        for tmpl in r.sample(POS_TEMPLATES, 2):
            bank.append(tmpl(r, s))
    # 2. negative single-sector stories — a couple per sector
    for s in SECTORS:
        for tmpl in r.sample(NEG_TEMPLATES, 2):
            bank.append(tmpl(r, s))
    # 3. cross-sector positives
    for pair in CROSS_PAIRS:
        bank.append(t_cross(r, pair))
    # 4. cross-sector negatives
    for pair in CROSS_NEG:
        bank.append(t_cross_neg(r, pair))
    # 5. luxury auctions (a few)
    for _ in range(3):
        bank.append(t_auction(r))
    # 6. quiet days
    for _ in range(5):
        bank.append(t_quiet(r))

    # tag ids + a stable weight (quiet days rarer-feeling handled by engine, but
    # we give catalysts higher selection weight so the world feels eventful)
    for i, sc in enumerate(bank):
        sc_id = f"news_{i:03d}"
        sc_clean = {
            "id": sc_id,
            "kick": sc["kick"],
            "head": sc["head"],
            "body": sc["body"],
            "effects": sc["effects"],
            "dur": sc["dur"],
            "weight": 1 if sc["effects"] else 0.4,   # quiet days less frequent
        }
        bank[i] = sc_clean

    return bank

def main():
    bank = build()
    json.dump(bank, open(f"{OUT}/news.json","w"), indent=2)
    # validation: no banned phrases
    banned = ["buy ","sell ","you should","AI ","trader","recommend","invest in","portfolio"]
    flags = []
    for sc in bank:
        text = (sc["head"]+" "+sc["body"]).lower()
        for b in banned:
            if b in text: flags.append((sc["id"], b))
    pos = sum(1 for s in bank if any(v>0 for v in s["effects"].values()))
    neg = sum(1 for s in bank if any(v<0 for v in s["effects"].values()))
    quiet = sum(1 for s in bank if not s["effects"])
    print(f"news scenarios: {len(bank)}  (pos~{pos}, neg~{neg}, quiet {quiet})")
    print(f"cross-sector stories: {sum(1 for s in bank if len(s['effects'])>1)}")
    print(f"banned-phrase flags: {len(flags)}  {flags if flags else '(clean)'}")
    print("\nSAMPLES:")
    for sc in [bank[2], bank[26], bank[48], bank[-3]]:
        print(f"\n[{sc['kick']}] {sc['head']}")
        print(f"  {sc['body']}")
        print(f"  effects={sc['effects']} dur={sc['dur']}")

if __name__=="__main__":
    main()
